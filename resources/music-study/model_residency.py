"""Model placement changes run on the same executor as inference."""
import gc
from itertools import chain
import time
import weakref

from runtime_context import check_cancel

_models = {}
_restore_ms = None
_external_capacity = 0


def placements(model):
    return {value.device.type for value in chain(model.parameters(), model.buffers())}


def register_model(name, model, device):
    register_resource(name, model, str(device), placements, lambda value, target: value.to(target),
                      sum(p.numel() * p.element_size() for p in chain(model.parameters(), model.buffers())
                          if hasattr(p, 'numel')))
    return model


def register_resource(name, value, device, locations, move, size):
    # Caches own the objects; the placement registry must not defeat eviction.
    _models[name] = dict(ref=weakref.ref(value), device=str(device), locations=locations,
                         move=move, bytes=size, used=time.monotonic(), dirty=False)
    return value


def entries():
    for name, entry in list(_models.items()):
        value = entry['ref']()
        if value is None:
            del _models[name]
        else:
            yield name, entry, value


def budget(activate=False):
    import torch
    total = torch.cuda.get_device_properties(0).total_memory if torch.cuda.is_available() and (activate or torch.cuda.is_initialized()) else _external_capacity
    return min(4 * 1024**3, total // 2), max(2 * 1024**3, total // 4)


def configure_gpu_capacity(total):
    """DirectML also works without CUDA (for example an AMD Windows GPU)."""
    global _external_capacity
    _external_capacity = max(_external_capacity, int(total))


def move_entry(entry, value, destination):
    entry['dirty'] = True
    entry['move'](value, destination)
    entry['dirty'] = False


def admit(name):
    """Evict inactive weights in LRU order, leaving headroom for activations.

    Inference is serialized by Core. ORT sizes are conservative model-file
    estimates; the policy is a weight budget, not a total GPU-memory guarantee.
    """
    import torch
    limit, reserve = budget(activate=True)
    current = list(entries())
    target = next((entry for key, entry, _ in current if key == name), None)
    if not target or target['device'] == 'cpu':
        return
    resident = sum(entry['bytes'] for _, entry, value in current if entry['locations'](value) != {'cpu'})
    extra = target['bytes'] if target['locations'](target['ref']()) == {'cpu'} else 0
    free = torch.cuda.mem_get_info()[0] if torch.cuda.is_available() else max(0, _external_capacity-resident)
    moved = False
    for key, entry, value in sorted(current, key=lambda item: item[1]['used']):
        if resident + extra <= limit and free >= reserve + extra:
            break
        if key in (name, 'six') or entry['locations'](value) == {'cpu'}:
            continue
        move_entry(entry, value, 'cpu')
        resident -= entry['bytes']; free += entry['bytes']
        moved = True
    if moved:
        release_unused_cuda()
    if resident + extra > limit:
        raise MemoryError('模型权重超过显存预算：' + name)


def ensure_model(name):
    global _restore_ms
    import torch
    entry = _models[name]
    model, destination = entry['ref'](), entry['device']
    if model is None:
        raise ValueError('模型已释放：' + name)
    check_cancel()
    admit(name)
    if entry['dirty'] or entry['locations'](model) != {destination.split(':')[0]}:
        check_cancel()
        started = time.perf_counter()
        move_entry(entry, model, destination)
        if destination.startswith('cuda'):
            torch.cuda.synchronize()
        if name == 'chords':
            _restore_ms = round((time.perf_counter() - started) * 1000)
    entry['used'] = time.monotonic()
    return model


def release_unused_cuda():
    import torch
    gc.collect()
    if torch.cuda.is_available() and torch.cuda.is_initialized():
        torch.cuda.empty_cache()


def snapshot():
    import torch
    ready = torch.cuda.is_available() and torch.cuda.is_initialized()
    values = list(entries())
    devices = {name: next(iter(locations)) if len(locations := entry['locations'](model)) == 1 and not entry['dirty'] else 'mixed'
               for name, entry, model in values}
    limit, reserve = budget()
    return dict(devices=devices,
                modelBudgetBytes=limit, activationReserveBytes=reserve,
                residentWeightBytes=sum(entry['bytes'] for name, entry, model in values if devices.get(name) in ('cuda','dml','mixed')),
                estimatedDirectMLBytes=sum(entry['bytes'] for name, entry, model in values if devices.get(name) == 'dml'),
                cudaAllocatedBytes=torch.cuda.memory_allocated() if ready else 0,
                cudaReservedBytes=torch.cuda.memory_reserved() if ready else 0,
                **({'lastChordRestoreMs': _restore_ms} if _restore_ms is not None else {}))


def standby():
    check_cancel()
    started = time.perf_counter()
    for name, entry, model in entries():
        if name != 'six' and (entry['dirty'] or entry['locations'](model) != {'cpu'}):
            move_entry(entry, model, 'cpu')
    # Complete the state transition even if a new request cancels while copying.
    # The next inference restores placement before accessing the model.
    release_unused_cuda()
    return dict(**snapshot(), lastOffloadMs=round((time.perf_counter() - started) * 1000))
