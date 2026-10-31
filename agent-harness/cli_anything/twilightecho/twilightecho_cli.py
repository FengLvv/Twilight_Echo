import json
import re
import shlex
import sys
from pathlib import Path

import click
from cli_anything.twilightecho import __version__
from cli_anything.twilightecho.utils.twilightecho_backend import Backend, BackendError
from cli_anything.twilightecho.core.analysis import interval_result


def read_json(value):
    try:
        return json.loads(sys.stdin.read() if value == '-' else Path(value[1:]).read_text(encoding='utf-8') if value.startswith('@') else value)
    except (ValueError, OSError) as error:
        raise BackendError('INVALID_INPUT', str(error)) from None


def emit(ctx, value):
    if ctx.obj['json']:
        click.echo(json.dumps({'ok': True, 'value': value}, ensure_ascii=False, allow_nan=False))
    else:
        click.echo(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))


def invoke(ctx, operation, payload):
    if ctx.obj['dry_run']:
        return {'dryRun': True, 'operation': operation, 'payload': payload}
    return ctx.obj['backend'].call(operation, payload)


@click.group(invoke_without_command=True, context_settings={'help_option_names': ['-h', '--help']})
@click.option('--json', 'use_json', is_flag=True, help='Machine-readable JSON output on stdout.')
@click.option('--profile', type=click.Path(path_type=Path), help='Twilight Echo user-data directory.')
@click.option('--timeout', type=click.FloatRange(min=.1), default=60, show_default=True)
@click.option('--dry-run', is_flag=True, help='Show requests without sending mutations.')
@click.version_option(__version__)
@click.pass_context
def cli(ctx, use_json, profile, timeout, dry_run):
    """Operate the real Twilight Echo Core. Use describe OPERATION before unfamiliar calls."""
    ctx.obj = {'json': use_json, 'backend': Backend(profile, timeout), 'dry_run': dry_run, 'profile': profile, 'timeout': timeout}
    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


@cli.command()
@click.pass_context
def doctor(ctx):
    """Inspect the real application's availability without printing credentials."""
    emit(ctx, ctx.obj['backend'].status())


@cli.command()
@click.option('--domain')
@click.option('--compact', is_flag=True)
@click.pass_context
def capabilities(ctx, domain, compact):
    """Discover all application operations from the live Core registry."""
    value = ctx.obj['backend'].capabilities(domain)
    if compact:
        value = {'operations': [{key: operation[key] for key in ('name','kind') if key in operation} for operation in value['operations']]}
    emit(ctx, value)


@cli.command()
@click.argument('operation')
@click.pass_context
def describe(ctx, operation):
    """Read the input schema and behavior of a registered operation."""
    emit(ctx, ctx.obj['backend'].describe(operation))


@cli.command('call')
@click.argument('operation')
@click.option('--payload', default='{}', help='JSON, @file.json, or - for stdin.')
@click.pass_context
def raw_call(ctx, operation, payload):
    """Call an exact registered operation, including newly added backend operations."""
    value = read_json(payload)
    if not isinstance(value, dict):
        raise BackendError('INVALID_INPUT', 'Payload must be a JSON object')
    emit(ctx, invoke(ctx, operation, value))


@cli.group()
def app():
    """Start the real application or request a normal shutdown."""


@app.command('start')
@click.option('--executable', type=click.Path(exists=True, dir_okay=False))
@click.option('--headless/--visible', default=True)
@click.option('--wait-timeout', type=click.FloatRange(min=.1), default=60)
@click.pass_context
def app_start(ctx, executable, headless, wait_timeout):
    if ctx.obj['dry_run']:
        emit(ctx, {'dryRun':True, 'executable':executable, 'headless':headless, 'profile':str(ctx.obj['backend'].profile)})
    else:
        emit(ctx, ctx.obj['backend'].start(executable, headless, wait_timeout))


@app.command('stop')
@click.pass_context
def app_stop(ctx):
    """Save and quit through the application's normal shutdown flow."""
    emit(ctx, invoke(ctx, 'agent.app.quit', {}))


@cli.group()
def music():
    """Source-independent analysis, batch jobs, interval data and native scores."""


