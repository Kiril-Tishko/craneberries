#!/usr/bin/env python3
"""Build one lesson page end to end.

  python3 tools/lesson-page/prep.py <content.js> "<Title>" <work-dir> [model-dir]

<work-dir> (outside the repo: it holds student material) gets page.html, audio/*.mp3, audio-map.json and
files.json. Clips recorded on an earlier run are reused; only new lines are recorded. Publish page.html with
the Artifact tool, `root: <work-dir>` and `files` = the list in files.json. Then run qa.js on it.

[model-dir] (default: $KOKORO_DIR or <work-dir>/../tts-model) holds the two Kokoro files, see voice.py."""
import json, os, pathlib, subprocess, sys
here = pathlib.Path(__file__).parent
content, title, work = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
model = sys.argv[4] if len(sys.argv) > 4 else os.environ.get('KOKORO_DIR', str(work.parent / 'tts-model'))
(work / 'audio').mkdir(parents=True, exist_ok=True)
lines = json.loads(subprocess.run(['node', str(here / 'extract.js'), content], capture_output=True, text=True, check=True).stdout)
lines = [[t, who] for t, who in lines if len(t) >= 3]
mapf, whof = work / 'audio-map.json', work / 'voices.json'
amap = json.loads(mapf.read_text()) if mapf.exists() else {}
voices = json.loads(whof.read_text()) if whof.exists() else {}
have = lambda t, who: t in amap and voices.get(t) == who and (work / amap[t]).exists()
new = [[t, who] for t, who in lines if not have(t, who)]
print(len(lines), 'lines;', len(lines) - len(new), 'already recorded;', len(new), 'to record')
if new:
    todo = work / 'to-record.json'
    todo.write_text(json.dumps(new, ensure_ascii=False))
    subprocess.run([sys.executable, str(here / 'voice.py'), str(todo), model, str(work / 'audio'), str(work / 'new-map.json'), 'audio'], check=True)
    amap.update(json.loads((work / 'new-map.json').read_text()))
    voices.update({t: who for t, who in new})
used = {t: amap[t] for t, _ in lines}
mapf.write_text(json.dumps(amap, ensure_ascii=False))
whof.write_text(json.dumps(voices, ensure_ascii=False))
(work / 'used-map.json').write_text(json.dumps(used, ensure_ascii=False))
subprocess.run([sys.executable, str(here / 'build.py'), content, str(work / 'used-map.json'), title, str(work / 'page.html')], check=True)
files = [{'path': p} for p in sorted(set(used.values()))]
(work / 'files.json').write_text(json.dumps(files))
missing = [p for p in used.values() if not (work / p).exists()]
print(len(files), 'clips; missing:', missing)
