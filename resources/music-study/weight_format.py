"""Deterministic safetensors headers make model packs reproducible byte-for-byte."""
import json
import os
from pathlib import Path
import shutil
import struct

def canonicalize(path):
    path=Path(path);temporary=path.with_suffix('.canonical.tmp')
    with path.open('rb') as source,temporary.open('wb') as target:
        length=struct.unpack('<Q',source.read(8))[0]
        header=json.loads(source.read(length))
        encoded=json.dumps(header,sort_keys=True,separators=(',',':')).encode('utf-8')
        encoded+=b' '*((-len(encoded))%8)
        target.write(struct.pack('<Q',len(encoded)));target.write(encoded)
        shutil.copyfileobj(source,target,4*1024*1024)
    os.replace(temporary,path)
