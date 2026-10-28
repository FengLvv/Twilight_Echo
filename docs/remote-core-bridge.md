# Share the desktop library and choose an audio output

The desktop exposes the existing authenticated LAN server as **Core bridge version 1**.
Use it to browse the desktop library and its curated metadata, select music, and control
desktop playback or stream supported files to the phone. Each output owns its own
playback session and queue; library selection is independent of the control target.

## Discover the desktop and approve the phone once

Enable **局域网远程控制** in desktop settings. On Android, open **设置 → 电脑 Core**,
select the computer by name, and allow the native connection prompt on the desktop.
The default path requires neither an address nor a PIN. Remote control is off by default.
On Android, connection selects the library without pausing or moving playback. Choose
**此手机** for phone streaming or **电脑** to control the desktop session.

The desktop advertises `_twilight-core._tcp.local` using mDNS/DNS-SD when full remote
control and the Core bridge are available. TXT records contain `id` (stable desktop
`serverId`), `name`, `v=1`, `bridge=1`, and `pair=approval-v1`; they contain no credentials.
Android uses `NsdManager` rather than sweeping subnet addresses or ports. Discovery
locates the server; authorization still requires desktop approval.

1. `GET /api/status` requires no token. Check `coreBridge: true`, `protocolVersion: 1`,
   `coreBridgeVersion: 1`, and the advertised `capabilities.queries` / `capabilities.commands`.
   Capabilities list bridge operations; individual requests still require a ready Core,
   current revisions, and an accessible source. New desktops also return `serverId`,
   `serverName`, and `pairingMode: "approval-v1"`. Verify the expected `serverId` before
   sending saved credentials to a newly discovered endpoint.
2. With no saved credential, `POST /api/pair/requests` with `{ "deviceName": "My phone" }`.
   HTTP `202` returns `{ requestId, claimSecret, expiresAt }`. Keep the claim secret private.
   The desktop asks its owner to allow or reject the request; the default is rejection.
3. Poll `POST /api/pair/claim` with `{ requestId, claimSecret }` about every 1.5 seconds.
   The response is `{ state: "pending" }`, `{ state: "rejected" }`, or
   `{ state: "approved", token: "..." }`. Tickets expire after 120 seconds (`404`).
   Cancel with `POST /api/pair/cancel` using the same private ticket; this dismisses a
   pending desktop prompt. There are at most four live tickets, eight requests per five
   minutes, and sixteen trusted devices. Pending approvals reserve device capacity.

Each approved phone receives an independent bearer token. The desktop profile stores
its stable identity and token verifiers in `remote-devices.json`, never the bearer itself.
Android stores credentials in app-private storage, keyed by `serverId`, and updates the
endpoint on discovery. Authorized devices can reconnect after desktop restart or IP/port
changes without requesting approval again. `serverId` identifies the desktop instance,
not a music `libraryId` or a cryptographically authenticated TLS identity.

Desktop settings list pending requests and trusted devices. Revoking one device closes
only that device's SSE streams with `event: auth` / `{"paired":false}` and makes its RPC
requests unauthorized. These management operations (`remote.status`,
`remote.decidePairing`, `remote.revokeDevice`) require the local settings permission;
they are not public bridge operations. Turning remote control off withdraws discovery
and cancels pending requests, but retains trusted devices for the next enablement.

### Keep PIN pairing as the manual/browser fallback

The desktop's **浏览器遥控与手动连接** disclosure retains its addresses, QR code, and PIN.
`POST /api/pair` with `{ "pin": "123456" }` returns `{ "token": "..." }` and replaces only
the previous shared PIN token; it does not replace independent device credentials.
That legacy token is revoked when the service stops. **更换 PIN 并撤销全部授权** revokes
both legacy and independent tokens and emits the auth-revocation event on open streams.

Both paths use HTTP on a trusted LAN, without TLS. Do not expose the service to the
Internet. Discovery needs multicast UDP 5353; connections need the configured TCP port
(default 18492). Allow the app on the private network in the firewall. Guest-network
isolation, VPN routing, or blocked multicast can prevent discovery; use manual connection
when multicast is unavailable. Media-only Cast mode does not advertise a Core.

## Bootstrap, then subscribe

