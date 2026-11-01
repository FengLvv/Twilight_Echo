import threading
import types
import unittest
from unittest.mock import patch

import model_residency as residency
from runtime_context import bind, Cancelled


class Model:
    def __init__(self, device, during_move=None):
        self.device, self.moves = device, []
        self.weights = object()
        self.during_move = during_move
    def parameters(self):
        return iter([types.SimpleNamespace(device=types.SimpleNamespace(type=self.device))])
    def buffers(self):
        return iter([])
    def to(self, device):
        self.device = device; self.moves.append(device)
        if self.during_move:
            self.during_move()
        return self


class ModelResidencyTests(unittest.TestCase):
    def setUp(self):
        residency._models.clear(); residency._restore_ms = None; residency._external_capacity = 0
        self.token = threading.Event(); bind(self.token, lambda event: None)
        self.releases = []
        self.torch = types.SimpleNamespace(device=lambda value: types.SimpleNamespace(type=value), cuda=types.SimpleNamespace(
            is_available=lambda: True, is_initialized=lambda: True, synchronize=lambda: None,
            get_device_properties=lambda i: types.SimpleNamespace(total_memory=16*1024**3),
            mem_get_info=lambda: (12*1024**3,16*1024**3),
            empty_cache=lambda: self.releases.append(True), memory_allocated=lambda: 42, memory_reserved=lambda: 64))
        self.mock = patch.dict('sys.modules', torch=self.torch); self.mock.start()
    def tearDown(self):
        self.mock.stop(); residency._models.clear(); bind(threading.Event(), lambda event: None)
    def test_standby_keeps_six_and_restores_same_chord_model_without_reload(self):
        six, chords = Model('cuda'), Model('cuda')
        residency.register_model('six', six, 'cuda'); residency.register_model('chords', chords, 'cuda')
        weights = chords.weights
        self.assertEqual(residency.standby()['devices'], dict(six='cuda', chords='cpu'))
        self.assertEqual(six.moves, [])
        self.assertIs(residency.ensure_model('chords'), chords)
        self.assertIs(chords.weights, weights)
        residency.ensure_model('chords')
        self.assertEqual(chords.moves, ['cpu', 'cuda'])
        self.assertEqual(len(self.releases), 1)
    def test_cancelled_offload_does_not_move_any_model(self):
        chords = Model('cuda'); residency.register_model('chords', chords, 'cuda')
        self.token.set()
        with self.assertRaises(Cancelled):
            residency.standby()
        self.assertEqual(chords.moves, [])
    def test_demand_arriving_during_copy_keeps_committed_placement_observable(self):
        chords = Model('cuda', self.token.set); residency.register_model('chords', chords, 'cuda')
        self.assertEqual(residency.standby()['devices']['chords'], 'cpu')
        bind(threading.Event(), lambda event: None)
        residency.ensure_model('chords')
        self.assertEqual(chords.device, 'cuda')
    def test_cpu_only_and_unloaded_models_do_not_initialize_cuda(self):
        self.torch.cuda.is_available = lambda: False
        self.assertEqual(residency.standby()['devices'], {})
        self.assertEqual(residency.snapshot()['cudaReservedBytes'], 0)
        self.assertEqual(self.releases, [])
    def test_partial_transfer_failure_is_recovered_before_inference(self):
        class Partial(Model):
            def __init__(self):
                super().__init__('cuda'); self.buffer_device = 'cuda'
            def buffers(self):
                return iter([types.SimpleNamespace(device=types.SimpleNamespace(type=self.buffer_device))])
            def to(self, device):
                if device == 'cpu':
                    self.buffer_device = 'cpu'
                    raise MemoryError('transfer interrupted')
                self.buffer_device = device
                return super().to(device)
        model = Partial(); residency.register_model('chords', model, 'cuda')
        with self.assertRaises(MemoryError):
            residency.standby()
        self.assertEqual(residency.snapshot()['devices']['chords'], 'mixed')
        residency.ensure_model('chords')
        self.assertEqual(residency.snapshot()['devices']['chords'], 'cuda')

    def test_budget_evicts_old_optional_weights_before_restoring_new_family(self):
        a,b,six=Model('cuda'),Model('cpu'),Model('cuda')
        residency.register_model('six',six,'cuda')
        residency.register_model('chords',a,'cuda');residency._models['chords']['bytes']=3*1024**3
        residency.register_model('duet',b,'cuda');residency._models['duet']['bytes']=2*1024**3
        residency.ensure_model('duet')
        self.assertEqual(a.device,'cpu');self.assertEqual(b.device,'cuda');self.assertEqual(six.moves,[])
        self.assertLessEqual(residency.snapshot()['residentWeightBytes'],4*1024**3)

    def test_registry_does_not_keep_evicted_cache_objects_alive(self):
        model=Model('cuda');residency.register_model('duet',model,'cuda')
        del model
        self.assertNotIn('duet',residency.snapshot()['devices'])

    def test_single_model_larger_than_weight_budget_is_not_admitted(self):
        model=Model('cpu');residency.register_model('duet',model,'cuda')
        residency._models['duet']['bytes']=5*1024**3
        with self.assertRaises(MemoryError): residency.ensure_model('duet')
        self.assertEqual(model.moves,[])

    def test_directml_admission_does_not_require_a_cuda_device(self):
        self.torch.cuda.is_available=lambda:False
        residency.configure_gpu_capacity(8*1024**3)
        model=Model('cpu')
        residency.register_resource('tifa',model,'dml',residency.placements,lambda value,target:value.to(target),300*1024**2)
        residency.ensure_model('tifa')
        self.assertEqual(residency.snapshot()['devices']['tifa'],'dml')
        self.assertEqual(residency.snapshot()['estimatedDirectMLBytes'],300*1024**2)

    def test_cancelled_admission_does_not_evict_another_model(self):
        a,b=Model('cuda'),Model('cpu')
        residency.register_model('chords',a,'cuda');residency._models['chords']['bytes']=3*1024**3
        residency.register_model('duet',b,'cuda');residency._models['duet']['bytes']=2*1024**3
        self.token.set()
        with self.assertRaises(Cancelled):residency.ensure_model('duet')
        self.assertEqual(a.moves,[]);self.assertEqual(b.moves,[])

    def test_idle_moves_every_optional_backend_and_never_loads_unseen_models(self):
        models={name:Model(device) for name,device in [('six','cuda'),('chords','cuda'),('duet','cuda'),('tifa','dml')]}
        for name,model in models.items(): residency.register_model(name,model,model.device)
        self.assertEqual(residency.standby()['devices'],dict(six='cuda',chords='cpu',duet='cpu',tifa='cpu'))


if __name__ == '__main__':
    unittest.main()
