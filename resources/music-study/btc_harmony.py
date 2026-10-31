"""Local BTC large-vocabulary posterior, fused with explicit chroma/bass evidence.

Architecture: jayg996/BTC-ISMIR19 (MIT, see btc/LICENSE).
Weights: ChordMini 2026 BTC continual-learning student (MIT, licenses/chordmini-MIT.txt).
No training code, MIDI generation, pickle loading or network requests at runtime.
"""
from functools import lru_cache
from pathlib import Path
import numpy as np
import librosa
import torch
from safetensors import safe_open
from safetensors.torch import load_file
from btc.model import BTC_model

# Fixed 170-class order. Sixth/minor-major-seventh classes reduce to the
# supported common triad vocabulary; this does not claim full 170-class output.
QUALITIES=('m','','dim','aug','m','', 'm7','m','maj7','7','dim7','m7b5','sus2','sus4')

@lru_cache(maxsize=1)
def _model(path):
    device='cuda' if torch.cuda.is_available() else 'cpu'
    config=dict(feature_size=144,timestep=108,num_chords=170,input_dropout=.2,
                layer_dropout=.2,attention_dropout=.2,relu_dropout=.2,num_layers=8,
                num_heads=4,hidden_size=128,total_key_depth=128,total_value_depth=128,
                filter_size=128,loss='ce',probs_out=True)
    model=BTC_model(config).to(device).eval()
    model.load_state_dict(load_file(str(path)),strict=True)
    with safe_open(str(path),framework='pt') as file:
        metadata=file.metadata()
    return model,device,float(metadata['mean']),float(metadata['std'])

@torch.inference_mode()
def posterior(audio,sr,pack,states,hop):
    model,device,mean,std=_model(str(Path(pack)/'btc.safetensors'))
    y=librosa.resample(audio,orig_sr=sr,target_sr=22050).astype(np.float32)
    features=[]
    # Reproduce the reference's ten-second CQT framing, including end padding.
    for start in range(0,len(y),220500):
        chunk=y[start:start+220500]
        if len(chunk)<8192:chunk=np.pad(chunk,(0,8192-len(chunk)))
        spectrum=librosa.cqt(chunk,sr=22050,n_bins=144,bins_per_octave=24,hop_length=2048)
        features.append(np.log(abs(spectrum)+1e-6).T[:108])
    scores=[]
    for feature in features:
        count=len(feature)
        feature=np.pad((feature-mean)/std,((0,108-count),(0,0)))
        input=torch.from_numpy(feature.astype(np.float32))[None].to(device)
        hidden,_=model.self_attn_layers(input)
        logits=model.output_layer.output_projection(hidden)
        scores.append(torch.softmax(logits,dim=-1)[0,:count].cpu().numpy())
    probabilities=np.concatenate(scores,axis=0)
    time=np.arange(len(probabilities))*10/108
    output=np.zeros((len(states),int(np.ceil(len(y)/hop))+1),np.float32)
    grid=np.arange(output.shape[1])*hop/22050
    for index,(root,quality,_) in enumerate(states):
        classes=[root*14+i for i,q in enumerate(QUALITIES) if q==quality]
        output[index]=np.interp(grid,time,probabilities[:,classes].sum(1))
    return output
