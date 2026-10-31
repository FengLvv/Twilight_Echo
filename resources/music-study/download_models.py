"""Prepare a fixed, offline model pack. Training pickles are checked before conversion."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
from weight_format import canonicalize

REGISTRY=json.loads(Path(__file__).with_name('models.json').read_text(encoding='utf-8'))

def sha(path):
    with Path(path).open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()

def download(url,path,expected):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if sha(path)!=expected:raise ValueError('Existing file has an unexpected checksum: '+str(path))
        return
    partial=path.with_suffix(path.suffix+'.part')
    print('Download:',path.name,flush=True)
    offset=partial.stat().st_size if partial.exists() else 0
    request=urllib.request.Request(url,headers={'User-Agent':'TwilightEcho-MusicStudy/1','Range':f'bytes={offset}-'} if offset else {'User-Agent':'TwilightEcho-MusicStudy/1'})
    with urllib.request.urlopen(request,timeout=120) as response:
        with partial.open('ab' if response.status==206 and offset else 'wb') as file:
            while block:=response.read(4*1024*1024):file.write(block)
    if sha(partial)!=expected:raise ValueError('Download checksum mismatch: '+path.name)
    partial.replace(path)

def verify(root):
    for name,expected in REGISTRY['files'].items():
        if sha(root/name)!=expected:raise ValueError('Model checksum mismatch: '+name)
    print('All offline model checksums verified',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('--verify-only',action='store_true')
    args=parser.parse_args();root=Path(args.directory);root.mkdir(parents=True,exist_ok=True)
    if not args.verify_only:
        files=REGISTRY['files']
        download('https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th',root/'torch/hub/checkpoints/5c90dfd2-34c22ccb.th',files['torch/hub/checkpoints/5c90dfd2-34c22ccb.th'])
        download('https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_KARA_2.onnx',root/'UVR_MDXNET_KARA_2.onnx',files['UVR_MDXNET_KARA_2.onnx'])
        download('https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/resolve/main/embedding_model.ckpt',root/'speaker/embedding_model.ckpt',files['speaker/embedding_model.ckpt'])
        if not (root/'duet.safetensors').exists():
            import gdown
            source=REGISTRY['sources']['duet'];checkpoint=root/'duet.ckpt'
            if not checkpoint.exists():gdown.download(id=source['id'],output=str(checkpoint),resume=True,quiet=False)
            if sha(checkpoint)!=source['sha256']:raise ValueError('Untrusted duet training checkpoint')
            subprocess.run([sys.executable,str(Path(__file__).with_name('prepare_duet.py')),str(root)],check=True)
        chord_model=root/'btc.safetensors'
        current=sha(chord_model) if chord_model.exists() else None
        if current!=files['btc.safetensors']:
            # Upgrade only the known previous pack, preserving unexpected custom files.
            if current and current!=REGISTRY['sources']['btcTeacher']['inferenceSha256']:
                raise ValueError('Existing chord model has an unexpected checksum; keep it aside before installing the fixed pack')
            import torch
            from safetensors.torch import save_file
            source=REGISTRY['sources']['btc'];checkpoint=root/('btc-chordmini-'+source['sha256'][:12]+'.pth')
            download(source['url'],checkpoint,source['sha256'])
            data=torch.load(checkpoint,map_location='cpu',weights_only=True)
            stats=data['normalization']
            mapping={int(k):v for k,v in data['idx_to_chord'].items()}
            temporary=root/'btc.part.safetensors'
            save_file({k:v.contiguous()for k,v in data['model_state_dict'].items()},str(temporary),metadata={
                'mean':str(float(stats['mean'])),'std':str(float(stats['std'])),
                'sourceSha256':source['sha256'],'labels':json.dumps(mapping,sort_keys=True)})
            canonicalize(temporary)
            if sha(temporary)!=files['btc.safetensors']:raise ValueError('Converted chord model checksum mismatch')
            temporary.replace(chord_model)
        for name, source in REGISTRY['sources'].items():
            if name.startswith(('sheetsage2/','mert2/')):
                download(source['url'],root/name,source['sha256'])
    verify(root)
    (root/'manifest.json').write_text(json.dumps(REGISTRY,indent=2),encoding='utf-8')
