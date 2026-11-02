"""Compare text-only, stem-boundary-only and combined lyric selection."""
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'resources/music-study'))
from vocal_activity import detect_vocal_activity,filter_outer_lyrics

request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
root=Path(request['audioDirectory']);started=time.perf_counter()
activity=detect_vocal_activity(root/'vocals.wav',root/'original.wav')
raw=request['rows'];rules=[r for r in raw if r['id'] not in request['ruleExcluded']]
time_only,time_excluded=filter_outer_lyrics(raw,activity)
combined,additional=filter_outer_lyrics(rules,activity)
result=dict(activity=activity,elapsedMs=round((time.perf_counter()-started)*1000),
            inputRows=len(raw),ruleExcluded=request['ruleExcluded'],timeExcluded=time_excluded,
            additionalExcluded=additional,keptIds=[r['id'] for r in combined],
            excludedRows=[dict(row=next(r for r in raw if r['id']==x['id']),reason=x['reason']) for x in additional])
print(json.dumps(result,ensure_ascii=False))
