# Lesson Notebook

Turns English-lesson transcripts into:
1. **Student cards**: phone-sized PNGs the teacher sends to the student.
2. **A per-student report site** for the teacher: https://claude.ai/artifact/XKucktSiX3sqHTdqUBjsZD

Student data (transcripts, lesson JSON, card images) never goes into this repo. It lives in the
artifact's database and asset store.

## When the user sends a transcript

The transcript is auto-generated and has no speaker labels. The teacher is a Ukrainian speaker who
teaches in English; students are mostly Ukrainian speakers. Infer who said what from context, and say so
in the teacher report. The teacher and all students speak only Ukrainian besides English: Russian- or
Polish-looking fragments are transcription errors of Ukrainian, never Russian or Polish. Some lessons are
recorded on the teacher's phone and catch mostly the teacher's voice: say so and keep the student's
mistakes list short. The teacher sometimes sends the lesson materials (slides) too.

Students (all learn American English):
- Sergii: B1, Tuesdays at 4 PM. Pays weekly for himself and his daughter Vaselina (also a student).
  Dislikes exercises and websites: plan his lessons as talk, cards very visual with little to read.
- Vaselina: a child, A1 (estimate), Sergii's daughter. Kids' materials, her topics (toys, animals, food);
  she tells long stories in Ukrainian. Her ledger is `billing/vaselina` (paid by Sergii).
  Her cards must be super simple and playful: set `kid: true` in her lesson JSON (bright tiles, round font,
  big pictures). About 6 words with emojis and no examples, a `qa` cheat sheet, 2–3 very short phrases
  with an emoji each, no "not X" notes and no wrong forms.
- Vova: A2+, 3 lessons a week, pays for 10-lesson packages. Knows don't / doesn't have well (Julia is the one who mixes it up).
- Victoria: A2- (estimate), lives in western Canada, works in delivery. 2–3 lessons a week, payment not decided.
  Survival block first: one practical pattern at a time from her real week, lots of repetition, then unit 1.
  Keep the short forms that already work for her ("Sorry?" to ask for a repeat); don't teach longer versions.
- Julia: A2+, pays after each lesson and is always paid: never log her lessons or payments in billing. Has had present simple, present continuous, past simple and will; past
  continuous only a glimpse (not for drills yet).
- Mariya: A2, 2 lessons a week, pays weekly.
- Other students are on a break.

1. Write the lesson JSON (shape below) in the scratchpad, not in the repo.
2. Render the cards: `node tools/render-cards.js <lesson.json> <out-dir>`, then look at them.
3. Upload the PNGs to the artifact: Artifact tool, `asset: true`, `url`, `file_paths`. Put the returned
   ids into `cards[].asset`.
4. Write the database rows with ArtifactData `batch` (read first, then pin `if_version` on existing docs):
   - `billing/<slug>`: add `{date, kind: "lesson", n: -1}` for the lesson date unless an entry of kind
     "lesson" for that date is already there (the teacher may have tapped "− Lesson"). Payments come only
     from the teacher: add `{date, kind: "paid", n: perPayment}` when she tells you.
   - `students/<slug>`: create the student, or update `focus` (bump `seen`, set `status` to recurring,
     improving or fixed).
   - `lessons/<slug>-<YYYY-MM-DD>`: the lesson JSON without `studentCards`, plus `cards`.
   - `teacher/profile`: refresh `englishFocus`, `teachingFocus`, `lessonsReviewed`, `updated`.
   - `progress/<slug>`: the teacher moves units with the buttons. Read it; only if the lesson clearly
     finished the current unit and she hasn't moved it, mention it in the reply (don't move it yourself).
5. Send the cards to the user with SendUserFile and give them the site link.

