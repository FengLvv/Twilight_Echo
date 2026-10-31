from pathlib import Path
from cli_anything.twilightecho import __version__
from cli_anything.twilightecho.utils import preview_bundle as bundles


def capture(backend, project_id, directory, notation):
    value=backend.call('agent.music.context',{'id':project_id})
    fingerprint=bundles.fingerprint_data({'result':value.get('result'),'tonality':value.get('tonality')})
    bundle=bundles.prepare_bundle('twilightecho','score-'+notation,'capture',fingerprint,
        options={'id':project_id,'notation':notation},harness_version=__version__,root_dir=str(Path(directory)/project_id))
    if bundle['cached']:
        return bundle['manifest']
    exported=backend.call('agent.music.export',{'id':project_id,'directory':bundle['artifacts_dir'],'notation':notation,'key':'auto'})
    artifacts=[bundles.artifact_record(bundle['bundle_dir'],exported['pdf'],'score-pdf','primary','document','Native score PDF')]
    if exported['rows']:
        artifacts.append(bundles.artifact_record(bundle['bundle_dir'],exported['rows'][0]['path'],'first-row','hero','image','Native first score row'))
    artifacts.append(bundles.artifact_record(bundle['bundle_dir'],exported['manifest'],'score-data','data','data','Timed vocal notes and native score files'))
    return bundles.finalize_bundle(bundle['bundle_dir'],bundle['bundle_id'],'capture','twilightecho','score-'+notation,
        source={'project_id':project_id,'fingerprint':fingerprint},artifacts=artifacts,
        summary={'title':value['title'],'id':project_id,'notation':notation,'rows':len(exported['rows']),'export':exported},
        cache_key=bundle['cache_key'],generator={'name':'cli-anything-twilightecho','version':__version__})


def latest(project_id,directory,notation):
    return bundles.find_latest_manifest('twilightecho',recipe='score-'+notation,root_dir=str(Path(directory)/project_id))
