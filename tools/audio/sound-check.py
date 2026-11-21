#!/usr/bin/env python3
"""Hear HOW things were said, not only what: which English sounds came out differently, and the tone of each turn.
Runs after lesson-audio.py or transcribe.py; nothing leaves the machine.

  apt-get install -y espeak-ng
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  pip install transformers phonemizer soundfile funasr
  python3 tools/audio/sound-check.py <work-dir>                                  (after lesson-audio.py: words.json + pc.wav)
  python3 tools/audio/sound-check.py <work-dir> --words <prefix>.json --audio <file>   (after transcribe.py)
  [--who S] only the student's turns · [--no-tone] skip the tone of voice · [--model …] another phoneme model

Writes into <work-dir> (outside the repo: it holds student speech):
  sounds.txt   per speaker: how many sounds came out differently, the swaps that repeat across different words
               (æ → ɛ: "pan" sounds like "pen") with times to listen to, then every word that sounded off
  sounds.json  every checked word: time, speaker, expected and heard sounds, what differed
  tone.txt     per speaker: speed, share of talk time, tone of voice (calm, happy, sad, angry…) and the turns
               where it was clearly not calm

How: a phoneme recognizer (wav2vec2 trained on espeak IPA, ~1.3 GB from huggingface.co once) writes down the
sounds it hears, with no dictionary behind it, so "pan" said as "pen" comes out as p ɛ n. espeak-ng (en-us) gives
the sounds Whisper's words should have, the two are lined up, and a sound counts as off only when the recognizer is
clearly surer of the other sound. Tone: emotion2vec+ base (~1.1 GB).

Limits, say them in the report:
- It checks the words Whisper wrote. When Whisper writes the word the student actually said ("pen"), nothing is off;
  it catches the cases where Whisper understood the meant word ("pan") from context.
- Tested on speechocean762 (adult learners reading sentences, clean audio; human marks for every sound): it finds
  most of the sounds humans marked wrong, but also flags sounds humans let pass as a light accent. Zoom audio and
  free speech are rougher. One flagged word is a hint (`confidence: check`); a swap that repeats in many different
  words is a pattern worth listening to.
- Not reported (accent-neutral or recognizer noise): extra sounds, a dropped r after a vowel (fine in international
  English), dropped schwas, vowel changes outside the stressed syllable, t/d between vowels (American flap).
- Turns where most sounds differ are skipped as "not English": Whisper (language=en) TRANSLATES Ukrainian speech, so
  those lines are never anyone's English.
- Tone of voice from a model trained mostly on actors and Chinese/English speech: a rough read, most turns come out
  calm. Never put it on anything a student sees."""
import argparse, collections, json, logging, os, re, subprocess, sys
import numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--words', help='transcribe.py json (default: <out>/words.json from lesson-audio.py)')
ap.add_argument('--audio', help='the recording (default: <out>/pc.wav)')
ap.add_argument('--who', help='only these speakers, e.g. S or S,T')
ap.add_argument('--no-tone', action='store_true')
ap.add_argument('--model', default='facebook/wav2vec2-lv-60-espeak-cv-ft')
ap.add_argument('--margin', type=float, default=2.0, help='how much surer (log) the recognizer must be of the other sound')
a = ap.parse_args()
J = lambda n: os.path.join(a.out, n)

# ---------- words and audio ----------
src = a.words or J('words.json')
raw = json.load(open(src))
if raw and isinstance(raw[0], dict):      # transcribe.py: segments with words [start, end, word, prob]
    rows = [[w[0], w[1], w[2].strip(), w[3], '?'] for s in raw for w in s['words']]
else:                                     # lesson-audio.py: [start, end, word, conf, speaker]
    rows = [list(r) for r in raw]
rows.sort(key=lambda r: r[0])
if a.who: rows = [r for r in rows if r[4] in a.who.split(',')]
aud = a.audio or J('pc.wav')
if not aud.endswith('.wav') or sf.info(aud).samplerate != 16000 or sf.info(aud).channels != 1:
    tmp = J('sound-check.wav')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', aud, '-ac', '1', '-ar', '16000', tmp], check=True); aud = tmp
audio, SR = sf.read(aud, dtype='float32')

