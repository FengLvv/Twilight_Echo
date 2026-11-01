"""Summarize M0 measured artifacts without counting cache reads as inference."""
import argparse
import json
from pathlib import Path

from benchmark_progressive import CONTEXTS, write_json


def aggregate(rows, field):
    totals = {}
    for row in rows:
        for name, metric in row[field].items():
            total = totals.setdefault(name, dict(matched=0., seconds=0.))
            for key in total:
                total[key] += metric[key]
    return {name: dict(**metric, score=metric['matched'] / metric['seconds'] if metric['seconds'] else None)
            for name, metric in totals.items()}


def summarize(path, six_rtf):
    path = Path(path)
    data = json.loads(path.read_text(encoding='utf-8'))
    output = dict(encoderSeconds=data['encoderSeconds'], datasets={})
    # Recover ORIGINAL measured inference for reused predictions. The current
    # cache hit itself has no inference timing, and is never included as zero.
    def inference_seconds(call):
        if call.get('seconds') is not None:
            return call['seconds']
        return json.loads((path.parent / 'predictions' / (call['key'] + '.json')).read_text(encoding='utf-8'))['seconds']

    for dataset in sorted({row['dataset'] for row in data['files']}):
        files = [row for row in data['files'] if row['dataset'] == dataset]
        entry = dict(files=len(files), audioSeconds=sum(row['duration'] for row in files), candidates={})
        baseline = aggregate([row['baseline'] for row in files], 'metrics')
        entry['baseline'] = baseline
        for context in CONTEXTS:
            candidates = [row['candidates'][str(context)] for row in files if str(context) in row['candidates']]
            if not candidates:
                continue
            candidate = {name: aggregate(candidates, name) for name in
                         ('metrics', 'firstMetrics', 'baselineFirstMetrics', 'seamMetrics', 'baselineSeamMetrics')}
            # A short EOF-shifted window can serve multiple adjacent accept
            # ranges. Count one computation per distinct input, per source.
            seconds = 0.
            first = []
            for row in candidates:
                unique = {call['key']: call for call in row['calls']}
                seconds += sum(inference_seconds(call) for call in unique.values())
                first.append(inference_seconds(row['calls'][0]))
            candidate['measuredComputeSeconds'] = seconds
            candidate['chordRtf'] = seconds / entry['audioSeconds']
            candidate['serialSixPlusChordRtfEstimate'] = six_rtf + candidate['chordRtf']
            candidate['firstInferenceSeconds'] = first
            candidate['detailedDropPercentagePoints'] = 100 * (
                baseline['common_exact']['score'] - candidate['metrics']['common_exact']['score'])
            candidate['qualityWithinOnePoint'] = candidate['detailedDropPercentagePoints'] <= 1
            candidate['speedWithinBudgetEstimate'] = candidate['serialSixPlusChordRtfEstimate'] <= .5
            candidate['distinctInputCalls'] = sum(len({call['key'] for call in row['calls']}) for row in candidates)
            entry['candidates'][str(context)] = candidate
        output['datasets'][dataset] = entry
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chords', nargs='+', required=True)
    parser.add_argument('--stems', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    stems = json.loads(Path(args.stems).read_text(encoding='utf-8'))
    write_json(args.output, dict(stems=stems, chordRuns=[summarize(path, stems['warmRtf']) for path in args.chords]))


if __name__ == '__main__':
    main()