def source_payload(file, ncm_id, song_id, lyrics, stages):
    if not isinstance(stages,str) or any(value is not None and not isinstance(value,(str,Path)) for value in (file,song_id,lyrics)):
        raise BackendError('INVALID_INPUT','Source paths, songId and stages must be strings')
    if sum(bool(value) for value in (file, ncm_id, song_id)) != 1:
        raise BackendError('INVALID_INPUT', 'Choose exactly one of --file, --ncm-id or --song-id')
    request = {'stages': [stage.strip() for stage in stages.split(',') if stage.strip()]}
    allowed = {'six','chords','originalChords','melody','leadBacking','twoSingers'}
    if not request['stages'] or len(set(request['stages'])) != len(request['stages']) or not set(request['stages']) <= allowed:
        raise BackendError('INVALID_INPUT', 'Stages must be unique values from: '+', '.join(sorted(allowed)))
    if file: request['file'] = str(Path(file).expanduser().resolve())
    if ncm_id: request['ncmId'] = str(ncm_id)
    if song_id: request['songId'] = song_id
    if lyrics: request['lyrics'] = Path(lyrics).read_text(encoding='utf-8-sig')
    return request


@music.command('analyze')
@click.option('--file', type=click.Path(exists=True, dir_okay=False))
@click.option('--ncm-id')
@click.option('--song-id')
@click.option('--lyrics', type=click.Path(exists=True, dir_okay=False), help='Supplied timed LRC/TTML; no speech recognition.')
@click.option('--stages', default='six,chords,melody', show_default=True)
@click.option('--wait', 'wait_for_job', is_flag=True)
@click.option('--wait-timeout', default=3600, type=click.FloatRange(min=.1))
@click.pass_context
def analyze(ctx, file, ncm_id, song_id, lyrics, stages, wait_for_job, wait_timeout):
    """Queue requested analysis without replacing the playback selection."""
    value = invoke(ctx, 'agent.music.submit', source_payload(file,ncm_id,song_id,lyrics,stages))
    if wait_for_job and not ctx.obj['dry_run']: value = ctx.obj['backend'].wait_job(value['id'], wait_timeout)
    emit(ctx, value)


@music.command('batch')
@click.argument('manifest', type=click.Path(exists=True, dir_okay=False))
@click.option('--stages', default='six,chords,melody')
@click.option('--wait', 'wait_for_jobs', is_flag=True)
@click.option('--wait-timeout', default=3600, type=click.FloatRange(min=.1))
@click.option('--export-directory', type=click.Path(path_type=Path), help='Wait, then export each successful score through the native renderer.')
@click.option('--notation', type=click.Choice(['numbered','staff']), default='staff')
@click.pass_context
def batch(ctx, manifest, stages, wait_for_jobs, wait_timeout, export_directory, notation):
    """Submit a JSON array of sources; report every success or failure in order."""
    items = json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        raise BackendError('INVALID_INPUT', 'Batch manifest must be an array of 1..1000 items')
    results = []
    for index, item in enumerate(items):
        try:
            if not isinstance(item, dict): raise BackendError('INVALID_INPUT', 'Batch items must be objects')
            requested = item.get('stages', stages)
            if isinstance(requested, list):
                if not all(isinstance(stage,str) for stage in requested):
                    raise BackendError('INVALID_INPUT','Batch stages must be strings')
                requested = ','.join(requested)
            if set(item) - {'file','ncmId','songId','lyricsFile','stages'}:
                raise BackendError('INVALID_INPUT', 'Unknown batch item field')
            def relative_file(value):
                if value is not None and not isinstance(value,str):
                    raise BackendError('INVALID_INPUT','Batch file paths must be strings')
                return str(Path(manifest).resolve().parent / value) if value and not Path(value).is_absolute() else value
            payload = source_payload(relative_file(item.get('file')), item.get('ncmId'), item.get('songId'), relative_file(item.get('lyricsFile')), requested)
            value = invoke(ctx, 'agent.music.submit', payload)
            results.append({'index':index, 'ok':True, 'value':value})
        except (BackendError, ValueError, OSError) as error:
            results.append({'index':index, 'ok':False, 'error':{'code':getattr(error,'code','INVALID_INPUT'), 'message':str(error)}})
    if (wait_for_jobs or export_directory) and not ctx.obj['dry_run']:
        for item in results:
            if item['ok']:
                try:
                    item['value'] = ctx.obj['backend'].wait_job(item['value']['id'], wait_timeout)
                    if export_directory:
                        item['export'] = ctx.obj['backend'].call('agent.music.export', {'id':item['value']['id'],'directory':str(export_directory.resolve()),'notation':notation,'key':'auto'})
                except BackendError as error: item.update(ok=False,error={'code':error.code,'message':str(error)})
    emit(ctx, {'items':results, 'succeeded':sum(item['ok'] for item in results), 'failed':sum(not item['ok'] for item in results)})
    if any(not item['ok'] for item in results): ctx.exit(1)


