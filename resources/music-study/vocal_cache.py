"""Content-addressed lyric contexts; notes have one canonical stored copy."""
import copy
import hashlib
import json


def digest(value):
    def canonical(item):
        if isinstance(item,float) and item.is_integer(): return int(item)
        if isinstance(item,dict): return {key:canonical(v) for key,v in item.items()}
        if isinstance(item,list): return [canonical(v) for v in item]
        return item
    return hashlib.sha256(json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def group_key(lines, language):
    # IDs are presentation identities. Text, audio bounds and language determine
    # alignment; adding/removing a row can also change its 45-second context.
    return digest(dict(language=language, lines=[{k: row[k] for k in ('start','end','text')} for row in lines]))


def reuse_group(previous, key, lines, word_base):
    for group in previous.get('reuse', {}).get('groups', []):
        if group.get('key') != key or len(group['lineIds']) != len(lines):
            continue
        mapping = dict(zip(group['lineIds'], [line['id'] for line in lines]))
        try:
            notes = [copy.deepcopy(previous['notes'][i]) for i in group['noteIndices']]
            for row in notes:
                row['lineId'] = mapping[row['lineId']]
                row['wordId'] = row['wordId'] - group['wordBase'] + word_base
            return notes
        except (KeyError, IndexError, TypeError):
            return None
    return None


def phrase_base(beat):
    # Bar identity follows the same 1/8-beat rounding used for note placement.
    return (round(beat * 8) // 32) * 4


def score_key(rows):
    base = phrase_base(rows[0][1]['beat'])
    return digest([dict(beat=round(row['beat']-base, 8), durationBeats=row['durationBeats'], lyric=row.get('lyric',''))
                   for _, row in rows])


def reuse_score(previous, key, indices):
    import re
    for score in previous:
        if score.get('key') != key or len(score.get('noteIndices', [])) != len(indices):
            continue
        mapping = dict(zip(score['noteIndices'], indices))
        try:
            return re.sub(r'data-note="(\d+)"', lambda match: f'data-note="{mapping[int(match[1])]}"', score['svg'])
        except KeyError:
            continue
    return None
