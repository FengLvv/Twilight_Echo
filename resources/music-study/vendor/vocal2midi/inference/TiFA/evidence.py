"""Measure the decoded path before WordList repairs fabricate minimum durations.

These are acoustic observations, not calibrated probabilities of sung text.
"""
import numpy as np


def token_evidence(similarities, spans, word_ids, timestep):
    sim = np.asarray(similarities)
    spans = np.asarray(spans)
    if sim.ndim != 2 or spans.shape != (sim.shape[1], 2) or len(word_ids) != sim.shape[1]:
        raise ValueError('TiFA evidence dimensions do not match the decoded path')
    result = []
    for index, word in enumerate(word_ids):
        if word < 1:
            continue
        begin, end = (int(value) for value in spans[index])
        if not 0 <= begin <= end <= sim.shape[0]:
            raise ValueError('TiFA evidence span is outside the audio')
        values = sim[begin:end, index]
        valid = bool(len(values) and np.isfinite(values).all())
        result.append(dict(word=int(word)-1, start=begin*timestep, end=end*timestep,
                           frames=end-begin, similarity=float(values.mean()) if valid else None))
    return result
