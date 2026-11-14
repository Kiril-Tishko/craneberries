# Lesson Notebook

Turns English-lesson transcripts into:
1. **Student cards**: phone-sized PNGs the teacher sends to the student.
2. **A per-student report site** for the teacher: https://claude.ai/artifact/XKucktSiX3sqHTdqUBjsZD

Student data (transcripts, lesson JSON, card images) never goes into this repo. It lives in the
artifact's database and asset store.

## When the user sends a transcript

The transcript is auto-generated and has no speaker labels. The teacher is a Ukrainian speaker who
teaches in English; students are mostly Ukrainian speakers. Infer who said what from context, and say so
in the teacher report. Besides English, the teacher and the students speak Ukrainian, and everything in their language is Ukrainian.
**One exception:** a student whose `brief` has `language: Russian` gets lesson pages (content file sets
`const LANG = 'ru'`), card tips and word translations in Russian, and the Russian in their recordings is real.
Never carry this over to anyone else. For everyone else, Russian- or Polish-looking fragments are transcription
errors of Ukrainian, never Russian or Polish. Some lessons are
recorded on the teacher's phone and catch mostly the teacher's voice: say so and keep the student's
mistakes list short. The teacher sometimes sends the lesson materials (slides) too.

**Students.** All learn American English. Their notes are **not in this repo, because it is public**: each
student's level, schedule, billing rule, goals, preferences and what they have covered are in the site
database, in the `brief` field of `students/<slug>` (list the `students` collection to see who there is).
- Read the student's `brief` before any work for them. When the teacher tells you something new about a
  student, update the `brief` there (short; no sensitive details such as health, family or money troubles).
- Never write a student's name or personal details in this repo: not in files, not in commit messages.
- The `brief` is for planning only. Nothing personal about a student or about the teacher (job details, goals,
  family, where they live, what they told the teacher) may appear in anything a student can see: lesson pages,
  cards, texts.
- A child's cards must be super simple and playful: set `kid: true` in the lesson JSON (bright tiles, round
  font, big pictures). About 6 words with emojis and no examples, a `qa` cheat sheet, 2–3 very short phrases
  with an emoji each, no "not X" notes and no wrong forms.

1. Write the lesson JSON (shape below) in the scratchpad, not in the repo.
2. **Ask her first** which words, phrases and sound go on the cards: AskUserQuestion, multiple choice, several
   answers allowed, your picks first (forgotten words, corrected phrases, the sound pair). The site report doesn't
   wait for her answer; the cards do. Then render only what she chose: `node tools/render-cards.js <lesson.json>
   <out-dir>`, and look at them.
3. Upload the PNGs to the artifact: Artifact tool, `asset: true`, `url`, `file_paths`. Put the returned
   ids into `cards[].asset`.
4. Write the database rows with ArtifactData `batch` (read first, then pin `if_version` on existing docs):
   - `billing/<slug>`: add `{date, kind: "lesson", n: -1}` for the lesson date unless an entry of kind
     "lesson" for that date is already there (the teacher may have tapped "− Lesson"), or the student's `brief`
     says not to log their billing. Payments come only from the teacher: add `{date, kind: "paid", n: perPayment}`
     when she tells you.
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

## When the user sends audio

Recordings never leave the container (work in the scratchpad; `pip install faster-whisper soundfile`, model from
huggingface.co, about 15 min per hour of audio).
- **PC + phone recordings of the same lesson**: `python3 tools/audio/lesson-audio.py <work-dir> --pc <file> --phone <file>`
  (add `--pc-is-student` when the PC recorded only the student). It lines the two up and labels every word: the teacher
  is loud on the phone, the student is almost silent there. Work from `transcript.txt` (one turn per line, S = student,
  T = teacher, PC times; ⁽NN⁾ = recognizer unsure) and tell her in one line how good it was (`quality.txt`).
- **One recording only**: `python3 tools/audio/transcribe.py <file> <scratchpad prefix>`. A phone recording catches
  mostly the teacher; a PC recording is one mixed track. No speaker labels: infer who spoke from context and say so
  in the summary. Don't guess what can't be told.
