import copy
import json
from pathlib import Path

import click
import pytest
from click.testing import CliRunner

from cli_anything.twilightecho.twilightecho_cli import cli, source_payload, option_type
from cli_anything.twilightecho.utils.twilightecho_backend import Backend, BackendError
from cli_anything.twilightecho.core.analysis import interval_result


def endpoint(tmp_path, **changes):
    data = {'protocolVersion':1,'url':'http://127.0.0.1:12345/v1','token':'a'*64}
    data.update(changes)
    (tmp_path/'agent-endpoint.json').write_text(json.dumps(data),encoding='utf-8')
    return Backend(tmp_path)


def test_discovery_requires_real_backend(tmp_path):
    with pytest.raises(BackendError,match='No Twilight Echo'):
        Backend(tmp_path).discovery()


def test_discovery_local_endpoint(tmp_path):
    assert endpoint(tmp_path).discovery()['url'].startswith('http://127.0.0.1:')


@pytest.mark.parametrize('url',['https://127.0.0.1:123/v1','http://example.com:123/v1','http://user@127.0.0.1:123/v1','http://127.0.0.1:123/v1?token=bad','http://127.0.0.1:123/v2'])
def test_discovery_rejects_remote_or_ambiguous_urls(tmp_path,url):
    with pytest.raises(BackendError) as error:
        endpoint(tmp_path,url=url).discovery()
    assert error.value.code == 'INVALID_ENDPOINT'
    assert 'a'*64 not in str(error.value)


@pytest.mark.parametrize('changes',[{'token':'secret'},{'protocolVersion':9},{'token':None}])
def test_discovery_rejects_invalid_protocol_or_credential(tmp_path,changes):
    with pytest.raises(BackendError): endpoint(tmp_path,**changes).discovery()


def test_every_manifest_operation_has_a_command():
    manifest=json.loads((Path(__file__).parents[1]/'commands.json').read_text(encoding='utf-8'))
    from cli_anything.twilightecho.twilightecho_cli import kebab
    for operation in manifest['operations']:
        command=cli
        for part in operation['name'].split('.'):
            command=command.commands[kebab(part)]
        assert operation['name'] in command.help


@pytest.mark.parametrize('args,operation,payload',[
    (['playback','control','--payload','{"kind":"pause"}'],'playback.control',{'kind':'pause'}),
    (['study','state','--limit','12'],'study.state',{'limit':12}),
    (['call','settings.state'],'settings.state',{})])
def test_dry_run_never_needs_backend(tmp_path,args,operation,payload):
    result=CliRunner().invoke(cli,['--json','--profile',str(tmp_path),'--dry-run',*args])
    assert result.exit_code == 0,result.output
    assert json.loads(result.output)['value']=={'dryRun':True,'operation':operation,'payload':payload}


def test_schema_types():
    assert option_type({'type':'boolean'}) is click.BOOL
    assert option_type({'type':'number'}) is click.FLOAT
    assert isinstance(option_type({'anyOf':[{'type':'string','const':'one'},{'type':'string','const':'two'}]}),click.Choice)


@pytest.mark.parametrize('stages',['','six,six','made-up'])
def test_stages_fail_before_sending(stages):
    with pytest.raises(BackendError): source_payload(None,None,'current',None,stages)


def test_source_exactly_one():
    with pytest.raises(BackendError): source_payload('file','12',None,None,'six')


def test_batch_partial_failure_preserves_order(tmp_path,monkeypatch):
    monkeypatch.setattr(Backend,'call',lambda self,operation,payload:{'id':'real-submit-contract'})
    manifest=tmp_path/'batch.json'
    manifest.write_text(json.dumps([{'songId':'current','stages':['six']},{'unexpected':True},None]),encoding='utf-8')
    result=CliRunner().invoke(cli,['--json','music','batch',str(manifest)])
    assert result.exit_code == 1
    value=json.loads(result.output)['value']
    assert [item['index'] for item in value['items']]==[0,1,2]
    assert value['succeeded']==1 and value['failed']==2


@pytest.mark.parametrize('item',[{'file':123},{'songId':'current','stages':[1]},{'songId':'current','stages':None}])
def test_batch_malformed_items_are_reported_not_crashed(tmp_path,item):
    manifest=tmp_path/'batch.json';manifest.write_text(json.dumps([item]),encoding='utf-8')
    result=CliRunner().invoke(cli,['--json','--dry-run','music','batch',str(manifest)])
    assert result.exit_code==1
    value=json.loads(result.output)['value']
    assert value['failed']==1 and value['items'][0]['error']['code']=='INVALID_INPUT'


def test_interval_preserves_native_notes_and_clips_chords():
    original={'id':'x','status':'completed','result':{'duration':20,'chords':{'segments':[{'start':0,'end':10,'label':'C'},{'start':10,'end':20,'label':'G'}]},'melody':{'notes':[{'start':2,'end':7,'midi':60},{'start':15,'end':16,'midi':67}],'scores':[{'svg':'large'}]}}}
    before=copy.deepcopy(original)
    sliced=interval_result(original,4,12)
    assert original == before
    assert sliced['result']['chords']['segments'][0]['start']==4
    assert sliced['result']['chords']['segments'][-1]['end']==12
    assert len(sliced['result']['melody']['notes'])==1
    assert sliced['result']['melody']['notes'][0]['start']==2
    assert 'scores' not in sliced['result']['melody']


@pytest.mark.parametrize('start,end',[(5,2),(-1,2),(0,float('nan'))])
def test_interval_invalid_ranges(start,end):
    with pytest.raises(ValueError): interval_result({'result':{'duration':20}},start,end)


def test_wait_handles_real_job_states(monkeypatch):
    states=iter([{'status':'queued'},{'status':'running'},{'status':'completed','id':'a'}])
    monkeypatch.setattr(Backend,'call',lambda *args:next(states))
    assert Backend().wait_job('a',interval=0)['id']=='a'


@pytest.mark.parametrize('status',['failed','cancelled','interrupted'])
def test_wait_failure_is_not_success(monkeypatch,status):
    monkeypatch.setattr(Backend,'call',lambda *args:{'status':status,'error':'native failure'})
    with pytest.raises(BackendError,match='native failure'): Backend().wait_job('a',interval=0)
