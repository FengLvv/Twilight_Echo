"""Lazy, CPU-only single-line classification for unstructured lyric fallback."""
import hashlib
import json
from pathlib import Path
import time

_instance = None
_directory = None


def policy():
    return json.loads(Path(__file__).with_name('lyric_line_models.json').read_text(encoding='utf-8'))


def policy_key():
    specification = policy()
    return 'lyric-line-policy:' + specification['manifestSha256'] + ':' + specification['files']['tokenizer.json']


class LyricLineClassifier:
    def __init__(self, pack):
        specification = policy()
        root = Path(pack) / specification['directory']
        for name, expected in specification['files'].items():
            path = root / name
            if not path.is_file():
                raise ValueError('网易云歌词分类模型未安装，请运行 install-lyric-line-model.ps1')
            with path.open('rb') as file:
                if hashlib.file_digest(file, 'sha256').hexdigest() != expected:
                    raise ValueError('歌词分类模型校验失败：' + name)
        manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.np = np
        self.threshold = manifest['nonLyricThreshold']
        self.tokenizer = Tokenizer.from_file(str(root/'tokenizer.json'))
        self.tokenizer.no_padding()
        self.tokenizer.enable_truncation(max_length=manifest['maxTokens'])
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(root/'lyric-line.onnx'),options,providers=['CPUExecutionProvider'])

    def is_lyric(self, text):
        if not isinstance(text,str): raise TypeError('Expected one text string')
        if not text.strip(): return False
        if '\n' in text.strip() or '\r' in text.strip(): raise ValueError('Expected one text line')
        encoded = self.tokenizer.encode(text)
        logits = self.session.run(None,{'input_ids':self.np.asarray([encoded.ids],dtype=self.np.int64),
            'attention_mask':self.np.asarray([encoded.attention_mask],dtype=self.np.int64)})[0][0]
        if not self.np.isfinite(logits).all(): return True
        exp = self.np.exp(logits-logits.max())
        return bool(float(exp[0]/exp.sum()) < self.threshold)


def release_classifier():
    global _instance, _directory
    _instance = _directory = None


def filter_lyrics(lines, pack):
    global _instance, _directory
    started = time.perf_counter()
    directory = str(Path(pack).resolve())
    reused = _instance is not None and _directory == directory
    if not reused:
        release_classifier()
        _instance = LyricLineClassifier(pack)
        _directory = directory
    decisions = {}
    kept, excluded = [], []
    from runtime_context import check_cancel
    for row in lines:
        check_cancel()
        if row['text'] not in decisions: decisions[row['text']] = _instance.is_lyric(row['text'])
        if decisions[row['text']]: kept.append(row)
        else: excluded.append(dict(id=row['id'],reason='non_lyric_classifier'))
    candidate_ids=[row['id'] for row in excluded]
    abstained = bool(lines and not kept)
    if abstained: kept, excluded = list(lines), []
    return kept, excluded, dict(algorithm=policy()['algorithm'],policy=policy_key(),threshold=_instance.threshold,
        uniqueLines=len(decisions),candidates=candidate_ids,rejected=0,protected=[],abstained=abstained,reused=reused,
        elapsedMs=round((time.perf_counter()-started)*1000))
