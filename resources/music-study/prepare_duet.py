"""One-time conversion of the PINNED upstream training checkpoint, never run on imported packs."""
import sys
import json
import hashlib
from pathlib import Path
import torch
from safetensors.torch import save_file
from weight_format import canonicalize

if __name__ == "__main__":
    root = Path(sys.argv[1])
    registry=json.loads(Path(__file__).with_name('models.json').read_text(encoding='utf-8'))
    with (root/'duet.ckpt').open('rb') as file:
        if hashlib.file_digest(file,'sha256').hexdigest()!=registry['sources']['duet']['sha256']:
            raise ValueError('Untrusted upstream duet checkpoint')
    checkpoint = torch.load(root / "duet.ckpt", map_location="cpu", weights_only=False)
    tensors={k.removeprefix('model.unet.'):v.contiguous() for k,v in sorted(checkpoint['state_dict'].items()) if k.startswith('model.unet.')}
    if len(tensors)!=501:raise ValueError('Unexpected upstream model architecture')
    save_file(tensors,str(root/'duet.safetensors'),metadata={'architecture':'duet-svs-diffusion-v1'})
    canonicalize(root/'duet.safetensors')
    print('Converted',len(tensors),'unique tensors')
