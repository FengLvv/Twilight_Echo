"""Real application tests: require an isolated, prepared profile and installed CLI.

No mocked provider, renderer, audio worker or engraving substitutes are used here.
"""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import pytest


def _resolve_cli(name):
    command=shutil.which(name)
    if command:
        print('Installed CLI:',command)
        return [command]
    if os.environ.get('CLI_ANYTHING_FORCE_INSTALLED')=='1':
        pytest.fail('Installed command is required: '+name)
    return [os.sys.executable,'-m','cli_anything.twilightecho']


@pytest.fixture(scope='module')
def real():
    profile=Path(os.environ['TWILIGHT_ECHO_TEST_PROFILE']).resolve()
    project=os.environ['TWILIGHT_ECHO_TEST_PROJECT']
    executable=os.environ['TWILIGHT_ECHO_TEST_EXE']
    output=profile/'cli-test-output';output.mkdir(exist_ok=True)
    command=_resolve_cli('cli-anything-twilightecho')
    def run(*args,ok=True,timeout=180):
        process=subprocess.run(command+['--json','--profile',str(profile),'--timeout','150',*args],cwd=tempfile.gettempdir(),capture_output=True,text=True,encoding='utf-8',timeout=timeout)
        value=json.loads(process.stdout)
        if ok:
            assert process.returncode==0,(process.returncode,value,process.stderr)
            assert value['ok'],value
        return value
    run('app','start','--executable',executable)
    return {'run':run,'profile':profile,'id':project,'output':output}


