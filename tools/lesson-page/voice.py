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
    t = re.sub(r"(\d+) cm\b", lambda m: m.group(1) + (" centimeter" if m.group(1) == "1" else " centimeters"), t); t = re.sub(r"\binseam\b", "in seam", t)
    return t
# Kokoro reads "Does he live here?" and a lone "live" like live music (/laɪv/; Nov 25, "it says completely different
# live for no reason"). Lessons need the verb, so "live" is said /lɪv/ unless it is plainly the adjective.
LIVE_ADJ = re.compile(r"\blive\s+(music|show|shows|stream|streams|concert|event|band|tv|broadcast|performance|audience|game|games|video|chat|wire)\b"
                      r"|\b(go|goes|going|went|is|are|was|were|be|been|we're|it's|you're|they're|i'm)\s+live\b", re.I)
def say(text, voice):
    t = spoken(text)
    if re.search(r"\blive\b", t, re.I) and not LIVE_ADJ.search(t):
        ph = re.sub(r"(?<!\S)l([ˈˌ]?)aɪv(?=[\s?.!,;:]|$)", r"l\1ɪv", k.tokenizer.phonemize(t, "en-us"))
        return k.create(ph, voice=voice, speed=0.9, lang="en-us", is_phonemes=True)
    return k.create(t, voice=voice, speed=0.9, lang="en-us")
out = {}
pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)
for text, who in json.load(open(phrases)):
    if len(text) < 3: continue
    name = re.sub(r"[^a-z0-9]+", "-", text.lower().replace("’", "")).strip("-")[:40] + "-" + hashlib.md5(text.encode()).hexdigest()[:4]
    samples, sr = say(text, VOICE[who])
    wav = f"{outdir}/{name}.wav"; sf.write(wav, samples, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "64k", f"{outdir}/{name}.mp3"], check=True)
    pathlib.Path(wav).unlink()
    out[text] = f"{prefix}/{name}.mp3"
json.dump(out, open(mapfile, "w"), ensure_ascii=False)
print(len(out), "clips")
