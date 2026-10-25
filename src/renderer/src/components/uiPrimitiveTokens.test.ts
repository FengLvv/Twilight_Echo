import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Style-unification guardrail.
 *
 * The shared control primitives live as design tokens in `assets/base.css`
 * (`--te-control-*`, `--te-switch-*`, `--te-badge-*`) so every button, switch,
 * badge, field and dialog converges on one geometry/colour contract. Component
 * styles must consume those tokens rather than re-declaring their own literal
 * radii, heights or palette values. Without this guard the divergence the
 * inventory captured in `output/ui-inventory` would creep back in.
 */
const base = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
const settings = readFileSync(new URL('./settings-page/SettingsPage.css', import.meta.url), 'utf8')
const backgroundAppearanceCustomizerCss = readFileSync(
  new URL('./settings-page/BackgroundAppearanceCustomizer.css', import.meta.url),
  'utf8'
)
const hiFiSidebar = readFileSync(new URL('./player-bar/HiFiSidebar.css', import.meta.url), 'utf8')
const onboarding = readFileSync(
  new URL('./onboarding/OnboardingWizard.css', import.meta.url),
  'utf8'
)
const appearanceLayers = readFileSync(
  new URL('./AppearanceLayerSettings.vue', import.meta.url),
  'utf8'
)
const pluginPage = readFileSync(new URL('./PluginPage.vue', import.meta.url), 'utf8')
const noticeHost = readFileSync(new URL('./AppNoticeHost.vue', import.meta.url), 'utf8')
const appearanceChrome = readFileSync(new URL('./AppearanceChromeSettings.vue', import.meta.url), 'utf8')
const radioPodcast = readFileSync(new URL('./RadioPodcastPage.vue', import.meta.url), 'utf8')
const networkSources = readFileSync(new URL('./NetworkSourcesPage.vue', import.meta.url), 'utf8')
const musicVersionsPanel = readFileSync(
  new URL('./music-versions/MusicVersionsPanel.vue', import.meta.url),
  'utf8'
)
const lyricsManagerPanel = readFileSync(
  new URL('./player-bar/LyricsManagerPanel.vue', import.meta.url),
  'utf8'
)
const externalPlaylistImportDialog = readFileSync(
  new URL('./ExternalPlaylistImportDialog.vue', import.meta.url),
  'utf8'
)
const importDialog = readFileSync(new URL('./ImportDialog.vue', import.meta.url), 'utf8')
const audioDeviceProfileEditor = readFileSync(
  new URL('./settings-page/AudioDeviceProfileEditor.vue', import.meta.url),
  'utf8'
)
const trackInfoDialog = readFileSync(new URL('./TrackInfoDialog.vue', import.meta.url), 'utf8')
const queueWorkspace = readFileSync(
  new URL('./player-bar/QueueWorkspaceDialog.vue', import.meta.url),
  'utf8'
)
const playerBarCss = readFileSync(new URL('./player-bar/PlayerBar.css', import.meta.url), 'utf8')
const playbackQueueDrawerCss = readFileSync(
  new URL('./player-bar/PlaybackQueueDrawer.css', import.meta.url),
  'utf8'
)
const songListCss = readFileSync(new URL('./song-list/SongList.css', import.meta.url), 'utf8')
const ncmAlbumFilters = readFileSync(new URL('./streaming-page/NcmAlbumFilters.vue', import.meta.url), 'utf8')
const loudnessDialog = readFileSync(
  new URL('./library-loudness/LibraryLoudnessDialog.vue', import.meta.url),
  'utf8'
)
const streamingStage = readFileSync(
  new URL('./streaming-page/StreamingDetailStage.css', import.meta.url),
  'utf8'
)
const themeStudioCss = readFileSync(
  new URL('./theme-studio/ThemeStudioPage.css', import.meta.url),
  'utf8'
)
const streamingSearch = readFileSync(new URL('./StreamingSearch.vue', import.meta.url), 'utf8')
const ncmCloud = readFileSync(new URL('./NcmCloudPanel.vue', import.meta.url), 'utf8')
const dspStudio = readFileSync(
  new URL('./dsp-rack/DspStudio.css', import.meta.url),
  'utf8'
)
const dspWorkbench = readFileSync(
  new URL('./dsp-rack/DspWorkbench.css', import.meta.url),
  'utf8'
)
const trackSourcePicker = readFileSync(new URL('./TrackSourcePicker.vue', import.meta.url), 'utf8')
const playlistLibrary = readFileSync(
  new URL('./navigation/PlaylistLibraryPage.vue', import.meta.url),
  'utf8'
)
const soundFieldHomeCss = readFileSync(
  new URL('./local-dashboard/SoundFieldHome.css', import.meta.url),
  'utf8'
)

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `expected a rule for ${selector}`)
  return match[1]
}

