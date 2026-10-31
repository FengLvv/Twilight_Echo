import type { DatabaseSync } from 'node:sqlite'

/** Retire the removed import feature without changing songs, queues or history. */
export function removeObsoleteNcmLibrary(sql: DatabaseSync): void {
  if (
    !sql
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name IN ('ncm_library_state','ncm_new_library_member') LIMIT 1"
      )
      .get()
  )
    return
  sql.exec('SAVEPOINT remove_obsolete_ncm_library')
  try {
    sql.exec('DROP TRIGGER IF EXISTS ncm_new_library_member')
    const removed = sql
      .prepare("DELETE FROM catalog_memberships WHERE owner LIKE 'ncm:%'")
      .run().changes
    if (sql.prepare("SELECT 1 FROM sqlite_master WHERE name='ncm_library_imports'").get()) {
      // The former import also created ordinary automatic-identification demands.
      // Retire only its now-unpublished entities; explicit demands still own jobs.
      sql.exec(`CREATE TEMP TABLE removed_ncm_entities AS
        SELECT DISTINCT b.entity_id FROM catalog_entity_sources b
        JOIN ncm_library_imports i ON i.source_id=b.source_id
        WHERE NOT EXISTS(SELECT 1 FROM catalog_entity_sources live JOIN catalog_memberships m
          ON m.source_id=live.source_id WHERE live.entity_id=b.entity_id);
        CREATE UNIQUE INDEX temp.removed_ncm_entity_id ON removed_ncm_entities(entity_id);
        CREATE TEMP TABLE removed_ncm_jobs AS SELECT DISTINCT d.job_id FROM metadata_demands d
          JOIN metadata_identification_schedule a ON a.demand_id=d.batch_id
          JOIN removed_ncm_entities e ON e.entity_id=a.entity_id;
        DELETE FROM metadata_demands WHERE batch_id IN (SELECT a.demand_id FROM metadata_identification_schedule a
          JOIN removed_ncm_entities e ON e.entity_id=a.entity_id);
        DELETE FROM metadata_identification_schedule WHERE entity_id IN (SELECT entity_id FROM removed_ncm_entities);`)
      sql
        .prepare(
          `UPDATE metadata_jobs SET state='cancelled',payload=json_set(payload,
        '$.state','cancelled','$.reason','not_library_member','$.generation',coalesce(json_extract(payload,'$.generation'),0)+1,'$.updatedAt',?)
        WHERE id IN (SELECT job_id FROM removed_ncm_jobs) AND state IN ('queued','retry_wait','running','blocked')
        AND NOT EXISTS(SELECT 1 FROM metadata_demands d WHERE d.job_id=metadata_jobs.id)`
        )
        .run(Date.now())
      sql.exec('DROP TABLE removed_ncm_jobs; DROP TABLE removed_ncm_entities')
    }
    for (const table of [
      'ncm_library_stage',
      'ncm_metadata_queue',
      'ncm_recording_bindings',
      'ncm_recording_metadata',
      'ncm_library_origins',
      'ncm_library_collections',
      'ncm_library_likes',
      'ncm_library_imports',
      'ncm_library_state'
    ])
      sql.exec(`DROP TABLE IF EXISTS ${table}`)
    if (removed)
      sql
        .prepare("UPDATE catalog_state SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
        .run()
    sql.exec('RELEASE remove_obsolete_ncm_library')
  } catch (error) {
    sql.exec('ROLLBACK TO remove_obsolete_ncm_library; RELEASE remove_obsolete_ncm_library')
    throw error
  }
}
