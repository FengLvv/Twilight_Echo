"""Shared analysis-only credit policy; the lyric display retains the original."""
import json
from pathlib import Path
import re
import unicodedata

_policy=json.loads(Path(__file__).with_name('lyric_credits.json').read_text(encoding='utf-8'))
def normalize(text):
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text).strip()).lower()

def compact(text):
    return re.sub(r'\s','',normalize(text))

def alternatives(values):
    return '(?:'+'|'.join(re.escape(role) for role in sorted(set(map(compact,values)),key=lambda s:(-len(s),s)))+')'
_instrument_name=alternatives(_policy['instrumentPrefixes'])+'?'+alternatives(_policy['instruments'])
_instrument=_instrument_name+alternatives(_policy['instrumentRoles'])+'?'
_studio='(?:'+_instrument_name+')?'+alternatives(_policy['studioRoles'])+r'(?:[a-z]|[0-9]{1,2})?'
_role='(?:'+alternatives(_policy['roles'])+'|'+_instrument+'|'+_studio+')'
_credit_role=re.compile(_role)
_notices={normalize(text) for text in _policy['exactNotices']}
_introducer=re.compile(r'^(?:'+'|'.join(re.escape(normalize(s)) for s in _policy['creditIntroducers'])+r')\s+(.+)',re.IGNORECASE)
_separators=['&','/','、','+',',','及','与','和','and']

def credit_header(text):
    header=compact(text)
    if not header or len(header)>160:return False
    positions=[0];seen={0}
    def add(position):
        if position not in seen:seen.add(position);positions.append(position)
    for start in positions:
        for end in range(start+1,len(header)+1):
            if not _credit_role.fullmatch(header[start:end]):continue
            if end==len(header) or header[end:]=='by':return True
            add(end)
            for separator in _separators:
                if header.startswith(separator,end) and end+len(separator)<len(header):add(end+len(separator))
    return False


def is_credit(text):
    normalized=normalize(text)
    if normalized in _notices:return True
    if ':' in normalized and credit_header(normalized.split(':',1)[0]):return True
    by=_introducer.match(re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text).strip()))
    if by:
        name=by[1].lstrip('"\'“‘(')
        initial=name[:1]
        if initial and (unicodedata.category(initial)=='Lu' or
                '\u3400'<=initial<='\u9fff' or '\uac00'<=initial<='\ud7af' or
                '\u3040'<=initial<='\u30ff'):return True
    if any(normalized.startswith(normalize(s)+' ') for s in _policy['studioIntroducers']) and (
            re.search(r'\b(?:studios?|recording|mastering)\b',normalized) or
            re.search(r'\([^)]{2,}\).*\b(?:19|20)\d{2}\b',normalized)):return True
    dash=re.match(r'^(.*?)\s+[-–—]\s+\S',normalized)
    return bool(dash and re.search('[a-z]',dash[1]) and credit_header(dash[1]))