test('base.css owns the unified control token contract', () => {
  for (const token of [
    '--te-control-radius-sm',
    '--te-control-radius-md',
    '--te-control-radius-lg',
    '--te-control-radius-pill',
    '--te-control-height-sm',
    '--te-control-height-md',
    '--te-control-height-lg',
    '--te-control-height-field',
    '--te-control-pad-x-sm',
    '--te-control-pad-x-md',
    '--te-control-gap',
    '--te-control-focus-color',
    '--te-control-accent',
    '--te-control-danger',
    '--te-switch-width',
    '--te-switch-height',
    '--te-switch-thumb',
    '--te-switch-travel',
    '--te-badge-radius',
    '--te-badge-pad-x'
  ]) {
    assert.match(base, new RegExp(`${token}:`), `base.css must define ${token}`)
  }
  assert.match(base, /--te-dialog-radius:\s*8px;/)
})

test('switch families share one geometry contract', () => {
  for (const [name, style] of [
    ['.toggle-switch', settings],
    ['.deck-switch', hiFiSidebar],
    ['.onb-toggle', onboarding],
    ['.appearance-layer-enable input', appearanceLayers],
    ['.switch', pluginPage],
    ['.online-search-toggle-track', songListCss]
  ] as const) {
    const block = rule(style, name)
    assert.match(block, /--te-switch-width/, `${name} must use --te-switch-width`)
    assert.match(block, /--te-switch-height/, `${name} must use --te-switch-height`)
    assert.match(block, /--te-control-radius-pill/, `${name} must use the shared pill radius`)
  }
  // Knob geometry travels on the same tokens in every family.
  assert.match(rule(settings, '.toggle-switch::after'), /--te-switch-thumb/)
  assert.match(rule(hiFiSidebar, '.deck-switch-knob'), /--te-switch-thumb/)
  assert.match(rule(onboarding, '.onb-toggle::after'), /--te-switch-thumb/)
  assert.match(
    rule(appearanceLayers, '.appearance-layer-enable input::before'),
    /--te-switch-thumb/
  )
  assert.match(rule(pluginPage, '.switch::after'), /--te-switch-thumb/)
  assert.match(rule(pluginPage, '.switch.on::after'), /--te-switch-travel/)
  assert.match(
    rule(appearanceLayers, '.appearance-layer-enable input:checked::before'),
    /--te-switch-travel/
  )
  assert.match(rule(songListCss, '.online-search-toggle-track::after'), /--te-switch-thumb/)
  assert.match(
    rule(songListCss, '.online-search-toggle input:checked + .online-search-toggle-track::after'),
    /--te-switch-travel/
  )
  assert.match(
    rule(songListCss, '.online-search-toggle input:focus-visible + .online-search-toggle-track'),
    /--te-control-focus-color/
  )
})

test('button, pill and badge families consume control tokens', () => {
  const pill = rule(settings, '.pill-action')
  assert.match(pill, /--te-control-height-sm/)
  assert.match(pill, /--te-control-radius-sm/)
  assert.match(pill, /--te-control-accent/)

  const networkPill = rule(networkSources, '.pill-action')
  assert.match(networkPill, /--te-control-height-sm/)
  assert.match(networkPill, /--te-control-radius-sm/)

  const pluginBadge = rule(pluginPage, '.badge')
  assert.match(pluginBadge, /--te-badge-font-size/)
  assert.match(pluginBadge, /--te-badge-radius/)

  const radioBadge = rule(radioPodcast, '.badge')
  assert.match(radioBadge, /--te-badge-radius/)
  assert.match(radioBadge, /--te-badge-pad-x/)

  const primary = rule(base, '.primary-button')
  assert.match(primary, /--te-control-accent/)
  assert.match(primary, /--te-control-radius-md/)
})

