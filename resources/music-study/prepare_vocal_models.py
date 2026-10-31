"""Install verified TiFA/GAME data and native engraving tools, independently of chords."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from download_models import download, sha

REGISTRY=json.loads(Path(__file__).with_name('vocal_models.json').read_text(encoding='utf-8'))

def extract(archive,destination):
    destination=destination.resolve();destination.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            target=(destination/item.filename).resolve()
            if not target.is_relative_to(destination): raise ValueError('Unsafe archive entry')
        z.extractall(destination)

def install(home):
    pack=home/'models';cache=home/'vocal-downloads';cache.mkdir(parents=True,exist_ok=True)
    bundles={}
    for source in REGISTRY['sources']:
        archive=cache/(source['id']+'.zip')
        download(source['url'],archive,source['sha256'])
        target=cache/source['id'];extract(archive,target);bundles[source['id']]=target
    source=cache/'tifa-source.zip'
    download('https://codeload.github.com/openvpi/TIFA/zip/7b210ca36ff5a2b79187fb1727af58fc977cc301',source,
             '0c8bc5e2e9ec6968f2803912bcfae78e39e5739b8869d25c729703aa7411700e')
    extract(source,cache/'source')
    deploy=next((cache/'source').rglob('deploy.py'))
    model=next(bundles['tifa'].rglob('model.pt'))
    tifa=pack/'vocal2midi/tifa';tifa.mkdir(parents=True,exist_ok=True)
    if not all((pack/name).is_file() and sha(pack/name)==value for name,value in REGISTRY['files'].items() if '/tifa/' in name):
        subprocess.run([sys.executable,str(deploy),'-m',str(model),'-o',str(tifa)],check=True)
        for name in ['dictionaries','assets']:
            shutil.copytree(model.parent/name,tifa/name,dirs_exist_ok=True)
    game=next(bundles['game-medium-onnx'].rglob('config.json')).parent
    shutil.copytree(game,pack/'vocal2midi/game',dirs_exist_ok=True)
    download('https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt',
        pack/'vocal2midi/beat_this-final0.ckpt','8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331')
    lily=next(bundles['lilypond'].rglob('lilypond.exe')).parent.parent
    shutil.copytree(lily,home/'notation-tools/lilypond-2.24.4',dirs_exist_ok=True)
    for name,expected in REGISTRY['files'].items():
        if sha(pack/name)!=expected: raise ValueError('Vocal model checksum mismatch: '+name)
    # Fetch Open JTalk pronunciation data once during installation, never while
    # processing a user's audio. The runtime is strictly offline after setup.
    import pyopenjtalk
    pyopenjtalk.run_frontend('あ')
    print('Vocal notation model pack and pronunciation data verified',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('home');args=parser.parse_args()
    install(Path(args.home).resolve())
