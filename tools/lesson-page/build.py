#!/usr/bin/env python3
"""Build a lesson page: python3 tools/lesson-page/build.py <content.js> <audio-map.json|-> "<Title>" <out.html>

content.js defines `const P = ...; const R = ...; const SECTIONS = [...]` (see CLAUDE.md, "Lesson pages").
audio-map.json maps each English line to its clip path (made by voice.py); "-" builds without audio."""
import json, sys, pathlib
here = pathlib.Path(__file__).parent
content, amap, title, out = sys.argv[1:5]
s = (here / 'engine.html').read_text()
s = s.replace('/*CONTENT*/', pathlib.Path(content).read_text())
s = s.replace('/*AUDIO*/{}', json.dumps({} if amap == '-' else json.load(open(amap)), ensure_ascii=False))
s = s.replace('/*TITLE*/', title)
pathlib.Path(out).write_text(s)
print('wrote', out)