test('playlist card icon actions use the shared square small-control hit area', () => {
  const match = playlistLibrary.match(/\.card-actions button\{([^}]*)\}/)
  assert.ok(match, 'expected the playlist card action button rule')
  assert.match(match[1], /width:\s*var\(--te-control-height-sm\)/)
  assert.match(match[1], /height:\s*var\(--te-control-height-sm\)/)
  assert.match(match[1], /min-height:\s*var\(--te-control-height-sm\)/)
  assert.match(match[1], /padding:\s*0/)
})

test('queue playlist row icon actions use the shared square small-control size', () => {
  const actions = rule(playbackQueueDrawerCss, '.playlist-row-actions button')
  assert.match(actions, /width:\s*var\(--te-control-height-sm\)/)
  assert.match(actions, /height:\s*var\(--te-control-height-sm\)/)
  assert.match(actions, /border-radius:\s*999px/)
  assert.match(actions, /padding:\s*0/)
})

test('dialog surfaces derive their radius from the single dialog token', () => {
  for (const [name, source] of [
    ['.import-dialog', importDialog],
    ['.track-info-dialog', trackInfoDialog],
    ['.queue-workspace', queueWorkspace]
  ] as const) {
    assert.match(
      rule(source, name),
      /border-radius:\s*var\(--te-dialog-radius\)/,
      `${name} must use var(--te-dialog-radius)`
    )
  }
})

test('radio station actions use the shared standard button height', () => {
  const button = rule(radioPodcast, '.station-actions button')
  assert.match(button, /min-height:\s*var\(--te-control-height-md\)/)
})

test('native radio groups share a font-scaled size and keep their circular rendering', () => {
  for (const [name, source, selector] of [
    ['NCM album filter', ncmAlbumFilters, 'input'],
    ['loudness analysis', loudnessDialog, ".loudness-options input[type='radio']"]
  ] as const) {
    const block = rule(source, selector)
    assert.match(block, /width:\s*1\.05em/, `${name} radio width follows its label size`)
    assert.match(block, /height:\s*1\.05em/, `${name} radio height follows its label size`)
    assert.doesNotMatch(block, /appearance:\s*none/, `${name} radio remains native and circular`)
  }
})

test('library filter checkboxes inherit theme-aware shared control colors', () => {
  const toggle = rule(songListCss, '.library-filter-toggle')
  assert.match(toggle, /background:\s*var\(--te-control-bg\)/)
  assert.match(
    toggle,
    /border:\s*var\(--te-control-border-width\)\s+solid\s+var\(--te-control-border\)/
  )
  assert.match(
    rule(songListCss, '.library-view-controls .library-filter-toggle'),
    /color:\s*var\(--te-control-fg\)/
  )
  assert.match(
    rule(songListCss, '.library-filter-toggle input'),
    /accent-color:\s*var\(--te-control-accent\)/
  )
})

test('custom song checkboxes scale while keeping the cover column aligned', () => {
  const hitArea = rule(songListCss, '.track-select-checkbox')
  assert.match(hitArea, /width:\s*max\(1\.2em, 18px\)/)
  assert.match(hitArea, /height:\s*max\(1\.2em, 18px\)/)
  const box = rule(songListCss, '.track-select-box')
  assert.match(box, /width:\s*max\(1\.05em, 16px\)/)
  assert.match(box, /height:\s*max\(1\.05em, 16px\)/)
  assert.match(
    rule(songListCss, '.track-cover-cell.has-selection'),
    /width:\s*calc\(52px \+ max\(1\.2em, 18px\) \+ 6px\)/
  )
  assert.match(
    rule(
      songListCss,
      '.track-table:has(.track-cover-cell.has-selection) .col-cover,\n.track-table:has(.track-cover-cell.has-selection) .col-cover-header'
    ),
    /width:\s*calc\(80px \+ max\(1\.2em, 18px\) \+ 6px\)/
  )
})