class TestCLISubprocess:
    def test_doctor_is_live_and_does_not_print_credentials(self,real):
        value=real['run']('doctor')['value']
        assert value['snapshot']['phase']=='ready'
        assert 'token' not in value
        assert value['pid']>0

    def test_complete_live_registry_and_describe(self,real):
        ops=real['run']('capabilities','--compact')['value']['operations']
        manifest=json.loads((Path(__file__).parents[1]/'commands.json').read_text(encoding='utf-8'))
        assert {o['name'] for o in manifest['operations']} <= {o['name'] for o in ops}
        assert len(manifest['operations'])>=387
        schema=real['run']('describe','study.submit')['value']
        assert 'stages' in schema['inputSchema']['properties']

    @pytest.mark.parametrize('operation',['state.snapshot','settings.state','audio.dsp','plugins.list','providers.list','player.lyrics','queue.page','catalog.status'])
    def test_representative_domains(self,real,operation):
        # Use exact schemas for paging surfaces rather than guessing GUI input.
        payload={}
        if operation=='queue.page':
            snapshot=real['run']('doctor')['value']['snapshot']
            if not snapshot.get('queue'):
                operation='workspace.state'
            else:
                queue=snapshot['queue'];payload={'id':queue['id'],'revision':queue['revision'],'offset':0,'limit':10}
        real['run']('call',operation,'--payload',json.dumps(payload))

    def test_volume_and_settings_round_trip(self,real):
        run=real['run']
        before=run('doctor')['value']['snapshot']['playback']['volume']
        try:
            run('playback','volume','--volume','0.23')
            assert run('doctor')['value']['snapshot']['playback']['volume']==pytest.approx(.23)
        finally:run('playback','volume','--volume',str(before))
        # Volume persistence is debounced by Core; flush its owned lane before
        # obtaining the revision for a separate settings transaction.
        run('lifecycle','flush')
        state=run('settings','state')['value'];old=state['settings']['closeToTray']
        try:
            run('settings','edit','--payload',json.dumps({'revision':state['revision'],'patch':{'closeToTray':not old}}))
            assert run('settings','state')['value']['settings']['closeToTray'] is not old
        finally:
            latest=run('settings','state')['value']
            run('settings','edit','--payload',json.dumps({'revision':latest['revision'],'patch':{'closeToTray':old}}))

    def test_catalog_query_and_dsp_status(self,real):
        value=real['run']('catalog','query','--kind','recording','--limit','10')['value']
        assert isinstance(value['items'],list)
        assert isinstance(value['revision'],int)
        real['run']('audio','dsp','status')

    def test_queue_playback_lyrics_and_dsp_round_trip(self,real):
        run=real['run']
        begin=run('queue','submit','--payload',json.dumps({'kind':'begin','selectedIndex':0,'position':3,'play':False}))['value']
        run('queue','submit','--payload',json.dumps({'kind':'append','id':begin['id'],'sequence':1,'items':[{'kind':'local','id':'rhythm-qinghuaci'}]}))
        committed=run('queue','submit','--payload',json.dumps({'kind':'commit','id':begin['id'],'sequence':2}))['value']
        assert committed['state']=='committed'
        snapshot=run('doctor')['value']['snapshot']
        assert snapshot['track']['id']=='rhythm-qinghuaci'
        queue=snapshot['queue']
        page=run('queue','page','--payload',json.dumps({'id':queue['id'],'revision':queue['revision'],'offset':0,'limit':10}))['value']
        assert page['total']==1
        lyrics=run('lyrics','state')['value']
        assert lyrics['current']['trackId']=='rhythm-qinghuaci'
        dsp=run('audio','dsp')['value'];enabled=bool((dsp.get('autoPreamp') or {}).get('enabled',False))
        try:
            run('audio','dsp','edit','--payload',json.dumps({'revision':dsp['revision'],'edit':{'kind':'autoPreamp','enabled':not enabled}}))
            assert run('audio','dsp')['value']['autoPreamp']['enabled'] is not enabled
        finally:
            fresh=run('audio','dsp')['value']
            run('audio','dsp','edit','--payload',json.dumps({'revision':fresh['revision'],'edit':{'kind':'autoPreamp','enabled':enabled}}))

    def test_real_interval_and_native_artifacts(self,real):
        value=real['run']('music','result','--id',real['id'],'--from','45','--to','75')['value']
        assert value['result']['melody']['notes']
        assert value['result']['chords']['segments']
        assert value['tonality']['degrees']
        assert all(45<=c['start']<c['end']<=75 for c in value['result']['chords']['segments'])
        assert all(n['end']>45 and n['start']<75 for n in value['result']['melody']['notes'])
        files=real['run']('music','artifacts','--id',real['id'])['value']['files']
        assert any(f['path'].endswith('vocals.wav') and f['bytes']>1000 for f in files)

    @pytest.mark.parametrize('notation',['staff','numbered'])
    def test_native_score_pdf_svg_and_note_identity(self,real,notation):
        run=real['run']
        source=run('music','result','--id',real['id'])['value']
        before=json.dumps(source['result'],sort_keys=True)
        value=run('music','export','--id',real['id'],'--directory',str(real['output']),'--notation',notation)['value']
        print('Native score:',value['pdf'])
        assert Path(value['pdf']).read_bytes().startswith(b'%PDF-')
        manifest=json.loads(Path(value['manifest']).read_text(encoding='utf-8'))
        assert len(manifest['rows'])==len(source['result']['melody']['scores'])
        assert len(manifest['notes'])==len(source['result']['melody']['notes'])
        assert manifest['key']['mode'] in ('major','minor')
        for row in manifest['rows']:
            svg=ET.fromstring(Path(row['path']).read_text(encoding='utf-8'))
            assert svg.tag.endswith('svg')
            assert ''.join(svg.itertext()).strip()
        source_files=list((Path(value['directory'])/'source').glob('*'))
        assert any(p.suffix=='.mid' for p in source_files)
        assert any(p.suffix=='.musicxml' for p in source_files)
        assert not any('.layout.musicxml' in p.name for p in source_files)
        assert json.dumps(run('music','result','--id',real['id'])['value']['result'],sort_keys=True)==before

    def test_real_preview_capture_and_latest(self,real):
        args=['--id',real['id'],'--directory',str(real['output']/'previews')]
        preview=real['run']('preview','capture',*args)['value']
        assert preview['protocol_version']=='preview-bundle/v1'
        latest=real['run']('preview','latest',*args)['value']
        assert latest['bundle_id']==preview['bundle_id']
        assert Path(latest['_manifest_path']).is_file()

    def test_fresh_six_analysis_and_batch_do_not_change_playback(self,real):
        run=real['run']
        media=Path(os.environ['TWILIGHT_ECHO_TEST_MEDIA']).resolve()
        before=run('doctor')['value']['snapshot']
        manifest=real['profile']/'batch-test.json'
        manifest.write_text(json.dumps([{'file':str(media),'stages':['six']},{'file':str(media),'stages':['six']}]),encoding='utf-8')
        value=run('music','batch',str(manifest),'--wait','--wait-timeout','240',timeout=300)['value']
        assert value['succeeded']==2 and value['failed']==0
        assert [p['index'] for p in value['items']]==[0,1]
        job=value['items'][0]['value']
        assert job['status']=='completed' and job['sixReady']
        assert not job['twoSingers'] and not job['leadBacking']
        assert not job['chordsReady']
        assert job['id']==value['items'][1]['value']['id']
        after=run('doctor')['value']['snapshot']
        assert after['track']==before['track']
        assert after['queue']==before['queue']
        result=run('music','export-stems','--id',job['id'],'--directory',str(real['output']),'--stems','vocals','--audio-format','wav')['value']
        audio=Path(result)/'vocals.wav'
        assert audio.read_bytes()[:4] in (b'RIFF',b'RF64')
        assert audio.stat().st_size>10000

    def test_fresh_vocal_lyrics_chords_and_score_workflow(self,real):
        run=real['run']
        media=Path(os.environ['TWILIGHT_ECHO_TEST_VOCAL_MEDIA']).resolve()
        identity='agent-file:'+hashlib.sha256(str(media).lower().encode('utf-8')).hexdigest()
        existing=run('study','song','--song-id',identity)['value']
        if existing:
            # Only this explicitly supplied test media's disposable project.
            run('study','delete','--id',existing['id'])
        before=run('doctor')['value']['snapshot']
        job=run('music','analyze','--file',str(media),'--stages','six,chords,melody','--wait','--wait-timeout','240',timeout=300)['value']
        assert job['sixReady'] and job['chordsReady']
        assert job['result']['melody']['notes']
        assert job['result']['melody']['scores']
        assert all(job['stages'][stage]['status']=='completed' for stage in ('six','chords','melody'))
        assert not job['twoSingers'] and not job['leadBacking']
        after=run('doctor')['value']['snapshot']
        assert after['track']==before['track'] and after['queue']==before['queue']
        sliced=run('music','result','--id',job['id'],'--from','2','--to','15')['value']
        assert sliced['result']['melody']['notes'] and sliced['tonality']['degrees']
        exported=run('music','export','--id',job['id'],'--directory',str(real['output']),'--notation','staff')['value']
        assert Path(exported['pdf']).read_bytes().startswith(b'%PDF-')
        print('Fresh job:',job['id'],'notes:',len(job['result']['melody']['notes']),'stages:',job['stages'])

    def test_json_errors_and_headless_picker_boundary(self,real):
        value=real['run']('call','not.real',ok=False)
        assert value['ok'] is False and value['error']['code']=='NOT_FOUND'
        value=real['run']('study','choose-pack',ok=False)
        assert value['ok'] is False and value['error']['code']=='INTERACTIVE_REQUIRED'
