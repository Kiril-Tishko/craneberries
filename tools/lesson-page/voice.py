#!/usr/bin/env python3
"""Record every line of a lesson page with the Kokoro voice.

  node tools/lesson-page/extract.js <content.js> > phrases.json
  python3 tools/lesson-page/voice.py phrases.json <model-dir> <out-dir> <audio-map.json> [prefix]

<model-dir> holds kokoro-v1.0.int8.onnx and voices-v1.0.bin (from the kokoro-onnx GitHub release
model-files-v1.0); needs `pip install kokoro-onnx soundfile` and ffmpeg. The learner's lines use af_heart,
other people (cashier, receptionist) am_michael. Clips are mp3, published next to the page under [prefix]."""
import json, re, sys, hashlib, subprocess, pathlib
import soundfile as sf
from kokoro_onnx import Kokoro
phrases, model, outdir, mapfile = sys.argv[1:5]
prefix = sys.argv[5] if len(sys.argv) > 5 else 'audio'
k = Kokoro(f"{model}/kokoro-v1.0.int8.onnx", f"{model}/voices-v1.0.bin")
VOICE = {"me": "af_heart", "them": "am_michael"}
def spoken(t):
    t = t.replace("’", "'")
    t = re.sub(r"\bOK\b", "okay", t)
    t = re.sub(r"\b(\d{1,2}) a\.m\.", r"\1 a m", t); t = re.sub(r"\b(\d{1,2}) p\.m\.", r"\1 p m", t)
    return t
out = {}
pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)
for text, who in json.load(open(phrases)):
    if len(text) < 3: continue
    name = re.sub(r"[^a-z0-9]+", "-", text.lower().replace("’", "")).strip("-")[:40] + "-" + hashlib.md5(text.encode()).hexdigest()[:4]
    samples, sr = k.create(spoken(text), voice=VOICE[who], speed=0.9, lang="en-us")
    wav = f"{outdir}/{name}.wav"; sf.write(wav, samples, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "64k", f"{outdir}/{name}.mp3"], check=True)
    pathlib.Path(wav).unlink()
    out[text] = f"{prefix}/{name}.mp3"
json.dump(out, open(mapfile, "w"), ensure_ascii=False)
print(len(out), "clips")