@music.command('wait')
@click.option('--id', 'project_id', required=True)
@click.option('--wait-timeout', default=3600, type=click.FloatRange(min=.1))
@click.pass_context
def wait(ctx, project_id, wait_timeout):
    """Wait for a durable analysis job; a timeout does not cancel it."""
    emit(ctx, ctx.obj['backend'].wait_job(project_id, wait_timeout))


@music.command('result')
@click.option('--id', 'project_id', required=True)
@click.option('--from', 'start', type=float)
@click.option('--to', 'end', type=float)
@click.pass_context
def result(ctx, project_id, start, end):
    """Read estimated chords, vocal notes and timing for a requested interval."""
    value = ctx.obj['backend'].call('agent.music.context', {'id':project_id})
    emit(ctx, interval_result(value,start,end) if start is not None or end is not None else value)


@music.command('artifacts')
@click.option('--id', 'project_id', required=True)
@click.pass_context
def artifacts(ctx, project_id):
    """Inspect real stem, MIDI, MusicXML and score artifact files."""
    emit(ctx, ctx.obj['backend'].call('agent.music.artifacts', {'id':project_id}))


@music.command('export')
@click.option('--id', 'project_id', required=True)
@click.option('--directory', required=True, type=click.Path(path_type=Path))
@click.option('--notation', type=click.Choice(['numbered','staff']), default='staff')
@click.option('--key', default='auto')
@click.pass_context
def export(ctx, project_id, directory, notation, key):
    """Export SVG/PDF through the application's native score renderer."""
    emit(ctx, invoke(ctx, 'agent.music.export', {'id':project_id,'directory':str(directory.resolve()),'notation':notation,'key':key}))


@music.command('export-stems')
@click.option('--id', 'project_id', required=True)
@click.option('--directory', required=True, type=click.Path(path_type=Path))
@click.option('--audio-format', type=click.Choice(['wav','flac']), default='flac')
@click.option('--chord-format', type=click.Choice(['txt','csv','json']), default='json')
@click.option('--stems', default='vocals,drums,bass,guitar,piano,other')
@click.pass_context
def export_stems(ctx, project_id, directory, audio_format, chord_format, stems):
    """Export actual stem audio and timed chords using the native worker."""
    emit(ctx, invoke(ctx,'agent.music.exportAudio',{'id':project_id,'directory':str(directory.resolve()),'audioFormat':audio_format,'chordFormat':chord_format,'stems':stems.split(',')}))


@cli.group()
def preview():
    """Publish native score preview bundles; consume with cli-hub previews."""


@preview.command('recipes')
@click.pass_context
def preview_recipes(ctx):
    emit(ctx, {'recipes':[{'id':'score-'+kind,'description':'Native SVG/PDF '+kind+' score with timed note data'} for kind in ('staff','numbered')]})


@preview.command('capture')
@click.option('--id','project_id',required=True)
@click.option('--directory',type=click.Path(path_type=Path),default=Path.home()/'.cli-anything/previews')
@click.option('--notation',type=click.Choice(['staff','numbered']),default='staff')
@click.pass_context
def preview_capture(ctx,project_id,directory,notation):
    from cli_anything.twilightecho.core.preview import capture
    if ctx.obj['dry_run']:
        emit(ctx,{'dryRun':True,'id':project_id,'directory':str(directory),'notation':notation})
    else:
        emit(ctx,capture(ctx.obj['backend'],project_id,directory,notation))


@preview.command('latest')
@click.option('--id','project_id',required=True)
@click.option('--directory',type=click.Path(path_type=Path),default=Path.home()/'.cli-anything/previews')
@click.option('--notation',type=click.Choice(['staff','numbered']),default='staff')
@click.pass_context
def preview_latest(ctx,project_id,directory,notation):
    from cli_anything.twilightecho.core.preview import latest
    emit(ctx,latest(project_id,directory,notation))


