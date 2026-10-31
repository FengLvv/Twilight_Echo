"""Offline separation adapters. Models are loaded only from a verified local pack."""
import math
from pathlib import Path
import numpy as np
import torch
import soundfile as sf
import librosa


def read_audio(path, sr=44100):
    data, rate = sf.read(path, dtype="float32", always_2d=True)
    if not len(data) or not np.isfinite(data).all():
        raise ValueError("Empty or non-finite audio")
    if rate != sr:
        data = librosa.resample(data.T, orig_sr=rate, target_sr=sr).T
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    return data[:, :2].T.copy()


def six_stems(audio, pack, device, report):
    import os
    os.environ["TORCH_HOME"] = str(Path(pack) / "torch")
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    model = get_model("htdemucs_6s").to(device).eval()
    # Match Demucs' reference normalization, with silence guarded explicitly.
    ref = torch.from_numpy(audio).mean(0)
    mean, std = ref.mean(), ref.std().clamp_min(1e-6)
    wave = (torch.from_numpy(audio) - mean) / std
    report(.04, "六轨分离")
    with torch.inference_mode():
        result = apply_model(model, wave[None], device=device, shifts=1,
                             split=True, overlap=.25, progress=False)[0]
    result = result.cpu().numpy() * float(std)
    # Share the DC offset instead of adding it six times.
    result += float(mean) / len(model.sources)
    return dict(zip(model.sources, result))


