#!/usr/bin/env python3
"""Turn lesson recordings into a timed transcript that says who spoke (T = teacher, S = student).

  python3 tools/audio/lesson-audio.py <out-dir> --pc <pc-audio> [--phone <phone-audio>] [--pc-is-student]

<out-dir> must be outside the repo (it holds student audio and text). Writes:
  transcript.txt  one line per turn: "mm:ss S: text"; words the recognizer was unsure of carry ⁽NN⁾ (% confidence)
  words.json      [start, end, word, confidence, speaker] for every word (PC time)
  quality.txt     how much of each voice each recording caught, and how sure the recognizer was
Times are PC times, so they match the PC recording.

Two setups:
- PC records both voices, phone records the room (mostly the teacher): the teacher is loud on the phone and the
  student (through headphones or speakers) is far quieter there, so comparing the two tells who spoke.
- --pc-is-student: the PC records only the student; the phone gives the teacher's words.
The two recordings drift apart by seconds over an hour (different clocks, dropped audio), so the time map is
rebuilt every 30 s from loudness.

Needs: pip install faster-whisper soundfile; ffmpeg. Model large-v3-turbo (downloads from huggingface.co once,
about 1.6 GB); about 15 min per hour of audio on 4 CPUs. Ukrainian speech comes out as rough text (often
Russian-looking): read it as Ukrainian. A recognizer mishearing a word is a hint, not proof, of a pronunciation
problem: mark such notes `confidence: check`."""
import argparse, json, os, re, subprocess, sys, time
import numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('--pc', required=True); ap.add_argument('--phone')
ap.add_argument('--pc-is-student', action='store_true'); ap.add_argument('--model', default='large-v3-turbo')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
J = lambda n: os.path.join(a.out, n)

def wav(src, name):
    p = J(name + '.wav')
    if not os.path.exists(p):
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', p], check=True)
    return p

def transcribe(path, name):
    out = J(name + '.json')
    if os.path.exists(out): return json.load(open(out))
    from faster_whisper import WhisperModel
    audio, _ = sf.read(path, dtype='float32')   # pass samples: some PyAV versions break faster-whisper's own decoder
    m = WhisperModel(a.model, device='cpu', compute_type='int8', cpu_threads=os.cpu_count() or 4)
    t = time.time(); res = []
    segs, _ = m.transcribe(audio, language='en', vad_filter=True, word_timestamps=True, condition_on_previous_text=False, beam_size=5)
    for s in segs:
        res.append({'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip(),
                    'words': [[round(w.start, 2), round(w.end, 2), w.word.strip(), round(w.probability, 3)] for w in (s.words or [])]})
        if len(res) % 100 == 0: print(f'{name}: {round(s.end)} s done, {round(time.time() - t)} s elapsed', flush=True)
    json.dump(res, open(out, 'w'), ensure_ascii=False)
    return res

