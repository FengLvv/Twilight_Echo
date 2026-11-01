"""Placement adapters for the isolated Torch / DirectML vocal pipeline."""
from pathlib import Path

from model_residency import register_resource, placements


class OnnxPlacement:
    def __init__(self, model, attribute):
        self.model, self.attribute = model, attribute

    def locations(self):
        return {'dml' if 'DmlExecutionProvider' in session.get_providers() else 'cpu'
                for session in getattr(self.model, self.attribute).values()}

    def move(self, device):
        from inference.device_utils import resolve_onnx_providers
        name, providers = resolve_onnx_providers(device)
        # set_providers replaces native sessions in place; do not retain a second
        # GPU bundle through the upstream module-level model caches.
        for session in getattr(self.model, self.attribute).values():
            session.set_providers(providers)
        self.model.provider_name = name


def register_onnx(name, model, attribute, device, directory):
    from inference.device_utils import resolve_onnx_providers, select_preferred_gpu_adapter
    from model_residency import configure_gpu_capacity
    preferred, _ = resolve_onnx_providers(device)
    if preferred == 'dml':
        adapter_info = select_preferred_gpu_adapter()
        if adapter_info:
            configure_gpu_capacity(adapter_info.dedicated_vram_bytes)
    adapter = OnnxPlacement(model, attribute)
    model._study_placement = adapter
    register_resource(name, adapter, preferred, lambda value: value.locations(), lambda value, target: value.move(target),
                      sum(path.stat().st_size for path in Path(directory).glob('*.onnx')))


def register_beat(predictor):
    def locations(value):
        return placements(value.model) | placements(value.spect)
    def move(value, device):
        import torch
        value.model.to(device); value.spect.to(device); value.device = torch.device(device)
    size = sum(p.numel()*p.element_size() for part in (predictor.model, predictor.spect)
               for p in list(part.parameters()) + list(part.buffers()))
    register_resource('beat', predictor, predictor.device, locations, move, size)
