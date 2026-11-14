#!/usr/bin/env python3
"""Rebuild the clip library's word list after adding or changing word files:
    python3 tools/real-video/build_index.py
Reads docs/real-video/words/<slug>.json and writes docs/real-video/words/index.json (the page's search uses it).
Same format as the page's edit mode writes, so the two never fight over it."""
import json
import pathlib

words = pathlib.Path(__file__).resolve().parents[2] / 'docs' / 'real-video' / 'words'
items = []
for f in sorted(words.glob('*.json')):
    if f.name == 'index.json':
        continue
    w = json.loads(f.read_text(encoding='utf-8'))
    items.append({'slug': f.stem, 'en': w.get('en') or f.stem, 'ua': w.get('ua', ''), 'pic': w.get('pic', ''),
                  'n': sum(1 for c in w.get('clips', []) if not c.get('hidden'))})
items.sort(key=lambda x: x['en'].lower())
text = '[\n' + ',\n'.join('  ' + json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in items) + '\n]\n'
(words / 'index.json').write_text(text, encoding='utf-8')
print(f'{len(items)} words -> {words / "index.json"}')