def envelope(path):   # loudness in dB, 100 frames a second
    x, sr = sf.read(path, dtype='float32'); hop = sr // 100; n = len(x) // hop
    return 10 * np.log10((x[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-10)

def time_map(pc, ph, W=9000, step=3000, span=6000):
    """Lag (frames) so that phone[t + lag] matches pc[t], every 30 s; FFT cross-correlation of 90 s windows."""
    pts = []
    for c in range(W // 2, len(pc) - W // 2, step):
        s = c - W // 2; x = pc[s:s + W]
        if x.std() < 1: continue
        lo, hi = max(0, s - span), min(len(ph), s + W + span)
        y = ph[lo:hi]
        if len(y) < W: continue
        x = (x - x.mean()) / x.std(); y = (y - y.mean()) / (y.std() + 1e-9)
        n = 1 << int(np.ceil(np.log2(len(y) + W)))
        r = np.fft.irfft(np.fft.rfft(y, n) * np.conj(np.fft.rfft(x, n)), n)[:len(y) - W + 1] / W
        k = int(np.argmax(r)); pts.append([c, lo + k - s, float(r[k])])
    pts = np.array(pts)
    good = pts[pts[:, 2] > np.percentile(pts[:, 2], 25)]          # drop weak windows (silence, one voice only)
    med = np.array([np.median(good[max(0, i - 3):i + 4, 1]) for i in range(len(good))])
    good = good[np.abs(good[:, 1] - med) < 150]                     # and lags that jump away from their neighbours
    return good[:, 0], good[:, 1]

pc_wav = wav(a.pc, 'pc'); pc_words = [[w[0], w[1], w[2].strip(), w[3]] for s in transcribe(pc_wav, 'pc') for w in s['words']]
rows = []
if a.phone:
    ph_wav = wav(a.phone, 'phone'); ph_words = [[w[0], w[1], w[2].strip(), w[3]] for s in transcribe(ph_wav, 'phone') for w in s['words']]
    pc_env, ph_env = envelope(pc_wav), envelope(ph_wav)
    mc, ml = time_map(pc_env, ph_env)
    to_ph = lambda t: t + float(np.interp(t * 100, mc, ml)) / 100
    to_pc = lambda t: t - float(np.interp(t * 100, mc + ml, ml)) / 100
    if a.pc_is_student:
        rows = [w + ['S'] for w in pc_words] + [[round(to_pc(w[0]), 2), round(to_pc(w[1]), 2), w[2], w[3], 'T'] for w in ph_words]
    else:
        def level(env, f0, f1):
            f0, f1 = max(0, int(f0)), min(len(env), int(f1))
            return float(np.percentile(env[f0:f1], 80)) if f1 > f0 else np.nan
        for w in pc_words:
            lag = float(np.interp((w[0] + w[1]) * 50, mc, ml))
            d = level(ph_env, w[0] * 100 + lag, w[1] * 100 + lag) - level(pc_env, w[0] * 100, w[1] * 100)
            rows.append(w + ['?' if np.isnan(d) else ('S' if d < -20 else ('T' if d > -14 else '?'))])
else:
    rows = [w + ['?'] for w in pc_words]
rows.sort(key=lambda r: r[0])

lines, cur, buf, t0, prev = [], None, [], 0, 0
for r in rows:
    word = r[2] + (f'⁽{int(r[3] * 100)}⁾' if r[3] < 0.5 else '')
    if r[4] != cur or (buf and r[0] - prev > 2.5):
        if buf: lines.append(f'{int(t0 // 60):02d}:{int(t0 % 60):02d} {cur}: ' + ' '.join(buf))
        cur, buf, t0 = r[4], [], r[0]
    buf.append(word); prev = r[1]
if buf: lines.append(f'{int(t0 // 60):02d}:{int(t0 % 60):02d} {cur}: ' + ' '.join(buf))
open(J('transcript.txt'), 'w').write('\n'.join(lines) + '\n')
json.dump(rows, open(J('words.json'), 'w'), ensure_ascii=False)

eng = lambda w: re.search('[A-Za-z]', w[2])
q = []
for k, name in (('T', 'teacher'), ('S', 'student'), ('?', 'unclear')):
    x = [r for r in rows if r[4] == k and eng(r)]
    if x: q.append(f'{name}: {len(x)} English words, recognizer sure of {round(100 * sum(r[3] >= .5 for r in x) / len(x))}%')
if a.phone and not a.pc_is_student:
    times = np.array(sorted(to_pc(w[0]) for w in ph_words))
    for k, name in (('T', 'teacher'), ('S', 'student')):
        x = [r for r in rows if r[4] == k and eng(r)]
        hit = sum(1 for r in x if len(times) and np.min(np.abs(times[max(0, np.searchsorted(times, r[0]) - 1):np.searchsorted(times, r[0]) + 1] - r[0]) if np.searchsorted(times, r[0]) < len(times) else [9]) < .6)
        if x: q.append(f'phone caught {round(100 * hit / len(x))}% of the {name}\'s words')
open(J('quality.txt'), 'w').write('\n'.join(q) + '\n')
print('\n'.join(q)); print('wrote', J('transcript.txt'))