- Then the same steps as for a transcript, with `source: "audio"`.
- Pronunciation notes for the student and the teacher: a word the recognizer got wrong or was unsure of is a hint,
  not proof. Mark it `confidence: check`.
- Chat uploads are limited to 30 MB. Speech needs no more than mono 32 kbps (an hour ≈ 15 MB).

## What the teacher asked for

- **Replies in chat are short**: say briefly what you did and give the links; don't list the lesson content.
- **Questions to her are multiple choice** (AskUserQuestion, recommended option first), never open questions in chat.
  When a request is unclear ("a review sheet": page, picture or text?), ask that way before building.

- **American English** everywhere: spelling, vocabulary and IPA (/wɝk/, not /wɜːk/). IPA goes on the
  teacher site only: **no phonetic transcription on student cards**.
- **Student cards**: readable on a phone, no student name, no page count, no "lesson notes" caption
  (only a small, quiet date beside the kicker), no homework or mini-task. Usual set:
  words they looked for (split by theme if long), "Say it like this" phrases, the grammar point, the
  **3 most important fixes** only, and **pronunciation as its own card**.
- The teacher usually sends only **2–3 cards**: the words cards and one visual cheat sheet (table or
  comparison with emojis) for the lesson's main topic, sometimes "Say it like this" and pronunciation.
  Put those first; keep subtitles short or leave them out.
- **Pictures first, for every student**: a card should be understood at a glance: big pictures, almost nothing
  to read (picture tiles with `grid: true`; picture rows when the words are long). Give about 3 cards to choose
  from; she usually sends one.
- **Review cards and review sheets: ask first**, every time, with multiple-choice questions (several answers
  allowed) about what goes on them. Never pick the content on your own.
