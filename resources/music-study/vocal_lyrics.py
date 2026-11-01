"""Shared analysis-only credit policy; the lyric display retains the original."""
import json
from pathlib import Path
import re

_roles=json.loads(Path(__file__).with_name('lyric_credits.json').read_text(encoding='utf-8'))['roles']
_role='(?:'+'|'.join(re.escape(role) for role in sorted(_roles,key=len,reverse=True))+')'
_credit=re.compile(r'^'+_role+r'(?:\s*(?:[&＆/／、+]|及|与)\s*'+_role+r')*\s*[:：]',re.IGNORECASE)


def is_credit(text):
    return bool(_credit.match(re.sub(r'\s+',' ',text.strip())))
