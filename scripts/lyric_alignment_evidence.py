"""Offline TiFA measurements; rejected as a production lyric-validity classifier."""
import math

ALGORITHM = 'tifa-line-evidence-v1'


def summarize_lines(tokens, owners, lines, offset):
    rows = []
    for line in lines:
        selected = [token for token in tokens if owners.get(token['word']) == line['id']]
        aligned = [token for token in selected if token['frames'] > 0 and
                   token['similarity'] is not None and math.isfinite(token['similarity'])]
        count = len(selected)
        coverage = len(aligned)/count if count else 0
        similarity = sum(token['similarity'] for token in aligned)/len(aligned) if aligned else None
        positive = sum(token['similarity'] > 0 for token in aligned)/len(aligned) if aligned else None
        compressed = sum(token['frames'] <= 1 for token in aligned)/len(aligned) if aligned else None
        seconds = sum(token['end']-token['start'] for token in aligned)
        inside = sum(max(0, min(token['end']+offset, line['end'])-
                         max(token['start']+offset, line['start'])) for token in aligned)
        inside_ratio = min(1, inside/seconds) if seconds else None
        reasons = []
        if count and not aligned: reasons.append('no_aligned_phonemes')
        if aligned and coverage < .6: reasons.append('skipped_phonemes')
        if similarity is not None and similarity <= 0: reasons.append('weak_similarity')
        if count >= 4 and compressed is not None and compressed >= .8: reasons.append('compressed_alignment')
        if inside_ratio is not None and inside_ratio < .3: reasons.append('outside_lyric_window')
        def rounded(value): return round(value, 5) if value is not None else None
        rows.append(dict(id=line['id'], start=line['start'], end=line['end'],
                         status='review' if reasons else 'measured' if aligned else 'unavailable',
                         tokens=count, alignedTokens=len(aligned), coverage=rounded(coverage),
                         meanSimilarity=rounded(similarity), positiveRatio=rounded(positive),
                         compressedRatio=rounded(compressed), insideRatio=rounded(inside_ratio), reasons=reasons))
    return rows
