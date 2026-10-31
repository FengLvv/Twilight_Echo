import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StudyRecord, StudyRepository } from '../../core/audio/musicStudyService.ts'

/** One atomic row per project; worker checkpoints are separate immutable audio files. */
export function createStudyRepository(root: string): StudyRepository {
  mkdirSync(root, { recursive: true })
  const db = new DatabaseSync(join(root, 'projects.sqlite'))
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS study_projects (id TEXT PRIMARY KEY, data TEXT NOT NULL)'
  )
  db.exec(
    'CREATE TABLE IF NOT EXISTS study_preferences (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)'
  )
  const save = db.prepare(
    'INSERT INTO study_projects(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'
  )
  return {
    loadPreferences: async () => {
      const row = db.prepare('SELECT data FROM study_preferences WHERE id=1').get()
      return row ? JSON.parse(String(row.data)) : null
    },
    savePreferences: async (value) => {
      db.prepare(
        'INSERT INTO study_preferences(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'
      ).run(JSON.stringify(value))
    },
    list: async () =>
      db
        .prepare('SELECT data FROM study_projects ORDER BY rowid DESC')
        .all()
        .map((row) => JSON.parse(String(row.data)) as StudyRecord),
    save: async (record) => {
      save.run(record.id, JSON.stringify(record))
    },
    remove: async (id) => {
      db.prepare('DELETE FROM study_projects WHERE id=?').run(id)
    }
  }
}