- **Cards are a quick recap of what was said, never something the student sees for the first time.**
  - Words card ("Don't forget"): only words the student **forgot** in the lesson (asked again, couldn't recall).
  - "Say it like this": the phrases that were corrected in the lesson.
  - Brand-new words and mistakes nobody corrected go to the next lesson: a "Next lesson · Words to review" card
    for the teacher, and a short list of phrases to talk about in the chat reply (teacher only).
  - Pronunciation: give 2–3 card options so she can pick one.
  (Rule from Nov 11 on; earlier cards stay as they are.)
  For irregular verbs, show all three forms (catch – caught – caught) and put them at the end.
- **"Say it like this"**: 3–4 phrases only; plain, everyday sentences from the lesson. Skip idioms, slang and jokes
  (she removed "I was swamped", "pipe dream", "Good for him!", "I could go for some cake").
- **Pronunciation card**: one pair only, with practice sentences. No extra "same sound" lists or side notes.
  Big emoji beside each word; highlight the stressed (or key) part in yellow, like `[DE]sert`.
  For A2 and below, write the mouth tips in the student's language ("Опустіть щелепу", not "Drop your jaw").
  Never repeat a pair the student already had (check their earlier lessons' cards and their `brief` first).
  Fast-speech forms from the lesson (let me → "lemme") are a good alternative.
- The **full mistakes report** is for the teacher only, on the site, with timestamps and priorities.
- A **report on the teacher**: their own English (quote, better version, why) and their teaching
  (what worked, what to try next time). **Be as blunt as possible**: only the teacher reads it. Keep
  tracking the teacher's pronunciation (e.g. pan sounding like pen).
- **Reading texts**: only when she asks. Give plain text in chat, not pictures, no questions at the end.
  Stories must not describe the student's own life or retell what she told the teacher (her appointment,
  her order, a compliment she got): change the people, places and events. Use the student's target words and mostly the
  structure from their last lesson. ~80–120 words for A2 (she asked for shorter texts); shorter, or none, when the student's `brief` says so.
  Make them sound like real people talking (contractions, short replies, "Kind of", "No way"), add an occasional
  emoji, and don't end with someone laughing. Use only words the student already knows or met in lessons; a word
  she asked about but never got taught (e.g. "interrupt") stays out until it has been taught.
- **Song lessons** (e.g. "Human") need the video on the page, which Claude pages can't embed: they live in
  `docs/` and are served by GitHub Pages (https://kiril-tishko.github.io/craneberries/). Each step shows a few key
  words, then plays just the line that has them (YouTube player in the page). Subtitles under the video load live
  from lrclib.net when the page opens (timed lyrics, key words highlighted); never store lyrics in the repo.
  Key words show the Ukrainian translation (no "what the line means" box: it was just a translation); a 💡 Note
  (hidden until tapped) only where something is easy to miss. In future video lessons (podcasts, shows), tapping
  any word shows its Ukrainian translation.
- **Real video clips** (docs/real-video/, GitHub Pages): a native speaker says the word in a real video. Our own
  YouTube player in one panel (no YouTube buttons, title or timeline; play/pause, a timeline to tap or drag, our caption
  bar; a "With context" switch (1–2 lines before and after, the caption bar follows them; the yellow part of the
  timeline shows only then); 1× / 0.75× / 0.5×; a big "Next clip" with a small ‹ back arrow; no "Again" button: at the
  end the play button turns into ↻). A hidden second player preloads the next clip so Next starts at once; replays
  jump back instead of reloading. The caption bar keeps the height of the word's longest line, so nothing below it
  moves. No text explaining the controls and no "Speed" label: she wants it quiet; the
  YouTube Terms / Google Privacy links stay behind a faint ⓘ at the bottom. Space = play/pause wherever the focus is,
  ← → and double-tap = 1 s; pause goes on from where it stopped (a press just as the clip ends never restarts it);
  the picture is dark only before the clip starts, a paused clip is only dimmed. The clip stops when its line ends,
  before the next line.
  **The clip library** (one place for every lesson and student; a word is picked once and reused):
  - One file per word: `docs/real-video/words/<slug>.json` (slug: lowercase, letters and digits joined by "-";
    "Is that a thing?" → `is-that-a-thing`) = `{en, ua, pic, hl?, clips: [{v, s, e, line, note, noteUa?, around?,
    hidden?}]}`: v = YouTube id, s/e = where the line starts/ends (seconds; exact decimals when known), note = the 💡
    note in English, noteUa in Ukrainian, around = `[[start, end, line], …]` 1–2 lines before and after (for "With
    context"), hidden = kept but not shown, hl = a regex for other forms of the word ("rip[- ]?off").
    `words/index.json` lists them for the search: after changing word files run `python3 tools/real-video/build_index.py`.
  - The player reads them: `https://kiril-tishko.github.io/craneberries/real-video/?words=rip-off,excuse` (a lesson's
    words; `&title=…`, `&notes=ua` for Ukrainian notes, `&from=lesson` adds "← Lesson", which closes the tab). Without
    `?words` it shows the whole library; the search box finds any word in it.
  - **She edits it herself** on the page: 5 quick taps in the top-left corner open edit mode (word, translation, line,
    times with ⏱ Now, notes, lines around, hide / move / delete, add a clip by pasting a YouTube link with a time) and
    "Save" commits to this branch with her own GitHub key. So `git pull --rebase` before touching the library, and
    never overwrite her edits.
  - **In lessons**: when a lesson page teaches words that have clips (or should), add a `{t:'clips', words:[…]}`
    screen (`tools/lesson-page`, after the part that teaches them; `notes:'ua'` for students who need Ukrainian). It
    opens the player with those words in a new tab, as one flow with the lesson. Every word on it must have a library
    file: for a missing one, create it (`en`, `ua`, `pic`, `clips: []`), add the clips if you can pick them (below),
    and otherwise say in the reply which words still need clips (picked on her PC with Claude in Chrome, or she pastes
    links in edit mode). Never put student names or personal details in the library (the repo is public).
  - **A YouTube link with a time from her** (youtu.be/…?t=83): open it in Chrome, read the lines around that second
    (YouTube's "Show transcript"), and add the clip with exact times, the lines around it and a note.
  Pick the clips before the lesson, never live:
  - **Caption Search is the main tool** (captionsearch.app; free; **by hand in Chrome only**, its terms forbid scripts
    or calling its API; she has emailed them asking to allow light automated use, so check for their answer before
    automating anything): quote the phrase ("is mandatory"), `&offset=20` for the next page. Each result has exact
    times and the lines around it. No accent filter: check the channel is American (sitcom clips like The Office work well).
  - **YouGlish** is the backup (`tools/real-video/pick.js`, US filter, search phrases that give the meaning: "a
    rip-off|what a rip-off"; `--meta` gives the rows): only 20 searches a day per browser (paging with next is free);
    its times are whole seconds.
  **Read the context before choosing a clip and before writing its note**: the lines before and after it (Caption
  Search shows two; open the result's transcript for more; on YouGlish play from a few seconds earlier), who is
  talking and about what. Never guess the situation from the one line.
  Choose 4–5 where the word has the lesson's meaning (another meaning is the one thing she doesn't want; swearing,
  politics and so on are fine) and watch each one in the page: a clear picture (the speaker's face or the thing, not
  a back or a far-away hall), no subtitles burned into the video, no "Video unavailable". The 💡 note (hidden until
  tapped) says in one or two very simple sentences what is happening and why the word fits; English or Ukrainian
  depending on the student (ask her). Only these few lines are stored, never transcripts (she chose this over the YouGlish
  window, knowing YouGlish's rules don't allow saving their results). Nothing skips on its own.
- **Lesson pages** (an interactive page she screen-shares; build with `tools/lesson-page/`: write a
  content file like `example-content.js` in the scratchpad; `prep.py <content.js> "<Title>" <work-dir>` records
  the lines and builds `<work-dir>/page.html`; `qa.js <work-dir>` checks every screen at phone and laptop size
  (no scrolling, nothing jumps, every line has sound) and must say "no problems"; look at a few screens yourself;
  publish as a new artifact with `root: <work-dir>` and the mp3s listed in `files.json`; add the link to
  `materials/<slug>`):
  - **Ask her first, for every student**: before building a lesson page, ask what to include with AskUserQuestion
    (multiple choice, several answers allowed): offer the parts you would pick from the student's last lessons
    (forgotten words, corrected phrases, uncorrected mistakes, one sound, saved topics, her real situations), with
    your pick first. Build only what she chose.
  - **One topic per lesson** by default (e.g. "At the dentist"). When she lists the parts she wants, follow her
    order (for example: repeat old phrases → new useful phrases → change the time → grammar). Start with recall of
    earlier phrases: the Ukrainian prompt first, she says the English, then taps Answer.
  - One thing per screen, an "All together" screen at the end of each part, no scrolling.
  - No "change one word" drills that only swap numbers or days: she finds them pointless. Use **change the time**
    instead (`flip`: every day → now / yesterday / tomorrow) with the tenses the student has had.
  - When the student knows a rule but forgets it in speech (he/she + s), don't explain it: use
    `flip` screens (`{t:'flip', from, subj, ans}` with the changed part in [brackets]) so she says it herself.
  - Keep each drill set short (about 4 items). A rule she asks for gets one `rule` screen
    (`{t:'rule', label, rows[[icon, head, ukrainian note, "example · example"]]}`) in Ukrainian, then quick practice.
    Say it directly (✅ where it goes, ❌ where it doesn't); don't build up from theory.
  - Recall (repeating words): short, easy sentences with the key word in brackets, `R('Це обов’язково?', 'Is it [mandatory]?')`.
    The screen shows only the Ukrainian; one button gives three steps: 💡 Hint (the sentence with a blank, "Is it ____?"),
    💡 First letter ("Is it m________?"), Answer. Natural, everyday Ukrainian prompts (no odd words like «здирство»).
  - Every drill sentence must be one people really say often ("Do you have any plans for the weekend?", not
    "The bank didn’t refuse any applications"). Recycle the student's words inside such common sentences.
  - "My sentences" boxes stay empty: no example sentences in them.
    What is typed there must survive a reload or a closed tab: the engine saves on every keystroke, in the browser
    and in the viewer's private rows of the page database. So publish every lesson page with
    `capabilities: {db: {}, user: {}}` (test: type, reload, the text is still there, "✓ Saved" shows).
  - A brand-new word is practiced in one form only. "Change the time" and "every day or now" drills use verbs the
    student already owns (send, call, work); a new word in a tense drill confuses (interrupt → interrupting did).
  - **More drilling than new material**: few new words or phrases on a page (about 8 at most). Each one comes
    back at least three times in different sentences (gaps, answers, change the time, a final "Before you go"
    check), and words from earlier lessons are recycled inside the new sentences. The first part repeats only
    what the student has already had: never open with something new.
  - No notes about where a word is used («Так кажуть в Америці»): useless in a lesson. Some students need
    international English (see their `brief`): for them, avoid words that are US-only.
  - **Nothing to guess**: every exercise shows exactly what to say. Give the Ukrainian sentence itself, not a
    situation the student has to interpret, plus the English sentence with a gap and first letters when the
    student's `brief` asks for it (`C(who, ua, 'My c______ takes an hour.', 'My [commute] takes an hour.')`).
    Don't ask a student to fix a form she doesn't know is wrong: give the `rule` screen first, then the drills.
  - **No one-word hints** (a lone English word under the Ukrainian line confuses). For a longer sentence, show the
    Ukrainian line and the first English words with "…": `{t:'flip', from: ua, subj: 'Thanks! I like …',
    ans: 'Thanks! I like [yours too].', dots: false}`. `hear: 'Nice hat!'` on a flip adds a "You hear" bubble
    (playable) for the line being answered.
  - **The answer appears where it was asked, once**: on Answer the full sentence takes the place of the gap line
    ("We have a lot i_ c_____." becomes "We have a lot in common."); never the gap line and the answer together.
    The engine does this for every `flip` whose `subj` has a gap, ends with "…" or is the start of the answer.
  - **Nothing jumps** when a button is tapped: parts that appear later keep their space from the start
    (check with a before/after position test on every screen).
  - A useful frame ("Can I get …?") gets drilled with many different things: first the start is shown, then the
    frame is the gap ("C__ I g__ a receipt, please?"), then the whole sentence from the Ukrainian line.
  - Not too many topics: about three parts of content between the opening recall and "Before you go".
  - **Review pages** (a student's review day, see their `brief`): only what was already taught that week, nothing
    new. Group the words and phrases by theme with no group labels, in a different order from the one they were taught
    in (students review in the order they got them; a new order adds useful difficulty). Short "All together" screens
    (about 5 lines fit on a phone).
  - When only part of a lesson uses the page (a song or free talk after it), make the page that much shorter.
  - **Weekly review sheet** (after a student's review day, see their `brief`): a `phrases` card (two cards when it is
    long, split between groups, each under about 1,600 px tall so nothing gets cut or shrunk in chat) with
    the week's words in theme groups split by `{break: true}` (no group names), in a new order, each in a slightly
    changed example sentence (same word, a new short everyday sentence) with the key word in [brackets] and its
    Ukrainian meaning as the note, plus 4–6 older words the student forgot, and the week as `period` at the top.
    Only what was taught. **Before making it, ask her with multiple-choice questions (AskUserQuestion, multiSelect)
    which of the week's words go in**: she picks them; a word that only came up in a lesson is often not taught yet.
  - Leave out what the student obviously knows ("Thank you!"): drilling it looks silly.
  - Every wrong sentence or structure shown on a page is crossed out: write it as `~~He said to me~~` (rule rows,
    flip `from`/`subj`, "All together" hints). One structure per part: don't put two (it depends · I guess) on one screen.
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
kid (optional: true = children's look for every card), period (optional: "Nov 9–13", shown on the cards instead of the date)
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
                    `{break: true}` between items leaves a gap: unlabeled groups (weekly review sheet)
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