def turns(rows, gap=0.8, longest=12.0):
    """Consecutive words of one speaker with no long pause, at most `longest` seconds."""
    out, cur = [], []
    for r in rows:
        if not re.search('[A-Za-z]', r[2]): continue
        if cur and (r[4] != cur[-1][4] or r[0] - cur[-1][1] > gap or r[1] - cur[0][0] > longest):
            out.append(cur); cur = []
        cur.append(r)
    if cur: out.append(cur)
    return out

# ---------- the ear: phonemes heard vs phonemes expected ----------
import torch
from phonemizer import phonemize
from phonemizer.separator import Separator
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
logging.getLogger('phonemizer').setLevel(logging.ERROR)

SPLIT = {'oːɹ': 'oː ɹ', 'ɑːɹ': 'ɑː ɹ', 'ɔːɹ': 'ɔː ɹ', 'aɪɚ': 'aɪ ɚ', 'aɪə': 'aɪ ə', 'əl': 'ə l', 'ɛɹ': 'ɛ ɹ',
         'ʊɹ': 'ʊ ɹ', 'ɪɹ': 'ɪ ɹ', 'iə': 'i ə', 'eə': 'e ə', 'ʊə': 'ʊ ə'}
NORM = {'ɐ': 'ə', 'ᵻ': 'ɪ', 'ɚ': 'ɝ', 'ɜ': 'ɝ', 'ɾ': 't', 'ɒ': 'ɑ', 'ɔ': 'ɑ', 'g': 'ɡ', 'ɫ': 'l', 'ʔ': 't', 'əʊ': 'oʊ'}
SHOW = {'ɐ': 'ə', 'ᵻ': 'ɪ', 'ɜ': 'ɝ', 'ɾ': 't̬', 'ɫ': 'l'}            # American-style IPA for the report
VOWELS = set('aeiouæɑɒɔəɛɪʊʌɝɐᵻɜɨøœɯɤy')
REDUCED = {'ə', 'ɪ', 'i', 'ʌ', 'u', 'ʊ', 'eɪ', 'ɝ', 'ɑ', 'oʊ', 'a', 'ɛ', 'e', 'o'}
# English sounds, plus a few a Ukrainian speaker may put in their place (x, r, ʋ, a, ɨ…). Everything else the
# multilingual recognizer knows (Chinese tones, aspirated stops…) is masked out.
ALLOW = set('''p b t d k ɡ f v θ ð s z ʃ ʒ h tʃ dʒ m n ŋ l ɹ j w i iː ɪ e eɪ ɛ æ ɑ ɑː ɒ ɔ ɔː o oʊ ʊ u uː ʌ ə ɚ ɜː
 aɪ aʊ ɔɪ ɐ ᵻ ɾ ʔ oːɹ ɑːɹ ɔːɹ aɪɚ aɪə əl ɛɹ ʊɹ ɪɹ iə x r ʋ a ɨ ɫ ts oː eː aː ɣ tʲ dʲ nʲ rʲ sʲ ʊə eə ɜ'''.split())

def norm(p):
    p = p.replace('ː', ''); return NORM.get(p, p)
def show(p):
    p = p.replace('ː', ''); return SHOW.get(p, 'ɝ' if p == 'ɜ' else p)
def is_vowel(p): return any(c in VOWELS for c in p)