1. Send `POST /api/core/rpc` with `Authorization: Bearer <token>` and
   `Content-Type: application/json`. Bootstrap with:

   ```json
   {
     "protocolVersion": 1,
     "requestId": "phone-snapshot-1",
     "epoch": "epoch-boot",
     "kind": "query",
     "name": "core.getSnapshot",
     "payload": {}
   }
   ```

   A successful response has `{ kind: "response", requestId, epoch, ok: true, value }`.
   For this query, `value` is the snapshot. Store its `epoch`, `sequence`, queue reference,
   and domain revisions. Every subsequent request must use that epoch. Only snapshot
   bootstrap (`core.getSnapshot` or `state.snapshot`) accepts an unknown epoch.

2. Open `GET /api/core/events` with the same bearer header. Listen for **`core_state`**:

   ```text
   event: core_state
   data: {"kind":"state","epoch":"desktop-epoch","sequence":42,"snapshot":{...}}
   ```

   The connection sends its latest full snapshot immediately, followed by updates and
   heartbeat comments. It also emits legacy `state` events; those are not Core snapshots.
   For the same epoch, ignore snapshots older than the latest applied sequence.
   On reconnect, bootstrap again: SSE has no durable replay cursor. If the epoch changes,
   discard the old queue window and session track references before reading fresh data.

RPC JSON responses use `Cache-Control: no-store`. HTTP `401` requires pairing again;
`429` requires backoff. Transport/body failures use HTTP errors. A parsed RPC can return
HTTP `200` with `ok: false`; always inspect the envelope.

## Share the desktop's NCM sign-in over an encrypted connection

`providers.session` uses the same authenticated `POST /api/core/rpc` envelope, with
`kind: "query"` and `payload: { "providerId": "ncm" }`. A signed-in desktop returns
`{ providerId: "ncm", loggedIn: true, cookie: "..." }`; otherwise it returns
`{ providerId: "ncm", loggedIn: false }` without a cookie. The host checks the enabled
official NCM provider's login and reads its cookie through the encrypted plugin-settings
repository. Other providers and arbitrary settings keys are not supported.

This query requires a bearer-authenticated **TLS socket**. The server derives encryption
from the socket, ignores forwarded-protocol headers and caller assertions, and checks
authorization again before sending the result. Plain HTTP returns `FORBIDDEN` without
reading credentials and does not advertise `providers.session` in `/api/status`.
Provider/keyring exceptions are replaced with a generic error before logging or replying;
sessions never enter snapshots or SSE events. Responses use `Cache-Control: no-store`.

The current production LAN listener still uses HTTP. This implements the query and its
security boundary; automatic sign-in remains unavailable until a TLS listener and Android
certificate trust/pinning are implemented. Do not enable sharing by trusting proxy headers
or by disabling certificate validation. The phone imports the cookie only when its enabled
NCM plugin is signed out, stores it in encrypted settings, and keeps an existing account.

## Read the shared library

These library/playback queries are available on the existing LAN connection. The sensitive
`providers.session` query above additionally requires TLS. Other internal Core requests are rejected.