def lead_backing(vocals, pack, report):
    """UVR MDX KARA 2 predicts Instrumental (here backing), NOT lead vocals."""
    import onnxruntime as ort
    options=ort.SessionOptions();options.intra_op_num_threads=8;options.inter_op_num_threads=1
    session = ort.InferenceSession(str(Path(pack) / "UVR_MDXNET_KARA_2.onnx"),sess_options=options,
                                  providers=["CPUExecutionProvider"])
    n_fft, hop, bins, frames, trim = 5120, 1024, 2048, 256, 2560
    chunk = hop * (frames - 1)
    stride = chunk - 2 * trim
    length = vocals.shape[1]
    padded = np.pad(vocals, ((0, 0), (trim, stride - length % stride + trim)))
    window = torch.hann_window(n_fft)
    pieces = []
    for start in range(0, length, stride):
        wave = torch.from_numpy(padded[:, start:start + chunk])
        stft = torch.stft(wave, n_fft, hop, window=window, return_complex=True)
        spec = torch.view_as_real(stft).permute(0, 3, 1, 2).reshape(1, 4, n_fft // 2 + 1, frames)
        spec = spec[:, :, :bins].numpy().copy()
        spec[:, :, :3] = 0
        prediction = session.run(None, {session.get_inputs()[0].name: spec})[0]
        spec_full = np.pad(prediction[0], ((0, 0), (0, n_fft // 2 + 1 - bins), (0, 0)))
        complex_spec = torch.view_as_complex(torch.from_numpy(spec_full).reshape(2, 2, -1, frames)
                                             .permute(0, 2, 3, 1).contiguous())
        out = torch.istft(complex_spec, n_fft, hop, window=window, length=chunk).numpy()
        pieces.append(out[:, trim:-trim])
        report((start + min(stride, length - start)) / length, "主唱与和声分离")
    backing = np.concatenate(pieces, axis=1)[:, :length] * 1.065
    return {"lead": vocals - backing, "backing": backing}


def duet_model(pack, device):
    from audio_diffusion_pytorch import AudioDiffusionModel, LogNormalDistribution
    from safetensors.torch import load_file
    model = AudioDiffusionModel(
        in_channels=1, channels=256, patch_size=12, resnet_groups=8,
        kernel_multiplier_downsample=2, multipliers=[1, 2, 4, 4, 4, 4, 4],
        factors=[4, 4, 4, 2, 2, 2], num_blocks=[2, 2, 2, 2, 2, 2],
        attentions=[0, 0, 0, 1, 1, 1, 1], attention_heads=8,
        attention_features=128, attention_multiplier=2, use_nearest_upsample=False,
        use_skip_scale=True, diffusion_type="k",
        diffusion_sigma_distribution=LogNormalDistribution(mean=-3, std=1),
        diffusion_sigma_data=.2)
    model.unet.load_state_dict(load_file(str(Path(pack) / "duet.safetensors")),strict=True)
    return model.to(device).eval()


class SingerIdentity:
    """Track anonymous A/B timbres across chunks, independently of reference audio."""
    def __init__(self, pack, device):
        from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
        from speechbrain.lobes.features import Fbank
        from speechbrain.processing.features import InputNormalization
        self.device=device
        self.features=Fbank(n_mels=80).to(device)
        self.normalize=InputNormalization(norm_type="sentence", std_norm=False).to(device)
        self.model=ECAPA_TDNN(input_size=80,channels=[1024,1024,1024,1024,3072],
                             kernel_sizes=[5,3,3,3,1],dilations=[1,2,3,4,1],attention_channels=128,lin_neurons=192).to(device).eval()
        state=torch.load(Path(pack)/"speaker"/"embedding_model.ckpt",map_location=device,weights_only=True)
        self.model.load_state_dict(state,strict=True)
        self.reference=None

    @torch.no_grad()
    def align(self, prediction, fresh):
        import torchaudio.functional as functional
        wave=functional.resample(fresh,24000,16000)
        energy=wave.square().mean(1).sqrt()
        if wave.shape[1]<8000 or float(energy.min())<.002:
            return prediction, False
        features=self.features(wave)
        features=self.normalize(features,torch.ones(2,device=self.device))
        embedding=torch.nn.functional.normalize(self.model(features).squeeze(1),dim=1)
        ambiguous=float((embedding[0]*embedding[1]).sum())>.78
        if self.reference is not None:
            similarity=embedding@self.reference.T
            direct=similarity[0,0]+similarity[1,1]
            swapped=similarity[0,1]+similarity[1,0]
            ambiguous=ambiguous or abs(float(direct-swapped))<.06
            if float(swapped-direct)>.06:
                prediction=prediction.flip(0);embedding=embedding.flip(0)
            if not ambiguous:
                self.reference=torch.nn.functional.normalize(.95*self.reference+.05*embedding,dim=1)
        else:
            self.reference=embedding
        return prediction, ambiguous


@torch.no_grad()
def _duet_window(mixture, model, sigmas, condition, generator, tick):
    """Dirac-constrained MSDM sampler, adapted from iamycy/duet-svs-diffusion (MIT).

    Self-conditioning uses ONLY preceding predictions, never reference stems.
    """
    def noise(shape):
        return torch.randn(shape, device=mixture.device, generator=generator)
    x = sigmas[0] * noise((2, len(mixture)))
    for i in range(len(sigmas) - 1):
        sigma, following = sigmas[i], sigmas[i + 1]
        gamma = min(40 / (len(sigmas) - 1), 2 ** .5 - 1)
        sigma_hat = sigma * (gamma + 1)
        for repeat in range(2):
            x += noise(x.shape) * (sigma_hat ** 2 - sigma ** 2).sqrt()
            if condition is not None:
                x[:, :condition.shape[1]] = condition + noise(condition.shape) * sigma
            x[:1] = mixture - x[1:].sum(0, keepdim=True)
            prediction = model.diffusion.diffusion.denoise_fn(x[:, None], sigma=sigma)[:, 0]
            score = (x - prediction) / sigma
            x[1:] += (score[1:] - score[:1]) * (following - sigma_hat)
            if repeat == 0:
                x += noise(x.shape) * (sigma ** 2 - following ** 2).sqrt()
        tick(i / (len(sigmas) - 1))
    # The dependent source must be recomputed after the final integration step.
    x[:1] = mixture - x[1:].sum(0, keepdim=True)
    return x


def two_singers(vocals, pack, device, report, steps=100, seed=42, identity_report=None):
    from audio_diffusion_pytorch import KarrasSchedule
    if device != "cuda":
        raise RuntimeError("双歌手分离需要 CUDA GPU；可先完成六轨和主唱／和声任务")
    model = duet_model(pack, device)
    identity = SingerIdentity(pack,device)
    mono = librosa.resample(vocals.mean(0), orig_sr=44100, target_sr=24000)
    length, hop = 131072, 65536
    sigmas = KarrasSchedule(sigma_min=.0001, sigma_max=5, rho=9)(steps, device)
    generator = torch.Generator(device=device).manual_seed(seed)
    previous = None
    output = []
    uncertain=[]
    wave = torch.from_numpy(mono).to(device)
    for start in range(0, len(mono), hop):
        # Prepend a predicted overlap to maintain singer identity across windows.
        fresh = wave[start:start + hop]
        mixture = torch.zeros(length, device=device)
        if previous is not None:
            mixture[:hop] = wave[max(0, start - hop):start]
            condition = previous[:, hop:]
        else:
            condition = torch.zeros(2, hop, device=device)
        mixture[hop:hop + len(fresh)] = fresh
        prediction = _duet_window(mixture, model, sigmas, condition, generator,
                                  lambda p: report((start + p * len(fresh)) / len(mono), "双歌手分离"))
        prediction, ambiguous = identity.align(prediction,prediction[:,hop:hop+len(fresh)])
        if ambiguous:uncertain.append({'start':start/24000,'end':min(len(mono),start+len(fresh))/24000})
        previous = prediction
        output.append(prediction[:, hop:hop + len(fresh)].cpu().numpy())
    separated = np.concatenate(output, axis=1)
    if identity_report:identity_report(uncertain)
    separated = librosa.resample(separated, orig_sr=24000, target_sr=44100)
    separated = np.pad(separated, ((0, 0), (0, max(0, vocals.shape[1] - separated.shape[1]))))
    # Model is mono at 24 kHz. Audition files are aligned stereo at 44.1 kHz;
    # metadata explicitly records the model's original bandwidth and channels.
    return {"singerA": np.repeat(separated[0, :vocals.shape[1]][None], 2, 0),
            "singerB": np.repeat(separated[1, :vocals.shape[1]][None], 2, 0)}