@cli.command()
@click.pass_context
def repl(ctx):
    """Interactive CLI-Anything shell using the same commands and real backend."""
    from cli_anything.twilightecho.utils.repl_skin import ReplSkin
    skin = ReplSkin('twilightecho', version=__version__)
    skin.print_banner()
    prompt = skin.create_prompt_session()
    while True:
        try:
            line = skin.get_input(prompt)
        except (EOFError, KeyboardInterrupt): break
        if not line or not line.strip(): continue
        if line.strip() in ('quit','exit'): break
        args = shlex.split(line, posix=sys.platform != 'win32')
        prefix = (['--json'] if ctx.obj['json'] else []) + (['--profile',str(ctx.obj['profile'])] if ctx.obj['profile'] else [])
        try: cli.main(prefix+args, standalone_mode=False)
        except (click.ClickException, BackendError, ValueError, OSError) as error: skin.error(str(error))
        except SystemExit: pass
    skin.print_goodbye()


def kebab(name):
    return re.sub(r'(?<!^)(?=[A-Z])','-',name).replace('_','-').lower()


def properties(schema):
    merged = dict(schema.get('properties', {}))
    for branch in schema.get('anyOf', []): merged.update(properties(branch))
    return merged


def option_type(schema):
    if schema.get('type') == 'boolean': return click.BOOL
    if schema.get('type') == 'number': return click.FLOAT
    if schema.get('type') == 'string': return click.STRING
    alternatives = schema.get('anyOf', [])
    if alternatives and all(branch.get('type') == 'string' and 'const' in branch for branch in alternatives):
        return click.Choice([branch['const'] for branch in alternatives])
    return click.STRING


def add_core_commands():
    manifest = json.loads(Path(__file__).with_name('commands.json').read_text(encoding='utf-8'))
    for operation in manifest['operations']:
        group = cli
        parts = [kebab(part) for part in operation['name'].split('.')]
        for part in parts[:-1]:
            if part not in group.commands: group.add_command(click.Group(part))
            group = group.commands[part]
        if parts[-1] in group.commands: raise RuntimeError('Duplicate CLI command: '+operation['name'])
        def make_command(operation):
            fields = properties(operation['inputSchema'])
            params = [click.Option(['--payload'], default='{}', help='JSON object, @file or - for stdin.')]
            mapping = {}
            for index,(name,schema) in enumerate(fields.items()):
                if kebab(name) == 'payload': continue
                destination = 'field_'+str(index);mapping[destination] = (name,schema)
                params.append(click.Option(['--'+kebab(name),destination], default=None, type=option_type(schema), help=schema.get('description') or operation.get('inputType','')[:100]))
            @click.pass_context
            def callback(ctx, payload, **kwargs):
                if ctx.invoked_subcommand is not None: return
                value = read_json(payload)
                if not isinstance(value,dict): raise BackendError('INVALID_INPUT','Payload must be a JSON object')
                for destination,provided in kwargs.items():
                    if provided is None: continue
                    name,schema = mapping[destination]
                    if isinstance(provided,str) and schema.get('type') not in ('string',) and not isinstance(option_type(schema),click.Choice):
                        provided = read_json(provided)
                    value[name] = provided
                emit(ctx, invoke(ctx,operation['name'],value))
            return click.Group(parts[-1], params=params, callback=callback, invoke_without_command=True,
                help=f"{operation['name']} ({operation['kind']}, {operation.get('permission','application')}). "+('Uses a native picker; inspect describe for alternatives.' if operation.get('interactive') else ''))
        group.add_command(make_command(operation))


add_core_commands()


def main():
    if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    try:
        result = cli.main(standalone_mode=False)
        if isinstance(result,int): raise SystemExit(result)
    except (BackendError, ValueError, OSError, click.ClickException) as error:
        if '--json' in sys.argv:
            click.echo(json.dumps({'ok':False,'error':{'code':getattr(error,'code','INVALID_INPUT'),'message':str(error)}},ensure_ascii=False))
        else: click.echo(f"Error [{getattr(error,'code','INVALID_INPUT')}]: {error}",err=True)
        raise SystemExit(getattr(error,'exit_code',1))
