"""Attach only host-verified component paths before importing scientific packages."""
import json
import os
from pathlib import Path
import runpy
import sys


def paths():
    return json.loads(os.environ.get('TWILIGHT_STUDY_COMPONENT_PATHS', '{}'))


def native_path(value):
    value = os.path.abspath(value)
    if os.name == 'nt' and len(value) >= 240 and not value.startswith('\\\\?\\'):
        value = '\\\\?\\UNC\\' + value[2:] if value.startswith('\\\\') else '\\\\?\\' + value
    return Path(value)


def model_path(pack, relative):
    name = str(relative).replace('\\', '/')
    for prefix, value in sorted(paths().get('models', {}).items(), key=lambda item: -len(item[0])):
        if name == prefix:
            return native_path(value)
        if name.startswith(prefix + '/'):
            return native_path(value) / name[len(prefix) + 1:]
    return native_path(pack) / name


def child_command(python, script):
    code = 'import sys;sys.path.insert(0,sys.argv.pop(1));from study_bootstrap import run;run()'
    return [str(native_path(python)), '-X', 'utf8', '-u', '-c', code, str(Path(script).parent), str(script)]


def attach_shared_libraries(shared):
    # Torch 2.8 resolves junctions again before ctypes loads torchaudio DLLs.
    # Preserve the host-verified short view for libraries inside this component.
    import torch._utils_internal
    original = torch._utils_internal.resolve_library_path
    root = os.path.normcase(os.path.abspath(shared))

    def resolve_library_path(path):
        candidate = os.path.abspath(os.fspath(path))
        try:
            if os.path.commonpath([root, os.path.normcase(candidate)]) == root:
                return candidate
        except ValueError:
            pass
        return original(path)

    torch._utils_internal.resolve_library_path = resolve_library_path


def run():
    value = paths()
    script = sys.argv.pop(1)
    vocal = Path(script).name == 'vocal_runtime.py' or os.environ.get('TWILIGHT_STUDY_RUNTIME_ROLE') == 'vocal'
    interpreter = value.get('vocalPython' if vocal else 'python')
    if interpreter:
        sys.path.insert(0, str(native_path(Path(interpreter).parent / 'Lib/site-packages')))
    if value.get('sharedPython'):
        sys.path.insert(0, str(native_path(value['sharedPython'])))
        attach_shared_libraries(value['sharedPython'])
    sys.path.insert(0, str(Path(script).parent))
    sys.argv[0] = script
    runpy.run_path(script, run_name='__main__')
