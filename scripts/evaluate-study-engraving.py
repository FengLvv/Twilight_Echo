"""Compare old per-line and batched LilyPond on identical real raw notes."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time


parser=argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--initial', required=True)
parser.add_argument('--home', required=True)
parser.add_argument('--output', required=True)
args=parser.parse_args()
sys.path.insert(0,str(Path(args.runtime).resolve()))
from vocal_score import engrave
result=json.loads(Path(args.initial).read_text(encoding='utf-8'))
lines=[dict(id=row['lineId'],text=row['text']) for row in result['melody']['scores']]
started=time.perf_counter()
with tempfile.TemporaryDirectory(prefix='study-engraving-check-') as work:
    scores=engrave(result['melody']['notes'],lines,Path(work),Path(args.home),lambda *args: None)
report=dict(seconds=time.perf_counter()-started, lines=len(scores),
            geometry={str(row['lineId']):hashlib.sha256(row['svg'].encode()).hexdigest() for row in scores})
Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='geometry'}))
