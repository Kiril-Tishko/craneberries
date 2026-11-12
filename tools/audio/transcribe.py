#!/usr/bin/env python3
"""Transcribe a lesson recording locally (nothing leaves the machine).

  pip install faster-whisper soundfile        (ffmpeg must be installed)
  python3 tools/audio/transcribe.py <audio file> <out-prefix> [model] [language]

Writes <out-prefix>.txt (one line per phrase: [mm:ss] text, then the words the recognizer was unsure of,
with their probability) and <out-prefix>.json (every word with start, end, probability).
Default model: large-v3-turbo (about 6x real time on 4 CPUs; downloads ~1.6 GB from huggingface.co once
into <out-prefix's folder>/models). Keep recordings and transcripts in the scratchpad, never in the repo.

Limits, say them in the report: one mixed track, so no speaker labels (infer from context); a word the
recognizer got wrong or was unsure of is a hint about pronunciation, not proof (`confidence: check`);
Ukrainian stretches come out garbled or as Russian-looking text."""
import json, pathlib, subprocess, sys, tempfile, time
import soundfile as sf
from faster_whisper import WhisperModel
src, out = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else 'large-v3-turbo'
lang = sys.argv[4] if len(sys.argv) > 4 else 'en'
root = pathlib.Path(out).resolve().parent
wav = tempfile.NamedTemporaryFile(suffix='.wav', dir=root, delete=False).name
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', wav], check=True)
audio, _ = sf.read(wav, dtype='float32'); pathlib.Path(wav).unlink()
m = WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=4, download_root=str(root / 'models'))
t0 = time.time()
segs, info = m.transcribe(audio, language=lang, word_timestamps=True, vad_filter=True,
                          condition_on_previous_text=False, beam_size=5)
res = []
with open(out + '.txt', 'w') as f:
    for s in segs:
        low = [f'{w.word.strip()}({w.probability:.2f})' for w in s.words if w.probability < 0.5]
        line = f'[{int(s.start) // 60:02d}:{int(s.start) % 60:02d}] {s.text.strip()}'
        if low: line += '   ⟨unsure: ' + ' '.join(low) + '⟩'
        f.write(line + '\n'); f.flush()
        res.append({'start': s.start, 'end': s.end, 'text': s.text,
                    'words': [[w.start, w.end, w.word, round(w.probability, 2)] for w in s.words]})
json.dump(res, open(out + '.json', 'w'), ensure_ascii=False)
print('done:', round(time.time() - t0), 's for', round(info.duration), 's of audio')