**Text the teacher might forward to a student** (answers to a student's question, a message, a reading text)
goes in its own fenced block that contains only what the student should read: no name or label inside it
(put "Text for <name>" as a line above the block), no comments to the teacher, no "your student", no feedback.
Everything outside the block is for the teacher.
She once forwarded a whole reply to a student by mistake.

## What the teacher asked for

- **Replies in chat are short**: say briefly what you did and give the links; don't list the lesson content.

- **American English** everywhere: spelling, vocabulary and IPA (/wɝk/, not /wɜːk/). IPA goes on the
  teacher site only: **no phonetic transcription on student cards**.
- **Student cards**: readable on a phone, no student name, no page count, no "lesson notes" caption
  (only a small, quiet date beside the kicker), no homework or mini-task. Usual set:
  words they looked for (split by theme if long), "Say it like this" phrases, the grammar point, the
  **3 most important fixes** only, and **pronunciation as its own card**.
- The teacher usually sends only **2–3 cards**: the words cards and one visual cheat sheet (table or
  comparison with emojis) for the lesson's main topic, sometimes "Say it like this" and pronunciation.
  Put those first; keep subtitles short or leave them out.
- **Words card**: only words the student actually searched for, not words you prompted in a drill.
  For irregular verbs, show all three forms (catch – caught – caught) and put them at the end.
- **"Say it like this"**: 3–4 phrases only; plain, everyday sentences from the lesson. Skip idioms, slang and jokes
  (she removed "I was swamped", "pipe dream", "Good for him!", "I could go for some cake").
- **Pronunciation card**: one pair only, with practice sentences. No extra "same sound" lists or side notes.
  Big emoji beside each word; highlight the stressed (or key) part in yellow, like `[DE]sert`.
  For A2 and below, write the mouth tips in Ukrainian ("Опустіть щелепу", not "Drop your jaw").
  Never repeat a pair the student already had (check her earlier lessons' cards first: Julia had desert/dessert
  and of/off). Fast-speech forms from the lesson (let me → "lemme") are a good alternative.
- The **full mistakes report** is for the teacher only, on the site, with timestamps and priorities.
- A **report on the teacher**: their own English (quote, better version, why) and their teaching
  (what worked, what to try next time). **Be as blunt as possible**: only the teacher reads it. Keep
  tracking the teacher's pronunciation (e.g. pan sounding like pen).
- **Reading texts**: only when she asks. Give plain text in chat, not pictures, no questions at the end.
  Stories must not describe the student's own life or retell what she told the teacher (her appointment,
  her order, a compliment she got): change the people, places and events. Use the student's target words and mostly the
  structure from their last lesson. ~120–170 words for A2, ~60 for Sergii (he dislikes long texts).
  Make them sound like real people talking (contractions, short replies, "Kind of", "No way"), add an occasional
  emoji, and don't end with someone laughing.
