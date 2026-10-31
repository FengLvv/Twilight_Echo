import assert from 'node:assert/strict'
import test from 'node:test'
import { LibraryDatabase } from './libraryDatabase.ts'
import { removeObsoleteNcmLibrary } from './removeObsoleteNcmLibrary.ts'

test('retirement cancels orphaned automatic jobs while preserving explicit metadata demands', (t) => {
  const db = new LibraryDatabase(':memory:')
  t.after(() => db.close())
  db.replaceDocument({
    version: 2,
    revision: 1,
    tracks: [
      {
        id: 'imported',
        source: 'local',
        title: 'Original',
        artist: 'Artist',
        album: 'Album',
        filePath: 'D:/Music/a.flac'
      }
    ],
    folders: [],
    exclusions: []
  })
  while (db.catalogStatus().localPending) db.catalogAdvance(100)
  const source = db.sql.prepare('SELECT id,recording_id FROM catalog_sources LIMIT 1').get()!
  db.sql.prepare('DELETE FROM catalog_memberships WHERE source_id=?').run(source.id!)
  db.sql.exec(
    'CREATE TABLE ncm_library_state(payload TEXT); CREATE TABLE ncm_library_imports(source_id TEXT)'
  )
  db.sql.prepare('INSERT INTO ncm_library_imports VALUES(?)').run(source.id!)
  const schedule = db.sql
    .prepare('SELECT demand_id FROM metadata_identification_schedule WHERE entity_id=?')
    .get(source.recording_id!)!
  for (const id of ['automatic', 'explicit']) {
    const job = {
      id,
      entityId: source.recording_id,
      type: 'identify',
      state: 'queued',
      generation: 0,
      attempts: 0
    }
    db.sql
      .prepare('INSERT INTO metadata_jobs VALUES(?,?,?,?,?,?,?)')
      .run(id, id, source.recording_id!, 'queued', 0, 'input', JSON.stringify(job))
    db.sql.prepare('INSERT INTO metadata_demands VALUES(?,?)').run(id, schedule.demand_id!)
  }
  db.sql.prepare('INSERT INTO metadata_demands VALUES(?,?)').run('explicit', 'manual-request')
  removeObsoleteNcmLibrary(db.sql)
  const jobs = db.sql.prepare('SELECT id,state,payload FROM metadata_jobs ORDER BY id').all()
  assert.equal(jobs[0].state, 'cancelled')
  assert.equal(JSON.parse(String(jobs[0].payload)).state, 'cancelled')
  assert.equal(jobs[1].state, 'queued')
  assert.deepEqual(
    db.sql
      .prepare('SELECT * FROM metadata_demands')
      .all()
      .map((r) => ({ ...r })),
    [{ job_id: 'explicit', batch_id: 'manual-request' }]
  )
  assert.equal(
    db.sql
      .prepare('SELECT count(*) n FROM metadata_identification_schedule WHERE entity_id=?')
      .get(source.recording_id!)!.n,
    0
  )
})

test('removed NetEase import tables and trigger are retired without changing songs or explicit membership', (t) => {
  const db = new LibraryDatabase(':memory:')
  t.after(() => db.close())
  const track = {
    id: 'local:keep',
    source: 'local' as const,
    title: 'Manual title',
    artist: 'Artist',
    album: 'Album',
    filePath: 'D:/Music/keep.flac',
    duration: 60
  }
  db.replaceDocument({
    version: 2,
    revision: 1,
    tracks: [track as never],
    folders: ['D:/Music'],
    exclusions: []
  })
  while (db.catalogStatus().localPending) db.catalogAdvance(100)
  const source = db.sql
    .prepare('SELECT id,payload FROM catalog_sources WHERE track_id=?')
    .get(track.id)!
  db.sql.prepare("INSERT OR IGNORE INTO catalog_memberships VALUES('ncm:42',?)").run(source.id!)
  db.sql.exec(
    'CREATE TABLE ncm_library_state(payload TEXT); CREATE TABLE ncm_metadata_queue(source_id TEXT); CREATE TABLE ncm_recording_metadata(payload TEXT); CREATE TRIGGER ncm_new_library_member AFTER INSERT ON catalog_memberships BEGIN INSERT INTO ncm_metadata_queue VALUES(new.source_id); END;'
  )
  removeObsoleteNcmLibrary(db.sql)
  assert.equal(
    db.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'ncm_%'").get()!.n,
    0
  )
  assert.equal(
    db.sql.prepare("SELECT count(*) n FROM catalog_memberships WHERE owner LIKE 'ncm:%'").get()!.n,
    0
  )
  assert.equal(
    db.sql.prepare("SELECT count(*) n FROM catalog_memberships WHERE owner='local'").get()!.n,
    1
  )
  assert.deepEqual(
    db.sql.prepare('SELECT id,payload FROM catalog_sources WHERE track_id=?').get(track.id),
    source
  )
  assert.equal(db.getTracksByIds([track.id]).tracks[0].title, 'Manual title')
  const revision = db.catalogStatus().revision
  removeObsoleteNcmLibrary(db.sql)
  assert.equal(db.catalogStatus().revision, revision)
})