test('custom song selection forwards keyboard focus to its visible checkbox', () => {
  const focus = rule(songListCss, '.track-select-checkbox input:focus-visible + .track-select-box')
  assert.match(focus, /--te-control-focus-width/)
  assert.match(focus, /--te-control-focus-color/)
  assert.match(focus, /--te-control-focus-offset/)
})

test('appearance navigation checkboxes inherit font-scaled shared dimensions', () => {
  const local = rule(appearanceChrome, '.appearance-chrome-page > input')
  assert.doesNotMatch(local, /\b(?:width|height)\s*:/)
  const shared = rule(base, "html input[type='checkbox']")
  assert.match(shared, /width:\s*1\.05em/)
  assert.match(shared, /height:\s*1\.05em/)
})

test('appearance navigation checkboxes preserve the editor accent when checked and focused', () => {
  const checked = rule(
    appearanceChrome,
    ".appearance-chrome-page > input[type='checkbox']:checked"
  )
  assert.match(checked, /border-color:\s*var\(--te-editor-accent/)
  assert.match(checked, /background-color:\s*var\(--te-editor-accent/)
  const focus = rule(
    appearanceChrome,
    ".appearance-chrome-page > input[type='checkbox']:focus-visible"
  )
  assert.match(focus, /outline-color:\s*var\(--te-editor-accent/)
})

test('theme studio checkboxes follow text scaling and keep the primary accent', () => {
  const checkbox = rule(themeStudioCss, ".studio-setting-row input[type='checkbox']")
  assert.match(checkbox, /width:\s*1\.05em/)
  assert.match(checkbox, /height:\s*1\.05em/)
  assert.match(checkbox, /accent-color:\s*var\(--te-primary-500\)/)
})

test('SoundField compact transport buttons share the small square size', () => {
  const rules = [...soundFieldHomeCss.matchAll(/\.sf-transport-buttons \.sf-icon-button\s*\{([^}]*)\}/g)]
  assert.equal(rules.length, 2, 'both narrow viewport and container rules stay covered')
  for (const match of rules) {
    assert.match(match[1], /width:\s*var\(--te-control-height-sm\)/)
    assert.match(match[1], /height:\s*var\(--te-control-height-sm\)/)
  }
})

test('track source picker close button uses the shared square icon size', () => {
  const close = rule(trackSourcePicker, '.source-picker header > .close')
  assert.match(close, /width:\s*var\(--te-control-height-md\)/)
  assert.match(close, /height:\s*var\(--te-control-height-md\)/)
  assert.match(close, /display:\s*inline-flex/)
  assert.match(close, /justify-content:\s*center/)
})

test('DSP compact icon buttons use the small square control token', () => {
  const buttons = [
    rule(dspWorkbench, '.audio-workspace .icon-button.small'),
    rule(dspStudio, '.audio-workspace .signal-scope button')
  ]
  for (const button of buttons) {
    for (const property of ['width', 'height', 'min-height']) {
      assert.match(button, new RegExp(`${property}:\\s*var\\(--te-control-height-sm\\)`))
    }
  }
})

test('DSP narrow window action uses a square shared icon size', () => {
  const mobileRule = dspStudio.match(
    /@media \(max-width: 620px\) \{[\s\S]*?\.audio-workspace \.workspace-header > \.toolbar > button:last-child\s*\{([^}]*)\}/
  )
  assert.ok(mobileRule, 'expected the narrow DSP window action rule')
  for (const property of ['width', 'height', 'min-height']) {
    assert.match(mobileRule[1], new RegExp(`${property}:\\s*var\\(--te-control-height-md\\)`))
  }
})

test('external playlist overwrite checkbox keeps shared geometry outside generic field padding', () => {
  const fieldRules = [...externalPlaylistImportDialog.matchAll(/input,select\{([^}]*)\}/g)]
  assert.ok(fieldRules.some((match) => /padding:10px 12px/.test(match[1])))
  const checkbox = externalPlaylistImportDialog.match(/\.overwrite input\{([^}]*)\}/)
  assert.ok(checkbox, 'expected a scoped overwrite checkbox rule')
  assert.match(checkbox[1], /width:1\.05em/)
  assert.match(checkbox[1], /height:1\.05em/)
  assert.match(checkbox[1], /padding:0/)
  assert.match(checkbox[1], /flex:0 0 auto/)
})

