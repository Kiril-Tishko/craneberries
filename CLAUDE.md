# Lesson Notebook

Turns English-lesson transcripts into:
1. **Student cards**: phone-sized PNGs the teacher sends to the student.
2. **A per-student report site** for the teacher: https://claude.ai/artifact/XKucktSiX3sqHTdqUBjsZD

Student data (transcripts, lesson JSON, card images) never goes into this repo. It lives in the
artifact's database and asset store.

## When the user sends a transcript

The transcript is auto-generated and has no speaker labels. The teacher is a Ukrainian speaker who
teaches in English; students are mostly Ukrainian speakers. Infer who said what from context, and say so
in the teacher report.

1. Write the lesson JSON (shape below) in the scratchpad, not in the repo.
2. Render the cards: `node tools/render-cards.js <lesson.json> <out-dir>`, then look at them.
3. Upload the PNGs to the artifact: Artifact tool, `asset: true`, `url`, `file_paths`. Put the returned
   ids into `cards[].asset`.
4. Write the database rows with ArtifactData `batch` (read first, then pin `if_version` on existing docs):
   - `students/<slug>`: create the student, or update `focus` (bump `seen`, set `status` to recurring,
     improving or fixed).
   - `lessons/<slug>-<YYYY-MM-DD>`: the lesson JSON without `studentCards`, plus `cards`.
   - `teacher/profile`: refresh `englishFocus`, `teachingFocus`, `lessonsReviewed`, `updated`.
5. Send the cards to the user with SendUserFile and give them the site link.

## What the teacher asked for

- **American English** everywhere: spelling, vocabulary and IPA (/wɝk/, not /wɜːk/). IPA goes on the
  teacher site only: **no phonetic transcription on student cards**.
- **Student cards**: readable on a phone, no student name, no page count, no "lesson notes" caption
  (only a small, quiet date beside the kicker), no homework or mini-task. Usual set:
  words they looked for (split by theme if long), "Say it like this" phrases, the grammar point, the
  **3 most important fixes** only, and **pronunciation as its own card**.
- The teacher usually sends only **2–3 cards**: the words cards and one visual cheat sheet (table or
  comparison with emojis) for the lesson's main topic, sometimes "Say it like this" and pronunciation.
  Put those first; keep subtitles short or leave them out.
- **"Say it like this"**: plain, everyday sentences from the lesson. Skip idioms, slang and jokes
  (she removed "I was swamped", "pipe dream", "Good for him!", "I could go for some cake").
- **Pronunciation card**: one pair only, with practice sentences. No extra "same sound" lists or side notes.
  Big emoji beside each word; highlight the stressed (or key) part in yellow, like `[DE]sert`.
- The **full mistakes report** is for the teacher only, on the site, with timestamps and priorities.
- A **report on the teacher**: their own English (quote, better version, why) and their teaching
  (what worked, what to try next time).
- **Site text is short and practical**: summary 1–2 short sentences; max 3 "went well" bullets; mistake
  notes a few words or empty; plan details one short line; teacher "worked" 3 bullets, "try next time"
  3–4 bullets, `why` a few words; no `talk`, `note` or `habits` text. Student `about` one line, `focus`
  max 5 short issues. `nextWhen` short ("Tue, Nov 10"). Teacher profile: max 4–5 items per list.
- Keep sensitive details (health, conflicts at work, opinions about named people) off the cards.

## Lesson JSON shape

```
student, date (YYYY-MM-DD), durationMin, topics[], grammar, summary, talk, strengths[], nextWhen (optional)
words[]        {t, ua, en, ex}
mistakes[]     {id, priority: high|medium|low, cat, count, t[], said, better, note}
pronunciation[]{id, confidence: clear|check, issue, evidence, tip}
phrases[]      {en, note}
nextLesson[]   {min, title, detail}
teacher        {note, english[{t, said, better, why}], habits[], strengths[], improve[]}
studentCards[] one of:
  {type: "words",   kicker, title, sub, items[{ua, en, ex}]}
  {type: "phrases", kicker, title, sub, items[{en, note}]}
  {type: "grammar", kicker, title, rule, ruleUa, examples[{text, note}], forms[{label, text}], tip}
  {type: "compare", kicker, title, cols[{emoji, head, rule, items[]}], examples[], tip}
                    visual cheat sheet for "A vs B vs C" topics (drive / ride / go), emojis in items
  {type: "verbs",   kicker, title, sub, focus (0|1|2), head[{label, hint}], rows[{emoji, base, past, pp}], examples[]}
                    irregular verbs: all 3 forms, highlight the column the lesson needs, emojis, no subtitle
  {type: "forms",   kicker, title, sub, items[{base, pp}], examples[]}   (older two-form version)
  {type: "fixes",   kicker, title, sub, items[{wrong, right, why}]}
  {type: "pron",    kicker, title, label, pairs[{emoji, word, tip}], practice[]}
                    with emoji: full-width rows, big emoji beside the word. Mark the stressed syllable
                    ([DE]sert, des[SERT]) in the word and in the practice sentences. No IPA on cards.
```
In `grammar`, `forms` and `phrases` text, `[used to]` marks a highlighted span (e.g. the articles in
"Our designer sent us [a] new project"). When the teacher already had a good presentation on the topic,
skip the cheat sheet and use the student's own corrected sentences instead. When a lesson covers two grammar
points, give each its own grammar card.

## Site

`site/index.html` is the artifact page. Republish it with the Artifact tool and
`url: https://claude.ai/artifact/XKucktSiX3sqHTdqUBjsZD` (read it first from a new session).
Capabilities: `db`, `assets`, `downloads`. Collections: `students`, `lessons`, `teacher` (Claude writes),
`state` (the page writes the teacher's "discussed" and "sent" ticks; Claude doesn't overwrite it).
