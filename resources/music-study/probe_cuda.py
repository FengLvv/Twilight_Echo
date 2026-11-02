"""Fixed capability probe, before downloading CUDA-only singer weights."""
import json
import torch

if not torch.cuda.is_available():
    raise SystemExit('当前分析环境无法使用 CUDA，请更新 NVIDIA 驱动后重试双歌手分离')
print(json.dumps(dict(cuda=True, device=torch.cuda.get_device_name(0))), flush=True)