class Ear:
    def __init__(self, name):
        torch.set_num_threads(os.cpu_count() or 4)
        self.m = Wav2Vec2ForCTC.from_pretrained(name).eval()
        self.vocab = Wav2Vec2Processor.from_pretrained(name).tokenizer.get_vocab()
        self.inv = {v: k for k, v in self.vocab.items()}; self.blank = self.vocab['<pad>']
        self.mask = torch.tensor([0.0 if (t in ALLOW or i == self.blank) else -1e9 for t, i in sorted(self.vocab.items(), key=lambda kv: kv[1])])

    def logprobs(self, x):
        x = (x - x.mean()) / (x.std() + 1e-7)
        with torch.no_grad():
            return torch.log_softmax(self.m(torch.tensor(x)[None]).logits[0] + self.mask, -1).numpy()

    def _ph(self, text):
        return phonemize(text, language='en-us', backend='espeak', separator=Separator(phone=' ', word=' | ', syllable=''),
                         strip=True, with_stress=True, preserve_punctuation=False, njobs=1)

    def expected(self, words):
        """[[(phone, in a stressed syllable), …] per word], phonemized in context (weak forms of to, a, the…)."""
        clean = [re.sub(r"[^A-Za-z0-9'\-]", '', w).strip("'-") or 'uh' for w in words]
        groups = self._ph(' '.join(clean)).split(' | ')
        if len(groups) != len(clean): groups = [self._ph(c) for c in clean]
        res = []
        for g in groups:
            ph = []
            for t in g.split():
                st = 'ˈ' in t or 'ˌ' in t; t = t.replace('ˈ', '').replace('ˌ', '')
                for u in SPLIT.get(t, t).split():
                    if u in self.vocab: ph.append((u, st and is_vowel(u)))
                    else: ph += [(c, False) for c in u if c in self.vocab]
            res.append(ph)
        return res

    def heard(self, lp):
        ids = lp.argmax(-1); out = []; prev = -1
        for f, i in enumerate(ids):
            if i != prev and i != self.blank:
                for u in SPLIT.get(self.inv[int(i)], self.inv[int(i)]).split(): out.append((u, f, int(i)))
            prev = i
        return out

def align(exp, hrd):
    """Needleman-Wunsch on normalized phones; [(i_expected | None, j_heard | None)]."""
    E = [norm(p) for p in exp]; H = [norm(p) for p in hrd]; n, m = len(E), len(H)
    sub = lambda x, y: 0 if x == y else (0.8 if is_vowel(x) == is_vowel(y) else 1.4)
    D = np.zeros((n + 1, m + 1)); D[:, 0] = np.arange(n + 1); D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + sub(E[i - 1], H[j - 1]), D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, path = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and np.isclose(D[i, j], D[i - 1, j - 1] + sub(E[i - 1], H[j - 1])): path.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and np.isclose(D[i, j], D[i - 1, j] + 1): path.append((i - 1, None)); i -= 1
        else: path.append((None, j - 1)); j -= 1
    return path[::-1]

def check(ear, x, words, margin_min, miss_max=np.log(0.05)):
    lp = ear.logprobs(x)
    exp_w = ear.expected(words)
    exp = [p for w in exp_w for p, _ in w]; stress = [s for w in exp_w for _, s in w]
    owner = [k for k, w in enumerate(exp_w) for _ in w]
    hrd = ear.heard(lp); path = align(exp, [h[0] for h in hrd])
    res = [{'word': w, 'exp': [p for p, _ in e], 'heard': [], 'off': []} for w, e in zip(words, exp_w)]
    last_w, last_f, off = 0, 0, 0
    for pi, (i, j) in enumerate(path):
        if i is not None: last_w = owner[i]
        if j is not None: res[last_w]['heard'].append(hrd[j][0]); last_f = hrd[j][1]
        if i is None: continue
        e, ne = exp[i], norm(exp[i]); prev = norm(exp[i - 1]) if i else ''; nxt_e = norm(exp[i + 1]) if i + 1 < len(exp) else ''
        eid = ear.vocab.get(e)
        if j is None:
            if ne == 'ə' or (ne == 'ɹ' and is_vowel(prev)): continue
            nxt = next((hrd[jj][1] for _, jj in path[pi + 1:] if jj is not None), lp.shape[0] - 1)
            if eid is not None and lp[last_f:nxt + 1, eid].max() > miss_max: continue
            off += 1; res[owner[i]]['off'].append([e, None]); continue
        h, f, hid = hrd[j]; nh = norm(h)
        if nh == ne: continue
        if is_vowel(ne) and not stress[i] and ne in REDUCED: continue
        if {ne, nh} <= {'t', 'd'} and is_vowel(prev) and is_vowel(nxt_e): continue
        lo, hi = max(0, f - 1), min(lp.shape[0], f + 2)
        if lp[f, hid] - (lp[lo:hi, eid].max() if eid is not None else -20) < margin_min: continue
        off += 1; res[owner[i]]['off'].append([e, h])
    return res, off / max(1, len(exp))