test('lyrics row checkboxes scale, use the local accent, and avoid double disabled dimming', () => {
  const checkbox = rule(lyricsManagerPanel, '.lyric-voice-row input')
  assert.match(checkbox, /font-size:\s*inherit/)
  assert.match(checkbox, /width:\s*max\(1\.05em, 14px\) !important/)
  assert.match(checkbox, /height:\s*max\(1\.05em, 14px\) !important/)
  assert.match(checkbox, /padding:\s*0/)
  const checked = rule(lyricsManagerPanel, '.lyric-voice-row input:checked')
  assert.match(checked, /border-color:\s*var\(--d-accent\)/)
  assert.match(checked, /background-color:\s*var\(--d-accent\)/)
  assert.match(rule(lyricsManagerPanel, '.lyric-voice-row input:disabled'), /opacity:\s*1/)
})

test('music version checkboxes opt out of generic form padding', () => {
  const checkbox = rule(musicVersionsPanel, "input[type='checkbox']")
  assert.match(checkbox, /padding:\s*0/)
  assert.match(checkbox, /margin-right:\s*8px/)
})
test('device profile checkboxes opt out of generic field padding', () => {
  const sharedFieldRule = rule(audioDeviceProfileEditor, 'input,\nselect,\nbutton')
  assert.match(sharedFieldRule, /padding:\s*8px/)
  assert.match(
    rule(audioDeviceProfileEditor, ".profile-editor input[type='checkbox']"),
    /padding:\s*0/,
    'checkboxes keep the shared square control geometry'
  )
})

test('appearance zoom icon actions use the square standard control size', () => {
  const controls = rule(
    backgroundAppearanceCustomizerCss,
    '.appearance-editor .appearance-zoom-tools button'
  )
  assert.match(controls, /min-height:\s*32px/)
  assert.match(controls, /padding:\s*6px 8px/)
  const iconButton = rule(
    backgroundAppearanceCustomizerCss,
    '.appearance-editor .appearance-zoom-tools .appearance-zoom-button'
  )
  assert.match(iconButton, /width:\s*var\(--te-control-height-md\)/)
  assert.match(iconButton, /height:\s*var\(--te-control-height-md\)/)
  assert.match(iconButton, /min-width:\s*var\(--te-control-height-md\)/)
  assert.match(iconButton, /min-height:\s*var\(--te-control-height-md\)/)
  assert.match(iconButton, /padding:\s*0/)
})

test('notification icon button has one effective square size', () => {
  const rules = [...noticeHost.matchAll(/\.notice-icon-button\s*\{([^}]*)\}/g)].map(
    (match) => match[1]
  )
  assert.equal(rules.length, 2)
  assert.doesNotMatch(rules[0], /(?:flex-basis|width|height)\s*:/)
  assert.match(rules[1], /flex-basis:\s*32px/)
  assert.match(rules[1], /width:\s*32px/)
  assert.match(rules[1], /height:\s*32px/)
})

test('secondary control families snap to the shared scale', () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ['player icon button', playerBarCss, '.icon-btn', /--te-control-height-md/],
    ['library selection button', songListCss, '.selection-btn', /--te-control-radius-sm/],
    ['streaming stage button', streamingStage, '.stage-btn', /--te-control-height-lg/],
    ['streaming mini button', streamingStage, '.stage-mini-btn', /--te-control-height-sm/],
    ['deck button', hiFiSidebar, '.deck-btn', /--te-control-radius-md/],
    ['studio icon button', themeStudioCss, '.studio-icon-button', /--te-control-height-md/],
    ['song list menu item', songListCss, '.menu-item', /--te-control-height-md/],
    ['pager button', streamingSearch, '.pager-btn', /--te-control-radius-sm/],
    ['cloud button', ncmCloud, '.cloud-button', /--te-control-radius-pill/],
    ['settings preset button', settings, '.preset-btn', /--te-control-height-md/]
  ]
  for (const [label, source, selector, pattern] of cases) {
    assert.match(
      rule(source, selector),
      pattern,
      `${label} (${selector}) must use the shared control scale`
    )
  }
})