- **Song lessons** (e.g. Julia: "Human") need the video on the page, which Claude pages can't embed: they live in
  `docs/` and are served by GitHub Pages (https://kiril-tishko.github.io/craneberries/). Each step shows a few key
  words, then plays just the line that has them (YouTube player in the page). Subtitles under the video load live
  from lrclib.net when the page opens (timed lyrics, key words highlighted); never store lyrics in the repo.
  Key words show the Ukrainian translation (no "what the line means" box: it was just a translation); a 💡 Note
  (hidden until tapped) only where something is easy to miss. In future video lessons (podcasts, shows), tapping
  any word shows its Ukrainian translation.
- **Lesson pages** (an interactive page she screen-shares; build with `tools/lesson-page/`: write a
  content file like `example-content.js`, record it with `extract.js` + `voice.py`, then `build.py`, test every
  screen at phone and laptop size, publish as a new artifact with the mp3s in `files`):
  - **One topic per lesson** by default (e.g. "At the dentist"). When she lists the parts she wants, follow her
    order (Julia: repeat old phrases → new useful phrases → change the time → grammar). Start with recall of
    earlier phrases: the Ukrainian prompt first, she says the English, then taps Answer.
  - One thing per screen, an "All together" screen at the end of each part, no scrolling.
  - No "change one word" drills that only swap numbers or days: she finds them pointless. Use **change the time**
    instead (`flip`: every day → now / yesterday / tomorrow) with the tenses the student has had.
  - When the student knows a rule but forgets it in speech (Julia's he/she + s), don't explain it: use
    `flip` screens (`{t:'flip', from, subj, ans}` with the changed part in [brackets]) so she says it herself.
  - Keep each drill set short (about 4 items). A rule she asks for gets one `rule` screen
    (`{t:'rule', label, rows[[icon, head, ukrainian note, "example · example"]]}`) in Ukrainian, then quick practice.
    Say it directly (✅ where it goes, ❌ where it doesn't); don't build up from theory.
  - Recall at the start: short, easy sentences.
  - Every drill sentence must be one people really say often ("Do you have any plans for the weekend?", not
    "The bank didn’t refuse any applications"). Recycle the student's words inside such common sentences.
  - "My sentences" boxes stay empty: no example sentences in them.
  - Pictures: when presenting new words or phrases that are easy to picture, give the screen a big emoji
    (`pic`, the last argument of `P`/`R`, or `pic` on a `flip`). When an emoji doesn't show the thing (🛒 is not a
    checkout), draw an SVG (`pic` and card `svg` take one; keep it on one line in content.js). Reusable drawings: `tools/pics/`.
  - **Never put personal data on a page**: no student names (sign emails with a made-up name), no real
    details of their work or life (company deals, customers, places, dates of birth). Use made-up, general examples.
  - **No role-play** for now: she didn't like how it worked. Leave it out unless she asks for it.
  - Explain a word only in the meaning the topic needs (treat = лікувати at the dentist; no list of meanings).
  - **Never draw faces, mouths or body diagrams**: she found the drawn mouth creepy.
  - "Go ahead" and "After you" both mean «Проходьте»; accept either.
- **Site text is short and practical**: summary 1–2 short sentences; max 3 "went well" bullets; mistake
  notes a few words or empty; plan details one short line; teacher "worked" 3 bullets, "try next time"
  3–4 bullets, `why` a few words; no `talk`, `note` or `habits` text. Student `about` one line, `focus`
  max 5 short issues. `nextWhen` short ("Tue, Nov 10"). Teacher profile: max 4–5 items per list.
- Keep sensitive details (health, conflicts at work, opinions about named people) off the cards.

## Lesson JSON shape

```
student, date (YYYY-MM-DD), durationMin, topics[], grammar, summary, talk, strengths[], nextWhen (optional),
kid (optional: true = children's look for every card)
words[]        {t, ua, en, ex}
mistakes[]     {id, priority: high|medium|low, cat, count, t[], said, better, note}
pronunciation[]{id, confidence: clear|check, issue, evidence, tip}
phrases[]      {en, note}
nextLesson[]   {min, title, detail}
teacher        {note, english[{t, said, better, why}], habits[], strengths[], improve[]}
studentCards[] one of:
  {type: "words",   kicker, title, sub, items[{ua, en, ex, emoji?}]}
                    items with `emoji` render as big picture rows; with `kid`, as a grid of colored picture tiles;
                    `grid: true` gives the tile grid in the adult look (no reading needed); an item's `svg` replaces
                    the emoji when no emoji fits (🍴 shows a fork AND a knife, 🍽️ a plate with cutlery)
  {type: "phrases", kicker, title, sub, items[{en, note, emoji?}]}   emoji shows in front of each phrase
                    (with `kid`: colored bubbles, big emoji)
  {type: "qa",      kicker, title, q, pics[{emoji, en}], answers[{emoji, text, tone: yes|no}]}
                    children's cheat sheet: a question bubble with pictures, then big answer tiles
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
`state` (the page writes the teacher's "discussed" and "sent" ticks; Claude doesn't overwrite it),
`billing` (both write: `{plan, perPayment, log[{date, kind, n}]}`, balance = sum of `n`, in lessons).
The word bank on each student page merges `bank/<slug>` (words the teacher sent in chat before these
reports: `{words[{en, theme, n, sent}]}`, n = position, 1 = newest; themes: work, money, numbers, law,
people, less, everyday, phrases, city, weather, food, home, event, grammar, sounds, health) with every lesson's
`words`, so keep `words` accurate. The teacher's "reviewed" taps live in `state/bank-<slug>`.
`materials/<slug>` = `{items[{n, date, title, url, issue}]}`, newest first: links the teacher sent the student,
with a short quality note (British usage, errors, overload). Her "reviewed again" ticks live in
`state/mat-<slug>`. Materials must be American English; flag British forms when you see them.

**Course.** `course/plan` (Claude writes) = the 30-unit backbone, same order for every student:
`units[{n, grammar, cando, words, sound, materials[{title, url}], fix, extra}]`, `phases[{name, from, to, sum}]`,
`reviewAfter[]` (review week after units 4, 8, …), `checks{12, 24}`, and the "How to teach" parts: `lesson[{min,
title, detail}]`, `steps[]`, `pace[{who, time, how}]`, `review[{when, what}]`, `feedback[]`, `words[]`,
`sounds[{sound, pair, who}]`, `soundLinks[{title, url, note}]` (see-the-mouth videos, e.g. Seeing Speech),
`principles[{idea, you, src, url}]`, `wordMaterials[]`, `wordMaterialsFix`.
`progress/<slug>` (the page writes; Claude only creates it for a new student) = `{current, done[], started{n: date},
pace, note, prev}`. Base each lesson's `nextLesson` plan on the student's current unit. When the teacher sends a new
material, add it to the matching unit's `materials` (and `fix` if it needs changes). Site tabs: Students, Course
(Units · every student / How to teach · you), My teaching.