# ---------- what the swaps mean ----------
LABEL = {('æ', 'ɛ'): '"pan" sounds like "pen"', ('ɛ', 'æ'): '"pen" sounds like "pan"', ('æ', 'a'): 'æ too open, like Ukrainian а',
         ('æ', 'ɑ'): '"cat" sounds like "cot"', ('æ', 'e'): '"pan" sounds like "pen"', ('ɪ', 'i'): '"ship" sounds like "sheep"',
         ('i', 'ɪ'): '"sheep" sounds like "ship"', ('ɪ', 'ɨ'): 'ɪ like Ukrainian и', ('ʊ', 'u'): '"full" sounds like "fool"',
         ('u', 'ʊ'): '"fool" sounds like "full"', ('θ', 's'): '"think" sounds like "sink"', ('θ', 't'): '"think" sounds like "tink"',
         ('θ', 'f'): '"think" sounds like "fink"', ('ð', 'd'): '"this" sounds like "dis"', ('ð', 'z'): '"this" sounds like "zis"',
         ('ð', 'v'): '"this" sounds like "vis"', ('w', 'v'): '"wine" sounds like "vine"', ('w', 'ʋ'): 'w like Ukrainian в',
         ('v', 'w'): '"vine" sounds like "wine"', ('ŋ', 'n'): '"sing" sounds like "sin"', ('h', 'x'): 'h rough, like Ukrainian х',
         ('ɹ', 'r'): 'rolled r', ('ʌ', 'ɑ'): '"cup" sounds like "cop"', ('ʌ', 'a'): 'ʌ like Ukrainian а', ('ʌ', 'o'): '"cup" with an o',
         ('oʊ', 'ɑ'): '"coat" sounds like "caught"', ('oʊ', 'o'): 'oʊ said as one flat o', ('eɪ', 'e'): 'eɪ said as one flat e',
         ('eɪ', 'ɛ'): '"late" sounds like "let"', ('ɝ', 'ɑ'): '"work" sounds like "walk"', ('ɝ', 'ɛ'): 'ɝ like e ("work" → "werk")',
         ('ɝ', 'o'): '"work" sounds like "wok"', ('ɝ', 'oʊ'): '"work" sounds like "woke"', ('z', 's'): 'z said as s ("his" → "hiss")',
         ('d', 't'): 'd said as t ("bad" → "bat")', ('v', 'f'): 'v said as f ("have" → "haf")', ('b', 'p'): 'b said as p',
         ('ɡ', 'k'): 'g said as k ("bag" → "back")', ('ʒ', 'ʃ'): 'ʒ said as ʃ', ('dʒ', 'tʃ'): 'j said as ch'}

def describe(e, h):
    e, h = norm(e), norm(h) if h else None
    if h is None: return f'{show(e)} left out'
    return f'{show(e)} → {show(h)}' + (f': {LABEL[(e, h)]}' if (e, h) in LABEL else '')

mmss = lambda t: f'{int(t // 60):02d}:{int(t % 60):02d}'
WHO = {'S': 'Student', 'T': 'Teacher', '?': 'Speaker unknown'}

ear = Ear(a.model)
T = turns(rows); checked, skipped = [], collections.Counter()
for n, tw in enumerate(T):
    s0, s1 = max(0, tw[0][0] - 0.1), min(len(audio) / SR, tw[-1][1] + 0.1)
    x = audio[int(s0 * SR):int(s1 * SR)]
    if len(x) < 0.3 * SR: continue
    res, share = check(ear, x, [r[2] for r in tw], a.margin)
    if share > 0.4 and len(tw) >= 2:                 # mostly different: Ukrainian (translated by Whisper) or noise
        skipped[tw[0][4]] += len(tw); continue
    for r, w in zip(tw, res):
        checked.append({'t': round(r[0], 2), 'who': r[4], 'word': w['word'], 'whisper': r[3],
                        'expected': ' '.join(show(p) for p in w['exp']), 'heard': ' '.join(show(p) for p in w['heard']), 'off': w['off']})
    if n % 50 == 0: print(f'{n}/{len(T)} turns', flush=True)
json.dump(checked, open(J('sounds.json'), 'w'), ensure_ascii=False)

