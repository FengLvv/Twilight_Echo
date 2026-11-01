"""Real weights and denoising parity across budget eviction and CPU parking."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

parser=argparse.ArgumentParser()
parser.add_argument('--home',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'resources/music-study'))
import scipy.linalg
import torch
from separation import six_model,duet_model,_duet_window
from sheetsage_harmony import load_model
from model_residency import ensure_model,standby,snapshot
torch.set_num_threads(4)
pack=Path(args.home)/'models'
six=six_model(str(pack),'cuda')
chords=load_model(str(pack));ensure_model('chords')
before=snapshot()
model=duet_model(str(pack),'cuda')
ensure_model('duet')
admitted=snapshot()
assert admitted['devices']['chords']=='cpu'
assert admitted['residentWeightBytes']<=admitted['modelBudgetBytes']
from audio_diffusion_pytorch import KarrasSchedule
def infer():
    generator=torch.Generator(device='cuda').manual_seed(42)
    mixture=torch.sin(torch.arange(131072,device='cuda')*.013)*.01
    schedule=KarrasSchedule(sigma_min=.0001,sigma_max=5,rho=9)(2,'cuda')
    return _duet_window(mixture,model,schedule,torch.zeros(2,65536,device='cuda'),generator,lambda *args:None).cpu()
first=infer()
idle=standby()
assert idle['devices']['six']=='cuda' and idle['devices']['duet']=='cpu'
tick=time.perf_counter();ensure_model('duet');restore_ms=(time.perf_counter()-tick)*1000
second=infer()
assert torch.equal(first,second)
report=dict(before=before,admitted=admitted,idle=idle,restoreMs=round(restore_ms),
            identicalDenoising=True,outputSha256=hashlib.sha256(first.numpy().tobytes()).hexdigest())
Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
