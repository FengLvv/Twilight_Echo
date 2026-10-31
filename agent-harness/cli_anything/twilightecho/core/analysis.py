import copy
import math


def interval_result(project, start=None, end=None):
    start = 0 if start is None else start
    end = project.get('duration') or project.get('result', {}).get('duration', 10800) if end is None else end
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
        raise ValueError('Expected 0 <= start < end in audio seconds')
    result = copy.deepcopy(project.get('result') or {})
    for name in ('chords', 'originalChords'):
        if name in result:
            result[name]['segments'] = [dict(segment, start=max(start, segment['start']), end=min(end, segment['end']))
                for segment in result[name].get('segments', []) if segment['start'] < end and segment['end'] > start]
    melody = result.get('melody')
    if melody:
        melody['notes'] = [note for note in melody.get('notes', []) if note['start'] < end and note['end'] > start]
        melody.pop('scores', None)
        pitches = [note['midi'] for note in melody['notes']]
        result['vocalSummary'] = {'estimated': True, 'noteCount': len(pitches), 'minMidi': min(pitches) if pitches else None,
            'maxMidi': max(pitches) if pitches else None,
            'longestNoteSeconds': max((min(end,n['end'])-max(start,n['start']) for n in melody['notes']), default=0),
            'semitoneIntervals': [b-a for a,b in zip(pitches,pitches[1:])]}
    tonality = copy.deepcopy(project.get('tonality'))
    if tonality:
        tonality['degrees'] = [chord for chord in tonality.get('degrees',[]) if chord['start'] < end and chord['end'] > start]
    return {'id': project['id'], 'title': project.get('title'), 'status': project['status'], 'tonality':tonality, 'range': {'start': start, 'end': end}, 'result': result}