| Query                                   | Payload and result                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.getSnapshot`, `state.snapshot`    | `{}` → current projected snapshot                                                                                                                                                |
| `search.songs`                          | `{ query?: string, offset?: number, limit?: number }` → `{ query, revision, total, offset, items }`; an empty query browses library tracks                                       |
| `playback.getQueueWindow`, `queue.page` | `{ id?: string, revision?: number, offset?: number, limit?: number, search?: string }` → `{ queueId, revision, total, offset, limit, currentIndex, currentOccurrenceId, items }` |
| `playlists.list`                        | `{ offset?: number, limit?: number }` → array of `{ id, name, trackCount, trackIds: [], updatedAtMs: 0 }`; this compatibility view does not include playlist members             |
| `catalog.query`                         | `{ kind, scope?: "library", source?, search?, artistName?, context?, revision?, offset?, limit? }` → `{ revision, total, offset, items }`                                        |
| `catalog.detail`                        | `{ id, revision? }` → entity and bounded catalog facts                                                                                                                           |
| `catalog.sources`                       | `{ entityId, revision?, offset?, limit? }` → `{ revision, total, offset, items }`, with stable source IDs and source display information                                         |
| `metadata.entity.detail`                | `{ entityId, language, sourceProvider?, includeAutomaticArtwork? }` → effective name, introduction, facts, and artwork previews                                                  |
| `library.artwork`                       | `{ ids: [sessionTrackId, ...] }` → `{ revision, items: [{ id, cover }] }`; `cover` is a raster data URL or `null`                                                                |
| `library.info`                          | `{}` → `{ libraryId, streamFormats: ["flac", "mp3"] }` |
| `media.resolve`                         | `{ libraryId, sourceId, sourceVersion? }` → an authenticated, version-pinned media plan; see below |

Catalog `kind` is `artist`, `release`, `recording`, or `album_project`.
The bridge restricts `catalog.query` to library scope; `scope: "all"` is rejected.
`artistName` is an exact artist-name filter for `kind: "artist"`. `context` uses the
existing `CatalogReferenceContext` in `src/shared/musicCatalog.ts`; ordinary browsing
does not need it.

For an artist screen:

```json
{ "kind": "artist", "search": "陈奕迅", "offset": 0, "limit": 40 }
```

Send that payload to `catalog.query`, then use an item's `id` as `entityId` for
`metadata.entity.detail` with `language: "zh-Hans"`. Languages are `zh-Hans`, `zh-Hant`,
and `en`. Metadata returns the desktop's effective read view, including manual choices;
the phone does not need to run identification or enrichment again. Pass `sourceProvider`
when reading source-restricted material in that source's catalog context.

Artwork entries replace internal handles with `dataUrl` while retaining their `scope`,
`targetRef`, `sourceReleaseId`, `attribution`, and `usage`. Facts retain attribution and
usage too. Honor display/cache/export permissions and `usage.expiresAt`; a preview is
not permission to retain or redistribute it. `manualArtwork` contains the personal
preview; `artworkOverride.mode` preserves `value` versus `clear`. Do not restore
automatic artwork after an explicit clear. A missing or unavailable preview is `null`
or omitted from the artwork array, not an application URL the client should fetch.

### Keep Catalog identity separate from compatibility track IDs

- **Catalog entity and source IDs** are the existing persistent catalog references,
  scoped to this desktop catalog. Use them for entity navigation and source selection.
  Check revisions because sources and entities can change or disappear.
- **Compatibility `track.id`** is now `remote-track:<uuid>`, not a host path. It is an
  opaque session reference issued by snapshot, search, or queue reads. Reuse it only
  with this live desktop bridge; never interpret it as a URI or store it as music identity.
- References are bounded to the latest 4,096 issued tracks and invalidated by Core epoch
  changes, PIN rotation, remote-control disablement, or shutdown. An evicted reference
  returns `NOT_FOUND`; read the track again. They are not bound to an individual device.
- Search items include `catalog` when the derived index has references: its `revision`,
  `sourceId`, and entity `items` connect the compatibility result to the persistent catalog.
  The index may still be catching up; do not manufacture catalog IDs from a title or path.

`library.info` supplies the persistent `libraryId` stored in the desktop profile's
`library-identity.json`, independently of device trust and `serverId`. Keep Catalog
references in that library's ID space and resolve its current endpoint through the saved
server identity. There is still no durable cross-device synchronization cursor.
Track projection also converts `artists` to a string array and `ncmSongId` to a string,
and excludes private file paths, sub-track paths, and media URLs from RPC and SSE.

### Refresh open pages when the desktop edits metadata

Observe `libraryRevision`, `catalogRevision`, and `entityMetadataRevision` on SSE snapshots.
Re-read affected paged lists and the open entity's metadata/sources, retaining the selected
entity and page. Invalidate presentation artwork when its revision changes. Android
debounces domain changes by 180 ms; the user need not reconnect or close the details page.

## Stream a stable source to the phone

Use `media.resolve` with the `libraryId` from `library.info` and an exact Catalog `sourceId`.
This query never edits the desktop queue. The resolver accepts only authorized local
FLAC/MP3 files; CUE/sub-tracks, provider sources and other codecs are rejected rather
than silently substituted. The plan contains:

```json
{
  "libraryId": "lib-<uuid>",
  "sourceId": "<catalog-source-id>",
  "sourceVersion": "<opaque-file-generation>",
  "contentPath": "/media/<ticket>",
  "contentType": "audio/flac",
  "size": 12345678,
  "expiresAt": 1800000000000,
  "maxRangeBytes": 262144
}
```

Resolve the relative path against the authenticated endpoint. `GET` and `HEAD` require
the **same device's bearer header**; a ticket alone or another phone's bearer is insufficient.
Use `Range: bytes=<start>-<end>` with at most 256 KiB and
`If-Match: "<sourceVersion>"`. `HEAD` returns length and ETag; valid reads return `206`,
`Content-Range` and that ETag. Whole-file/unbounded reads return `416`. There are at most
four concurrent phone file reads. Android delivers authenticated ranges through a per-decoder
JNI seekable input to the shared FFmpeg → C++ DSP → AAudio pipeline, not through JS.
Local files use the same audio engine; content URIs get independent descriptors for active
and preloaded decoders. Audio is not saved as an offline download. Phone EQ is applied locally;
this does not grant remote DSP-editing permission or promise Android bit-perfect output.

Tickets expire after 15 minutes. Renew with `media.resolve` carrying the original
`sourceVersion`; Android renews after 14 minutes or once after an expired-ticket `404`.
File replacement returns HTTP `409` or RPC `SOURCE_CHANGED`; an ETag mismatch returns
`412`. Stop and offer a fresh selection instead of joining bytes from different versions.
Each bounded read uses one descriptor and checks its generation before and after reading.

Revoking a device closes its active reads and invalidates its tickets. Disabling remote
control or rotating the PIN revokes phone streams while retaining unrelated Cast grants
when Cast remains active. Cancel a decoder read when stopping/replacing its player.
Persist stable source references, never media URLs or bearer tokens in a playback queue.

## Select music and control desktop playback

Commands use `kind: "command"` and a fresh `commandId` for each user intent. `requestId`
identifies the individual RPC; if `commandId` is omitted it is also the deduplication key.
Successful commands return `value: { snapshot }`.

| Command                                                                                  | Payload                                                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `playback.play`, `playback.pause`, `playback.stop`, `playback.next`, `playback.previous` | `{}`                                                                                               |
| `playback.seek`                                                                          | `{ position: number }`, seconds                                                                    |
| `playback.setVolume`                                                                     | `{ volume: number }`, from `0` to `1`                                                              |
| `playback.setPlayMode`                                                                   | `{ mode: "sequence" \| "loop" \| "single" \| "shuffle" \| "heart" }`                               |
| `playback.selectQueueIndex`                                                              | `{ id?, revision, index, occurrenceId }`; index and occurrence come from the observed queue window |
| `playback.replaceQueue`                                                                  | `{ id?, expectedRevision, tracks: [{ id: sessionTrackId }], startIndex?: number, play?: boolean }` |
| `catalog.play`                                                                           | `{ sourceId, revision }`; use the source ID and catalog revision from `catalog.sources`            |

### Replace from a search selection

After searching, send only issued IDs. For a queue observed at revision `7`:

```json
{
  "protocolVersion": 1,
  "requestId": "phone-request-2",
  "commandId": "phone-selection-1",
  "epoch": "desktop-epoch",
  "expectedRevision": 7,
  "kind": "command",
  "name": "playback.replaceQueue",
  "payload": {
    "id": "default",
    "expectedRevision": 7,
    "tracks": [
      { "id": "remote-track:issued-reference-a" },
      { "id": "remote-track:issued-reference-b" },
      { "id": "remote-track:issued-reference-a" }
    ],
    "startIndex": 1,
    "play": true
  }
}
```

`default` means the currently observed desktop queue; an actual queue ID can also be
supplied. With no active queue, use revision `0`. The desktop resolves references and
re-reads tracks from its own library, then submits IDs to the existing Core queue builder.
It preserves duplicate selections and the supplied seed order; Core playback mode still
governs traversal. `startIndex` is zero-based (default `0`); `play: false` adopts without
starting playback. Client-supplied titles, source hints, and paths never select the source.
This compatibility replacement supports local library sources only.

Queue operations require the revision the user observed. A replacement accepts
`expectedRevision` on the envelope or payload, or payload `revision`; if more than one
is supplied they must agree. A selection accepts envelope `expectedRevision` or payload
`revision` and also requires the original `occurrenceId`, so a repeated song is unambiguous.
If the queue changes during source lookup or before adoption, replacement fails rather
than overwriting the changed queue. On `STALE_REVISION`, refresh and let the user select
again instead of silently applying their action to the new queue.

### Prefer stable source selection for new Catalog screens

Read `catalog.sources` for the selected recording or release, then send `catalog.play`
with that source's ID and returned catalog revision. This uses the native Core source
resolver, not the compatibility reference map. The remote identity has library read and
playback read/write permissions; it has no `providers:call`, so provider playback that
requires that permission is rejected by Core. Catalog playback currently starts the
selected source; it does not promise an album-wide queue.

## Handle failures and limits

RPC failures have `ok: false` and `error: { code, message }`. Branch on `code` rather than
parsing the localized safe message:

- `NOT_READY`: wait for a ready Core and bootstrap again.
- `STALE_EPOCH`: discard session references and queue state, then bootstrap.
- `STALE_REVISION`: refresh the affected queue or catalog and obtain a new selection.
- `SOURCE_CHANGED`: the selected file generation changed; stop the stream and reselect.
- `NOT_FOUND`, `PERMISSION_EXPIRED`, `UNSUPPORTED_CAPABILITY`, `FORBIDDEN`: refresh or
  present the unavailable operation/source; do not substitute a different source silently.
- `BUSY`: back off reads. `INVALID_REQUEST` requires fixing the payload.
- `OUTCOME_UNKNOWN`: the command ID has already been submitted. Read current state;
  do not automatically replay a playback mutation under a fresh ID.
- `CANCELLED`, `FAILED`: show the failure and current desktop state. Raw native/storage
  errors remain on the desktop rather than leaking paths or credentials to the network.

Deduplication remembers the latest 1,024 command IDs until bridge reset. It reserves the
ID before dispatch, including overlapping requests and failed attempts. It is bounded,
in-memory duplicate protection, not a durable command receipt or replay log. After a
timeout or disconnect, read state before offering a new action.

Limits: 64 KiB JSON request body; 8 outstanding bridge requests; 200 rows per page or
replacement; 8 artwork IDs per request; 250,000 characters per raster preview. Search
text is at most 512 characters. Search and playlist pages default to 100, queue windows
to 50. The existing shared HTTP command limiter also counts Core RPC **queries**:
60 requests per 60 seconds. Batch artwork, use SSE instead of snapshot polling, and
avoid eager full-library pagination. Pairing allows 8 attempts per 5 minutes.

## Verify discovery and authorization

Run `pnpm test:desktop-remote` for the bridge, authenticated media ranges/renewal/file
replacement, real HTTP approval/revocation, persisted device trust, local management
validation, settings behavior, and real mDNS discovery.
The tests use isolated state and fixture playback, not the user's music library.
Android's `DESKTOP_CORE.md` describes its unit tests and device interop fixtures.

## Scope of this desktop wiring

The existing `/api/browse`, `/api/command`, and Cast media-only behavior remain separate
and usable. Media-only mode exposes neither pairing nor Core RPC/SSE.

The bridge provides library/metadata reads, desktop-controlled playback, and exact-source
FLAC/MP3 phone streaming. Offline synchronization/download, metadata writes, other codecs,
multi-room audio and TLS remain later work. TLS with authenticated server identity is a
release-security requirement; this build is for a trusted LAN. Existing Cast media grants
remain usable under their original contract and do not grant general desktop file access.

Implementation: `src/core/remote/coreBridge.ts`, `src/core/remote/service.ts`, and
`src/shared/remoteCoreBridge.ts`. Query DTOs and their validators remain in
`src/shared/musicCatalog.ts`, `src/shared/entityMetadata.ts`, and `src/shared/coreProtocol.ts`.

Discovery and trust: `src/main/remote/coreDiscovery.ts`, `src/main/remote/deviceTrust.ts`,
and `src/core/cast/devicePairing.ts`. The main process owns the native approval dialog;
the portable Core receives discovery and approval lifecycle ports.

Media resolution: `src/core/remote/media.ts`, `src/shared/remoteMedia.ts`, and
`src/main/remote/libraryIdentity.ts`. The production Core process resolves Catalog sources
at the current index revision and calls the existing authorized-audio-path platform port.