out = []
for who in sorted({c['who'] for c in checked}, key='STU?'.index):
    ws = [c for c in checked if c['who'] == who]
    nphones = sum(len(c['expected'].split()) for c in ws); noff = sum(len(c['off']) for c in ws)
    out.append(f'== {WHO[who]}: {len(ws)} English words checked, {noff} sounds off ({100 * noff / max(1, nphones):.1f}% of sounds)'
               + (f'; {skipped[who]} words skipped as not English' if skipped[who] else ''))
    pat = collections.defaultdict(list)
    for c in ws:
        for e, h in c['off']: pat[(norm(e), norm(h) if h else None)].append(c)
    rep = sorted(((k, v) for k, v in pat.items() if len({c['word'].lower() for c in v}) >= 2),
                 key=lambda kv: (-len({c['word'].lower() for c in kv[1]}), -len(kv[1])))
    if rep:
        out.append('Repeated swaps (in different words; listen to a few before you trust one):')
        for (e, h), v in rep[:12]:
            ex = ', '.join(f'{c["word"].strip(".,?!")} {mmss(c["t"])}' for c in v[:6])
            tot = sum(1 for c in ws if norm(e) in [norm(p) for p in c['expected'].split()])
            out.append(f'  {describe(e, h)}  ·  {len(v)} of {tot} times  ·  {ex}')
    else:
        out.append('No swap repeats across different words.')
    offw = [c for c in ws if c['off']]
    if offw:
        out.append('Words that sounded off (expected /…/ heard /…/):')
        for c in offw[:60]:
            out.append(f'  {mmss(c["t"])}  {c["word"].strip(".,?!"):<14} /{c["expected"].replace(" ", "")}/  heard /{c["heard"].replace(" ", "")}/  ·  '
                       + '; '.join(describe(e, h) for e, h in c['off']))
        if len(offw) > 60: out.append(f'  … {len(offw) - 60} more in sounds.json')
    out.append('')
open(J('sounds.txt'), 'w').write('\n'.join(out))
print('\n'.join(out[:40]))

# ---------- tone of voice ----------
if a.no_tone: sys.exit()
logging.disable(logging.INFO)
from funasr import AutoModel
from huggingface_hub import snapshot_download
emo = AutoModel(model=snapshot_download('emotion2vec/emotion2vec_plus_base'), disable_update=True, device='cpu', disable_pbar=True, log_level='ERROR')
NAMES = {'angry': 'angry', 'disgusted': 'disgusted', 'fearful': 'nervous', 'happy': 'happy', 'neutral': 'calm',
         'other': 'other', 'sad': 'sad', 'surprised': 'surprised'}
tone = []
for tw in turns(rows, gap=1.5, longest=20.0):
    s0, s1 = tw[0][0], tw[-1][1]
    if s1 - s0 < 1.5: continue
    r = emo.generate(audio[int(s0 * SR):int(s1 * SR)], granularity='utterance', extract_embedding=False, disable_pbar=True)[0]
    sc = {l.split('/')[-1]: s for l, s in zip(r['labels'], r['scores']) if '/' in l}
    best = max(sc, key=sc.get)
    tone.append({'t': s0, 'dur': s1 - s0, 'who': tw[0][4], 'tone': NAMES.get(best, best), 'p': sc[best], 'text': ' '.join(w[2] for w in tw)})
lines = []
for who in sorted({t['who'] for t in tone}, key='STU?'.index):
    ts = [t for t in tone if t['who'] == who]; dur = sum(t['dur'] for t in ts)
    words = sum(len(t['text'].split()) for t in ts)
    share = 100 * dur / max(1, sum(t['dur'] for t in tone))
    mix = collections.Counter()
    for t in ts: mix[t['tone']] += t['dur']
    lines.append(f'== {WHO[who]}: {round(dur / 60, 1)} min of speech ({share:.0f}% of talk time), {round(60 * words / max(1, dur))} words a minute')
    lines.append('  tone: ' + ', '.join(f'{k} {100 * v / dur:.0f}%' for k, v in mix.most_common()))
    loud = [t for t in ts if t['tone'] not in ('calm', 'other') and t['p'] >= 0.6]
    for t in loud[:25]:
        lines.append(f'  {mmss(t["t"])}  {t["tone"]} ({t["p"]:.0%})  {t["text"][:90]}')
    lines.append('')
open(J('tone.txt'), 'w').write('\n'.join(lines))
print('\n'.join(lines)); print('wrote', J('sounds.txt'), J('sounds.json'), J('tone.txt'))
