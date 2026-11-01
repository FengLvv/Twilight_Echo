import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import type { StudyRecord, StudyRepository } from '../../core/audio/musicStudyService.ts'

/** One canonical compressed blob per artifact; summaries never duplicate scores. */
export function createStudyRepository(root: string): StudyRepository {
  mkdirSync(root, { recursive: true })
  const db = new DatabaseSync(join(root, 'projects.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL;
    DROP TABLE IF EXISTS study_projects;
    CREATE TABLE IF NOT EXISTS analysis_projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_artifacts (project_id TEXT NOT NULL, kind TEXT NOT NULL,
      hash TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(project_id,kind));
    CREATE TABLE IF NOT EXISTS study_preferences (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);`)
  const save = db.prepare('INSERT INTO analysis_projects(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
  const blob = db.prepare('INSERT INTO analysis_artifacts(project_id,kind,hash,data) VALUES(?,?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET hash=excluded.hash,data=excluded.data')
  const hashes = db.prepare('SELECT kind,hash FROM analysis_artifacts WHERE project_id=?')
  const read = (id: string) => {
    const row = db.prepare('SELECT data FROM analysis_projects WHERE id=?').get(id)
    return row ? JSON.parse(String(row.data)) as StudyRecord : undefined
  }
  return {
    loadPreferences: async () => {
      const row = db.prepare('SELECT data FROM study_preferences WHERE id=1').get()
      return row ? JSON.parse(String(row.data)) : null
    },
    savePreferences: async value => {
      db.prepare('INSERT INTO study_preferences(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(value))
    },
    list: async () => db.prepare('SELECT data FROM analysis_projects ORDER BY rowid DESC').all()
      .map(row => ({ ...JSON.parse(String(row.data)), resultLoaded: false })),
    loadResult: async id => {
      const record = read(id)
      if (!record?.result) return undefined
      const result = record.result
      for (const row of db.prepare('SELECT kind,hash,data FROM analysis_artifacts WHERE project_id=? ORDER BY kind').all(id)) {
        const serialized = brotliDecompressSync(row.data as Uint8Array, { maxOutputLength: 32 * 1024 ** 2 })
        if (createHash('sha256').update(serialized).digest('hex') !== row.hash) throw new Error('分析结果校验失败')
        const value = JSON.parse(serialized.toString('utf8'))
        switch (row.kind) {
          case 'chords': result.chords = value; break
          case 'originalChords': result.originalChords = value; break
          case 'notes': result.melody = { ...value, scores: result.melody?.scores ?? [] }; break
          case 'score': if (result.melody) result.melody.scores = value; break
          case 'waveforms': result.waveforms = value; break
        }
      }
      return result
    },
    save: async record => {
      const { resultLoaded: _loaded, budgetBytes: _budget, ...base } = record
      const summary = structuredClone(base)
      const result = record.result
      const artifacts: Record<string, unknown> = {}
      if (result) {
        artifacts.chords = result.chords
        artifacts.originalChords = result.originalChords
        artifacts.waveforms = result.waveforms
        if (result.melody) {
          const { scores, ...notes } = result.melody
          artifacts.notes = notes; artifacts.score = scores
        }
        summary.result = { ...result, waveforms: {}, chords: { ...result.chords, segments: [] }, originalChords: { segments: [] },
          ...(result.melody ? { melody: { ...result.melody, notes: [], scores: [], reuse: undefined } } : {}) }
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        if (record.resultLoaded !== false) {
          const previous = new Map(hashes.all(record.id).map(row => [String(row.kind), String(row.hash)]))
          for (const [kind, value] of Object.entries(artifacts)) {
            const serialized = Buffer.from(JSON.stringify(value))
            const hash = createHash('sha256').update(serialized).digest('hex')
            if (previous.get(kind) !== hash)
              blob.run(record.id, kind, hash, brotliCompressSync(serialized, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }))
            previous.delete(kind)
          }
          for (const kind of previous.keys()) db.prepare('DELETE FROM analysis_artifacts WHERE project_id=? AND kind=?').run(record.id, kind)
        }
        save.run(record.id, JSON.stringify(summary))
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    resultBytes: async () => Number(db.prepare('SELECT coalesce(sum(length(data)),0) AS bytes FROM analysis_artifacts').get()!.bytes),
    remove: async id => {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('DELETE FROM analysis_artifacts WHERE project_id=?').run(id)
        db.prepare('DELETE FROM analysis_projects WHERE id=?').run(id)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    close: () => db.close()
  }
}
