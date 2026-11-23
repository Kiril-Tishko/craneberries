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

**Students.** English: American for a student whose `brief` says so; for everyone else international English is a
bit better, but American is fine too (words and spelling). Their notes are **not in this repo, because it is public**: each
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
2. **Ask him first** which words, phrases and sound go on the cards: AskUserQuestion, multiple choice, several
   answers allowed, your picks first (forgotten words, corrected phrases, the sound pair). The site report doesn't
   wait for his answer; the cards do. Then render only what he chose: `node tools/render-cards.js <lesson.json>
   <out-dir>`, and look at them.
3. Upload the PNGs to the artifact: Artifact tool, `asset: true`, `url`, `file_paths`. Put the returned
   ids into `cards[].asset`.
4. Write the database rows with ArtifactData `batch` (read first, then pin `if_version` on existing docs):
   - `billing/<slug>`: add `{date, kind: "lesson", n: -1}` for the lesson date unless an entry of kind
     "lesson" for that date is already there (the teacher may have tapped "− Lesson"), or the student's `brief`
     says not to log their billing. Payments come only from the teacher: add `{date, kind: "paid", n: perPayment}`
     when he tells you.
   - `students/<slug>`: create the student, or update `focus` (bump `seen`, set `status` to recurring,
     improving or fixed).
   - `lessons/<slug>-<YYYY-MM-DD>`: the lesson JSON without `studentCards`, plus `cards`.
   - `teacher/profile`: refresh `englishFocus`, `teachingFocus`, `lessonsReviewed`, `updated`.
   - `progress/<slug>`: the teacher moves units with the buttons. Read it; only if the lesson clearly
     finished the current unit and he hasn't moved it, mention it in the reply (don't move it yourself).
   - `promises/<slug>` (Nov 22, his wish: "keep track of what I promise to students, what I said we will talk about
     in the next lesson especially, so I can follow on it and not forget"): read it and `state/promises-<slug>` (his
     ticks `done{id: true}` and the ones he added himself, `added[]`), then add every new promise **he** made in this
     lesson: to talk about or do next time ("next time we'll…", "we'll definitely do more of these", "remind me to…"),
     to send ("I'll send you the song"), to check or find out. `{id, date, what, kind: next|send|other, t}`: `what`
     one short line in English (what he promised, in his words where they help), `t` = the time in the transcript.
     Leave out what the student promised, what was done in the same lesson, and anything already in the list; never
     mark one done and never write `state` (he ticks them on the page). Say the new ones in the reply, one line.
5. Send the cards to the user with SendUserFile and give them the site link.

**Text the teacher might forward to a student** (answers to a student's question, a message, a reading text)
goes in its own fenced block that contains only what the student should read: no name or label inside it
(put "Text for <name>" as a line above the block), no comments to the teacher, no "your student", no feedback.
Everything outside the block is for the teacher.
He once forwarded a whole reply to a student by mistake.

## When the user sends audio

Recordings never leave the container (work in the scratchpad; `pip install faster-whisper soundfile`, model from
huggingface.co, about 15 min per hour of audio).
- **PC + phone recordings of the same lesson**: `python3 tools/audio/lesson-audio.py <work-dir> --pc <file> --phone <file>`
  (add `--pc-is-student` when the PC recorded only the student). It lines the two up and labels every word: the teacher
  is loud on the phone, the student is almost silent there. Work from `transcript.txt` (one turn per line, S = student,
  T = teacher, PC times; ⁽NN⁾ = recognizer unsure) and tell him in one line how good it was (`quality.txt`).
- **One recording only**: `python3 tools/audio/transcribe.py <file> <scratchpad prefix>`. A phone recording catches
  mostly the teacher; a PC recording is one mixed track. No speaker labels: infer who spoke from context and say so
  in the summary. Don't guess what can't be told.
- **Whisper turns Ukrainian speech into English** (it runs with `language=en`): an English line where they spoke
  Ukrainian is the recognizer's translation, never someone's English, so never quote it as a mistake. A **Meetily
  transcript** (Parakeet) keeps the Ukrainian and catches more small slips ("she go"): when he sends one, use it for
  what was said and in which language, and Whisper's file for times.
- Then the same steps as for a transcript, with `source: "audio"`.
- Pronunciation notes for the student and the teacher: a word the recognizer got wrong or was unsure of is a hint,
  not proof. Mark it `confidence: check`.
- Chat uploads are limited to 30 MB. Speech needs no more than mono 32 kbps (an hour ≈ 15 MB).

## What the teacher asked for

- **Replies in chat are short**: say briefly what you did and give the links; don't list the lesson content.
- **Questions to him are multiple choice** (AskUserQuestion, recommended option first), never open questions in chat.
  When a request is unclear ("a review sheet": page, picture or text?), ask that way before building.
  When the options are words or phrases to teach, put a short example sentence under each one (the option's
  description: "solve" → "Can you help me solve this problem?"). At most 4 options a question: ask part by part.

- **American or international English**: per student, see **Students** above. IPA is American (/wɝk/, not
  /wɜːk/) and goes on the teacher site only: **no phonetic transcription on student cards**.
- **Student cards**: readable on a phone, no student name, no page count, no "lesson notes" caption
  (only a small, quiet date beside the kicker), no homework or mini-task. No big title that only repeats the kicker
  ("Don't forget" twice): leave `title` empty (he crossed it out, Nov 17).
- **Which cards** (a general guide, not a hard rule): after he chooses (step 2), make a "Don't forget" words card,
  "Say it like this", 3 pronunciation cards (he sends one) and anything else the lesson calls for (e.g. a picture
  cheat sheet for the main topic). He decides what to send; often just one card. Keep subtitles short or leave
  them out. Cards for him too: what to do next lesson, which words to teach, what the student got wrong.
- **Pictures first, for every student**: a card should be understood at a glance: big pictures, almost nothing
  to read (picture tiles with `grid: true`; picture rows when the words are long).
- **Review cards and review sheets: ask first**, every time, with multiple-choice questions (several answers
  allowed) about what goes on them. Never pick the content on your own.
- **Cards are a quick recap of what was said, never something the student sees for the first time.**
  - Words card ("Don't forget"): only words the student **forgot** in the lesson (asked again, couldn't recall).
  - "Say it like this": the phrases that were corrected in the lesson.
  - Brand-new words and mistakes nobody corrected go to the next lesson: a "Next lesson · Words to review" card
    for the teacher, and a short list of phrases to talk about in the chat reply (teacher only).
  - Pronunciation: give 3 card options so he can pick one.
  (Rule from Nov 11 on; earlier cards stay as they are.)
  For irregular verbs, show all three forms (catch – caught – caught) and put them at the end.
- **"Say it like this"**: 3–4 phrases only; plain, everyday sentences from the lesson. Skip idioms, slang and jokes
  (he removed "I was swamped", "pipe dream", "Good for him!", "I could go for some cake"). Nothing that reminds the
  student of her mistakes ("There are a lot of mistakes in my email"): keep card and page sentences positive.
- **Pronunciation card**: one pair only, with practice sentences. No extra "same sound" lists or side notes.
  Big emoji beside each word; highlight the stressed (or key) part in yellow, like `[DE]sert`.
  For A2 and below, write the mouth tips in the student's language ("Опустіть щелепу", not "Drop your jaw").
  Never repeat a pair the student already had (check their earlier lessons' cards and their `brief` first).
  Fast-speech forms from the lesson (let me → "lemme") are a good alternative.
- The **full mistakes report** is for the teacher only, on the site, with timestamps and priorities.
- A **report on the teacher**: their own English (quote, better version, why) and their teaching
  (what worked, what to try next time). **Be as blunt as possible**: only the teacher reads it. Keep
  tracking the teacher's pronunciation (e.g. pan sounding like pen).
- **Reading texts**: only when he asks. Give plain text in chat, not pictures, no questions at the end.
  Stories must not describe the student's own life or retell what she told the teacher (her appointment,
  her order, a compliment she got): change the people, places and events. Use the student's target words and mostly the
  structure from their last lesson. ~80–120 words for A2 (he asked for shorter texts); shorter, or none, when the student's `brief` says so.
  Make them sound like real people talking (contractions, short replies, "Kind of", "No way"), add an occasional
  emoji, and don't end with someone laughing. Use only words the student already knows or met in lessons; a word
  she asked about but never got taught (e.g. "interrupt") stays out until it has been taught.
- **Song and video lessons** (e.g. "Human", "The Bridge") need the video on the page, which Claude pages can't
  embed: they live in `docs/<lesson>/` (the lesson is `lesson.json`; `index.html` only loads the player) and share one player, `docs/video/player.js`
  + `player.css`, served by GitHub Pages (https://kiril-tishko.github.io/craneberries/). The player follows the real
  video clips rules below (one quiet panel, no YouTube UI, steady layout, Space / ← → / double-tap, presses count
  while loading, 1× / 0.75× / 0.5×, ⓘ for the YouTube links). Calm for A2, one small part at a time: each screen is
  one short line, its 1–2 key words with Ukrainian first, then ▶ plays just that line (the lyrics show under it, key
  words in yellow). A line with nothing to learn now gets no screen. After each part, "All together" (the lyrics
  follow the line being sung); at the end, My words (+ on a word → gap sentences with first letters).
  Choose the words to learn from the student's level and `brief`, then ask him which to teach (multiple choice,
  several answers allowed, a short example under each word); leave out words the student already knows (moment).
  More examples on a word card only when he asks (`[en, ua, ex, ex, …]`). Only the sung parts: intros, whistling,
  solos and exact repeats are left out (`skipped` in lesson.json says which).
  **He edits song pages himself** (`docs/video/edit.js`): 5 quick taps in the top-left corner; he taps a word or drags
  across a phrase in the lyrics for its Ukrainian and ⭐ Learn / Later / plain (Learn adds it to that line's screen, or
  makes a new screen), types right on the card (word, Ukrainian, examples with Ctrl+B for the gap word, note, meaning),
  ✕ a word, 🗑 a screen, sets Start / End of a line or part under the video, 🔇, Ctrl+Z / Ctrl+Y, and Save commits
  lesson.json to this branch with his GitHub key. So `git pull --rebase` before touching a lesson.json, and never
  overwrite his edits. A lesson.json keeps one line per screen (that is how the page saves it). Browsers keep
  player.js for up to 10 minutes: when a change needs the new player and the new pages together, bump `?v=` on
  player.js / player.css in every `docs/<lesson>/index.html`.
  ✕ (leaving edit mode) with unsaved changes asks: save, throw them away, or keep editing (the clips page too).
  **↻ Make again** (edit mode only, song pages and the clips page; `docs/video/remake.js`): beside each translation,
  example, note and meaning (clips page: the word's Ukrainian and each clip's note). It shows the text there now plus
  ready-made versions, and a tap keeps one. No API key and no API call (he has a Claude plan, which web pages can't
  use): the versions are written in a chat and stored as `"versions"`, groups of texts that can replace each other
  (`[text, version, version, version]`, one group per line), in lesson.json or in the clip word's file; ↻ finds the
  group that contains the text there now. **Write versions only when he asks** ("↻ versions for …"; he chose this to
  save tokens): then add a group with 3 more versions for each text he named, same rules as the original (natural
  Ukrainian, never Russian; everyday A2 American-English examples of at most 12 words with the word in `<em>` in the
  same form; notes and meanings with the same facts, reworded). The savers keep `"versions"`; `git pull --rebase`
  first, never overwrite his edits.
  **Grammar words** (a, the, is, are, do, did, to, of…): a tap says in short Ukrainian *why the word is there in that
  line*, never "we don't translate it here". A word whose reason differs by line has a gloss object:
  `"the": {"*": "usual note", "the Moskva": "note for this line", …}`: a key is words around it in a line, and the one
  that contains the tapped word wins.
  Every word under the video is tappable: **a tap underlines and translates just that word** (or says why a grammar
  word is there), also inside a yellow phrase, so every word needs a gloss (or a line note). Only phrases in
  `together` (`{"phrase as in the captions": "its Ukrainian, or empty for the learn / later one"}`) stay whole: phrasal
  verbs (listen to, pass by, pick up) and set phrases whose words alone mislead (after all, take a look, out of luck);
  splitting "I'm only human" or "make mistakes" is fine. In edit mode a dragged phrase has a Keep together switch.
  The tap bubble is solid (not click-through) and its text can be selected; tapping the same word again closes it.
  A video from his device in portrait (Threads, Reels) still uses the wide layout (`"tall": false`) when he wants the
  subtitles wide and easy to read (The Bridge).
  Phrases left for later (`later`) also say
  "вивчимо пізніше". Lyrics load live from lrclib.net when the page opens; never store lyrics in the repo. lrclib's
  lyrics are sometimes from another version of the song: check them against the video before building (YouTube's
  "Show transcript", the video's length); when the video is cut differently, `captions.keep` moves the lines to the
  video's times (numbers only). A 💡 Note
  (hidden until tapped) only where something is easy to miss; no "what the line means" box. Where a line isn't clear,
  its `meaning` says in one simple sentence what the author meant (not a translation, not deep); it shows under the
  note, set apart in italics. **Every tap gives the
  word's meaning in that line**: check each word against its lines, above all words with two meanings (to, in, down,
  take); a key or `later` phrase gives a word its line's meaning. Keep a translation that fits; don't polish it. A video from his
  device (`video: {type: 'file'}`) stays in his browser and its captions come in the link. `?mute` plays silently
  (for testing).
- **Real video clips** (docs/real-video/, GitHub Pages): a native speaker says the word in a real video. Our own
  YouTube player in one panel (no YouTube buttons, title or timeline; play/pause, a timeline to tap or drag, our caption
  bar; a "With context" switch (1–2 lines before and after, the caption bar follows them; the yellow part of the
  timeline shows only then; a tap = this clip only, the next clip plays without it; press and hold = it stays on for
  the next clips, a small dot on the button, until tapped off); 1× / 0.75× / 0.5×; a big "Next clip" with a small ‹ back arrow; no "Again" button: at the
  end the play button turns into ↻). A hidden second player preloads the next clip so Next starts at once; replays
  jump back instead of reloading. The caption bar keeps the height of the word's longest line, so nothing below it
  moves. No text explaining the controls and no "Speed" label: he wants it quiet; the
  YouTube Terms / Google Privacy links stay behind a faint ⓘ at the bottom. Space = play/pause wherever the focus is,
  ← → and double-tap = 1 s; pause goes on from where it stopped (a press just as the clip ends never restarts it);
  the picture is dark only before the clip starts, a paused clip is only dimmed. The clip stops when its line ends,
  before the next line.
  **The clip library** (one place for every lesson and student; a word is picked once and reused):
  - One file per word: `docs/real-video/words/<slug>.json` (slug: lowercase, letters and digits joined by "-";
    "Is that a thing?" → `is-that-a-thing`) = `{en, ua, pic, hl?, versions?, together?, gloss?, clips: [{v, s, e, line,
    note, noteUa?, around?, hidden?}]}`: v = YouTube id, s/e = where the line starts/ends (seconds; exact decimals when
    known), note = the 💡 note in English, noteUa in Ukrainian, around = `[[start, end, line], …]` 1–2 lines before and
    after (for "With context"), hidden = kept but not shown, hl = a regex for other forms of the word ("rip[- ]?off").
    **Every word under a clip is tappable** like on the song pages: one word at a time (its Ukrainian; a grammar word
    says why it's there), the yellow word whole (its `ua`), `together` phrases whole. `gloss` covers every word of every
    clip's line and lines around (same shape as the song pages' gloss, context keys for grammar words), so **when you
    add a clip or its lines around, add glosses for its new words** (and `together` for phrasal verbs / set phrases).
    `words/index.json` lists them for the search: after changing word files run `python3 tools/real-video/build_index.py`
    (on his PC, which has no Python: `perl tools/real-video/helpers/index-update.pl <slug>…`). Other helpers there
    (Perl, kept in the repo because the scratchpad gets wiped): `cands.pl` (index candidates a word doesn't use yet),
    `entries.pl` (ready entries with their lines around), `frames.pl` (a numbered sheet of YouTube's timeline pictures
    to check each clip's picture without playing it, no sound), `add-clips.pl` (adds clips and glosses in the files' own
    layout; `--show` lists reused glosses to check), `gloss-context.pl` (a gloss for one line), `glosscheck.pl`.
    `words/groups.json` = the topics of the whole-library page (`[{name, pic, words: [slugs]}]`; Nov 20, he wanted the
    phrases grouped): put every new word in one topic (a word in none shows under "More"). On a phone the topics and
    the words each scroll sideways in one row, so the video stays near the top; a lesson's `?words` list isn't grouped.
  - The player reads them: `https://kiril-tishko.github.io/craneberries/real-video/?words=rip-off,excuse` (a lesson's
    words; `&title=…`, `&notes=ua` for Ukrainian notes, `&from=lesson` adds "← Lesson", which closes the tab). Without
    `?words` it shows the whole library; the search box finds any word in it.
  - **He edits it himself** on the page: 5 quick taps in the top-left corner open edit mode, where everything is
    edited where it is: he clicks the caption (with context: the line shown), the word, its Ukrainian, its emoji or
    the 💡 note and types; a small bar under the video has Start / End (minutes:seconds; − / + 0.1 s, then that bit plays again; ⏱ =
    where the video is now), 🙈 Hide, 🔇 (no sound while editing; students always have sound), Save (counts the words
    that really changed) and ⋯ (move, delete, add a clip by pasting a YouTube link with a time, lines around with their
    times, the note in the other language, other forms to highlight; while a site has no GitHub key its box comes first in the bar, and the student site, which
    keeps its own, gets it from the clip library with one tap: "Use my key from the clip library", key.html), ↻ beside the Ukrainian and the
    note (Make again, above). Entering edit mode stays on the clip that was open. Ctrl+Z / Ctrl+Y undo and redo
    every change. "Save" commits to this branch with his own GitHub key (`?mute` plays without sound, for testing).
    Never test edit mode in a tab he might use: a test tab with unsaved changes can end up saved with his key. So `git pull --rebase` before touching the library, and
    never overwrite his edits.
  - **In lessons**: when a lesson page teaches words that have clips (or should), add a `{t:'clips', words:[…]}`
    screen (`tools/lesson-page`, after the part that teaches them; `notes:'ua'` for students who need Ukrainian;
    `listen: true` = listen first: each clip starts with its caption blurred, which shows only on a tap (not when the
    clip ends: his rule, Nov 21);
    CC beside the timeline blurs the subtitles (a "censored" look) everywhere, every clip, screen and lesson, after a
    reload too, until it is tapped again (his rule, Nov 19; kept in the browser);
    inside a lesson the clip page takes the lesson's look: its colors, rounded buttons, progress dots, no box inside
    the card, and **no heading** (he crossed out the label, the phrase and its Ukrainian, Nov 19: the video takes that
    room, as big as the screen allows, and everything, "With context" included, stays in view with no scrolling;
    the clips change with big ‹ › arrows beside the video, on its edges on a phone, and none back on the first or
    forward on the last; no "Next clip" button there, his choice, so it isn't confused with the lesson's Next;
    a low, wide screen (a phone on its side) puts the speed under the timeline and the caption, "With context" and
    the dots beside the video; **💡 What's happening?** beside "With context" (Nov 20, his wish) opens the clip's 💡 note over
    the video (across the screen's bottom on a low screen; a tap closes it, so does the next clip; just 💡 on a phone); **smart loading**: the
    engine loads the next clips screen ahead in the background (its first clip waits on its first frame) and keeps
    the last three, so a clips screen opens at once (`Clips` in `engine.html`; pages built before Nov 19 lack it);
    `body.embed` in `docs/real-video/index.html`). It
    opens the player with those words in a new tab, as one flow with the lesson. Every word on it must have a library
    file: for a missing one, create it (`en`, `ua`, `pic`, `clips: []`), add the clips if you can pick them (below),
    and otherwise say in the reply which words still need clips (picked on his PC with Claude in Chrome, or he pastes
    links in edit mode). Never put student names or personal details in the library (the repo is public).
  - **A YouTube link with a time from him** (youtu.be/…?t=83): open it in Chrome, read the lines around that second
    (YouTube's "Show transcript"), and add the clip with exact times, the lines around it and a note.
  **How he wants clips in a lesson** (Nov 16): the word or phrase on its own screen as usual, then right after it one
  clips screen with `listen: true` (no subtitles until tapped), 💡 notes in Ukrainian for A2 students unless their `brief`
  says English (then the notes are simple A2 English: short sentences, everyday words), about
  3 clips a word. Before a lesson, suggest the words that suit clips (common in real speech, easy to hear: "Can I call
  you back?"), he picks them, then pick the clips.
  Pick the clips before the lesson, never live:
  - **He uses it as a page on his PC: http://localhost:8770** (Nov 21; `site.pl` + `site.html`, started hidden at
    logon by the "Caption index page" task, only this PC can open it, nothing is published): a search box with the
    same syntax, a show filter, "Copy clip entry", and how far the collector has got; `search.pl --json` feeds it.
    Its results stay a plain list (he likes that), but **each clip plays in the clip library's own player** (his wish,
    Nov 21: it stops at the line's end, ↻ plays the line again, With context, the caption bar, the yellow part of the
    timeline): `site.pl` serves the live `docs/real-video/index.html` + `app.js` from GitHub Pages (kept 6 hours; an
    installed copy without internet) at `/player/?words=c-<line>-<last line>-c-…-q-<words>&embed`, making that
    "word" from the index on the fly; no edit.js there, so nothing can be saved from it. **Layout (his wish, Nov 21,
    like Caption Search):** one video that never moves (left; on a phone, top) and the results in a list on the side
    that scrolls on its own: each a small picture of its video, channel and title, the captions **under** them, and a
    small ⧉ copy; a tap plays it, a tap on a caption line plays from that line; tabs Results / ♥ Liked. In the
    player's row with "With context": ◀ ♡ Like ▶ (no speed buttons, no arrows beside the video, no big buttons
    under it: they took too much room). Under the video, small: what plays and the clip's Start / End (− / + 0.1 s,
    ⏱ now, ↺ original; the `times` table; the clip entry uses them). **Every player for him gets a Like that is
    remembered** (his rule, Nov 21: "always"); here likes are `marks` of kind keep, liked clips come first in
    searches. A small 🙈 on a result hides it and the same scene in other videos from every search (kind hide; Undo in place). Short scene clips rank before compilations.
    **His phone** on the home Wi-Fi opens it too: `http://<PC's address>:8770` and a PIN (both shown on the page),
    then a 30-day cookie; only the home network's addresses, 5 wrong PINs = 15 minutes' wait. With **Tailscale** (free,
    on his PC and phone) the same page opens from anywhere at the PC's Tailscale address (100.x.y.z or its .ts.net
    name), PIN too. The whole index never goes online (his choice, Nov 21: public transcripts, 1-2 GB, GitHub limits).
    **✎ Captions** (third tab; his wish, Nov 21): he fixes the clip that plays: types a line (✎), taps a word and moves
    it with the words before it to the line above or with the words after it to the line below, starts a new line at
    a word (✂), joins lines (⤒ ⤓), picks the clip's own line (★), ↶ ↷ / Ctrl+Z, ↺ Original. A moved word keeps its
    time (auto-captions' word times, else spread by letters), so line starts / ends follow; the player shows each
    change at once. The editor is `docs/real-video/picks/caps.js` (shared with the picks page; `--install` copies it);
    edits are the `caps` table (per clip, never the index's own lines), and every page, search and the sync use them
    (`clip_views` in CaptionIndex.pm).
  - **His picks online** (Nov 21): every clip he ♥ liked, re-timed or whose captions he fixed is in
    `docs/real-video/picks/picks.json` (one clip per line: `id` = its line in his index, `q` = the phrase he searched,
    `liked`, `timed`, `edited`, `v`, `s`, `e` (his times), `s0` / `e0` (the clip line's own), `line`, `around` (his
    fixed lines when `edited`; `orig` = the index's), `channel`, `show`, `title`, `kind`, `at`). The hidden
    "Caption index sync" task (`sync.pl`) keeps it the same as his PC **both ways**, the newer change winning per clip.
    **https://kiril-tishko.github.io/craneberries/real-video/picks/** plays them in our own player (it stops at the
    line's end, With context, ◀ ♡ Like ▶) and saves ♥, Start / End and ✎ Captions (same editor) to picks.json with
    his GitHub key (the clip editor's, same site); a song's lines stay on his PC, so they are fixed there only.
    **To put his picks into a lesson**: read picks.json (the phrase he searched tells which word it is for), take `v`,
    `s`, `e`, `line`, `around` as they are (his fixes included) into that word's file in `words/`, then the note and
    glosses as usual; never edit picks.json by hand (his PC syncs it).
  - **On his PC, search the private caption index first** (Nov 19): `perl tools/real-video/index/search.pl "what do
    you mean" [how many, default 10]` prints results like the Caption Search tool (channel, title, youtu.be link with
    the time, exact start and end, the line with two before and after; plus `words` times where YouTube gave them,
    human or auto captions, and an online check that drops gone videos), with no daily limit. `--page 2`, `--human`
    (uploaded captions only, exact text), `--channel office,friends`, `--not snl`, `"a | b"` (either), `"call ~3
    back"` (near), `"tire*"`; `--channels` lists them; `--clip` adds each result's ready clip entry for `words/`
    (`v`, `s`, `e`, `line`, `around`; write the note after watching). A scene found in several videos (a compilation
    and its own clip) shows once, with "same scene also in …". **A student's favorite show**: `--show breaking-bad`
    gives clips from that show only (`--shows` lists them and how much of each is in). To add a show, add its official
    channel to `channels.json` with `show`, `"first": true` (listed and fetched before everything else), `per`,
    `titles` and `skip` (interviews, panels, music: not scenes); official channels only, never full-episode reuploads
    (they get taken down). Breaking Bad (Nov 21): the official "Breaking Bad & Beyond" channel, 750 scenes and
    compilations, 67 h (the series is ~49 h): its famous scenes many times over, not every line of the show; uploaded
    captions on most scenes. **Games** (GTA 5, Nov 21): an entry with `videos` (chosen ids, any length) instead of a
    channel, e.g. a fan's "all cutscenes" movie; most of them show the game's subtitles in the picture, which makes a
    clip useless, so check frames first (the video's storyboard images in its yt-dlp details) and take one without.
    GTA 5 = "The Movie (Cutscenes Only)", 3 h, good auto captions; GTA 6 (out Nov 19) had no upload without
    subtitles yet on Nov 21: look again later. **Songs** (Nov 21, he loved a Taylor Swift line in a talk show; pop
    first, any style later): `"song": true` channels (show "Songs · <artist>", 14 pop artists' own channels),
    official music videos only (lyric videos have the words in the picture, audio uploads a still image; `skip` also
    drops chats, premieres and making-of videos, and applies to the queue when the collector starts; `collect.pl --drop
    <id>` takes a wrong video out of the index). Uploaded
    lyrics captions are used as they are; otherwise the words come from lrclib.net's synced lyrics, lined up with the
    auto-captions' word times (one pass over the whole song, so a chorus can't pull a line a minute off; kind
    `lyrics`); with no captions at all only when the video is as long as the record. Taylor Swift's music videos had
    no captions and longer cuts (Nov 21): left out. Lyrics stay in the private index: **never in the repo**, so song
    picks go online with their times only (`song: true`, line "♪"), and a song clip can't go into `words/` with its line. It holds only the American channels he picked
    (`tools/real-video/index/channels.json`: sitcoms, late-night shows, YouTubers) and grows by itself: a hidden
    scheduled task runs `collect.pl` logged out (no cookies), each channel's longest videos first, one caption
    request a video, a 4-hour rest after every 120 (YouTube said 429 after about 160 twice on Nov 19), about 400-500
    videos a day; if YouTube still pushes back it stops for hours, then goes slower. `perl tools/real-video/index/collect.pl --status` says how far it has got (`--stop`,
    `--start`); after changing anything in `tools/real-video/index/`, run `collect.pl --install` so the task runs
    the new copy. Downloading captions breaks YouTube's terms (he chose it for private use), so the index
    (`~/.cache/caption-index/`) never goes in the repo, a page or a commit: only the clip lines saved in `words/`.
    **Then Caption Search** when the index has too few good matches (a rare phrase, a channel it doesn't have) and in
    a cloud chat, which can't reach the index; **YouGlish** last.
  - **Caption Search** (captionsearch.app). Its search API is open to him with a free trial key
    (Nov 17; 5 searches a minute, 30 a day, at most 5 results a search and no next page; saving the results for
    students is fine): `perl tools/real-video/captionsearch.pl "what do you mean" [1-5]` gives each match's channel and
    video title, a YouTube link with the time, the exact start and end, and the line with up to two lines before and
    after it, with times (Dunqing, who runs Caption Search, added this for him on Nov 18; on Nov 20 he made one video
    crowd the first results less and said to keep using the key), and keeps every answer (the
    same phrase again costs nothing; `--fresh` asks again; punctuation is left out because the API
    answers 400 to a comma, Nov 18; more than 5 a minute gets 503 "temporarily unavailable"). The first 5 are often no good (for "what do you mean": an
    audiobook, MrBeast), so search a few other phrasings that give the meaning ("what do you mean by that", "wait,
    what do you mean") rather than one phrase again.
    **The key** is in `CAPTIONSEARCH_API_KEY` or the file `~/.captionsearch-key.txt` on his PC (in a cloud chat: a
    Network secret for api.captionsearch.app in the cloud environment's settings, which the chat never sees): never in
    this repo (public), a page, a commit or a chat, never printed, never in anything a student loads. If it may have
    leaked, he asks Caption Search to revoke it.
    **From his phone**: a cloud chat does all of it (the key is a Network secret there) except watching the clips:
    say in the reply that they are unwatched, and he checks them on his phone (🙈 Hide for a bad one). Remote Control on
    his PC's session also works (the PC stays on) and can watch them.
    Without the key (or past the day's 30):
    search by hand on the site in Chrome (no scripts there): quote the phrase ("is mandatory"), `&offset=20` for the next
    page; each result has exact times and the lines around it. No accent filter either way: check the channel is
    American (sitcom clips like The Office work well).
  - **YouGlish** is the backup (`tools/real-video/pick.js`, US filter, search phrases that give the meaning: "a
    rip-off|what a rip-off"; `--meta` gives the rows): only 20 searches a day per browser (paging with next is free);
    its times are whole seconds.
  **Read the context before choosing a clip and before writing its note**: the lines before and after it (Caption
  Search's site and the tool show two; on YouGlish play from a few seconds earlier), who is
  talking and about what. Never guess the situation from the one line.
  Choose 4–5 where the word has the lesson's meaning (another meaning is the one thing he doesn't want; swearing,
  politics and so on are fine) and watch each one in the page: a clear picture (the speaker's face or the thing, not
  a back or a far-away hall), no subtitles burned into the video, no "Video unavailable". The 💡 note (hidden until
  tapped) says in one or two very simple sentences what is happening and why the word fits; English or Ukrainian
  depending on the student (ask him). Only these few lines are stored, never transcripts (he chose this over the YouGlish
  window, knowing YouGlish's rules don't allow saving their results). Nothing skips on its own.
- **Lesson pages** (an interactive page he screen-shares; build with `tools/lesson-page/`: write a
  content file like `example-content.js` in the scratchpad; `prep.py <content.js> "<Title>" <work-dir>` records
  the lines and builds `<work-dir>/page.html`; `qa.js <work-dir>` checks every screen at phone and laptop size
  (no scrolling, nothing jumps, every line has sound) and must say "no problems"; look at a few screens yourself;
  put it on the student site (next bullet); add its address to `materials/<slug>`):
  - **Lesson pages go on the student site** (https://lessons.ukrainglish.com, private repo kiril-tishko/lessons), from
    any chat, start to finish: attach the repo (`add_repo`, push access), clone it next to this one and follow its
    `CLAUDE.md` (`perl tools/add-lesson.pl <work-dir> <siteCode> <YYYY-MM-DD>-<short-name>`; the code is `siteCode` in
    the Notebook's `students/<slug>`). Push straight to its `main`: that is his standing OK, and the push publishes the
    site. Then check the live page: the new title shows and one mp3 loads as audio (a missing page also returns 200).
    Voice: `pip install kokoro-onnx soundfile` and the two model files from the kokoro-onnx GitHub release
    `model-files-v1.0` (a few seconds). **Only when he asks for a Claude page** (he may, the first days): publish it
    as a new artifact instead, with `root: <work-dir>`, the mp3s listed in `files.json` and `capabilities` below.
  - **Ask him first, for every student**: before building a lesson page, ask what to include with AskUserQuestion
    (multiple choice, several answers allowed): offer the parts you would pick from the student's last lessons
    (forgotten words, corrected phrases, uncorrected mistakes, one sound, saved topics, her real situations), with
    your pick first. Build only what he chose. **Her missed words open the lesson** (Nov 22, his choice): the words
    she missed most in Practice in her 📖 dictionary on the student site (`python3 tools/missed-words.py <siteCode>` in
    the lessons repo) go into the opening recall; offer them first in that question. **His open promises come first** (`promises/<slug>` without a tick in
    `state/promises-<slug>`, "next lesson" ones above all): offer each one as an option, and put them in `nextLesson`.
    **Then ask again once it is built** (Nov 23, his wish: "I want to answer it every time"): before you hand over the
    link, ask him about what you added (anything to cut or change) and what else to add, to the lesson and to its 🏠 homework
    (AskUserQuestion, multiple choice, several answers allowed, an example under each option), then make his changes.
    **"Make it fast"** = no questions, before or after: build with your own picks and give him the link.
  - **One topic per lesson** by default (e.g. "At the dentist"). When he lists the parts he wants, follow his
    order (for example: repeat old phrases → new useful phrases → change the time → grammar). Start with recall of
    earlier phrases: the Ukrainian prompt first, she says the English, then taps Answer.
  - One thing per screen, an "All together" screen at the end of each part, no scrolling.
  - **Extra drills in reserve** (Nov 21, his wish): a part with `extra: true` (`{label:'More drills', extra:true,
    slides:[…]}`) has no tab and Next goes past it; a dashed "➕ More drills" tab sits where it is: a tap opens it, the ✕ on
    its tab puts it away again, as often as he likes (with 📡 Lead his ➕ / ✕ change the student's page too). When he asks for "more exercises if
    we need them", add one (e.g. another big tense drills part with its own "All together" screens) before "Before you
    go"; qa.js checks it too.
  - **Homework on the same page** (Nov 23, his wish: clips can't be played in their lessons, so the student does them
    afterwards; "not a separate page, but shown a bit separate"): parts with `home: true` go last, after My sentences.
    The tab bar puts a "🏠 At home" divider before them and shows their tabs in a warm color, their screens say
    "🏠 At home" beside the dots, and Next at the end of the lesson says "🏠 <part> →". Clips screens and extra tense
    drills go there; qa.js checks them like any other part.
  - No "change one word" drills that only swap numbers or days: he finds them pointless. Use **change the time**
    instead (`flip`: every day → now / yesterday / tomorrow) with the tenses the student has had.
  - When the student knows a rule but forgets it in speech (he/she + s), don't explain it: use
    `flip` screens (`{t:'flip', from, subj, ans}` with the changed part in [brackets]) so she says it herself.
  - Keep each drill set short (about 4 items). A rule he asks for gets one `rule` screen
    (`{t:'rule', label, rows[[icon, head, ukrainian note, "example · example"]]}`) in Ukrainian, then quick practice.
    Say it directly (✅ where it goes, ❌ where it doesn't); don't build up from theory.
  - Recall (repeating words): short, easy sentences with the key word in brackets, `R('Це обов’язково?', 'Is it [mandatory]?')`.
    The screen shows only the Ukrainian; one button gives three steps: 💡 Hint (the sentence with a blank, "Is it ____?"),
    💡 First letter ("Is it m________?"), Answer. Natural, everyday Ukrainian prompts (no odd words like «здирство»).
    `hint: 1` on a recall shows the gap line from the start, as if Hint were already pressed (the button then gives the
    first letter). Only when he asks: on Nov 21 he wanted the older words' gap lines hidden again until Hint.
    The blanks have one place per letter: "a" or "I" gets one blank, never two (Nov 23).
    The brackets cover the whole phrase being practiced, so the Hint line never gives away its main word ("The bank
    [won the lawsuit].", not "The bank [won] the lawsuit."; "He was [excited to meet] him.").
  - Every drill sentence must be one people really say often ("Do you have any plans for the weekend?", not
    "The bank didn’t refuse any applications"). Recycle the student's words inside such common sentences.
  - "My sentences" boxes stay empty: no example sentences in them.
    What is typed there must survive a reload or a closed tab: the engine saves on every keystroke, in the browser
    and in the student's account (the student site does this by itself; a Claude page needs
    `capabilities: {db: {}, user: {}}`). Test: type, reload, the text is still there, "✓ Saved" shows.
  - A brand-new word is practiced in one form only. "Change the time" and "every day or now" drills use verbs the
    student already owns (send, call, work); a new word in a tense drill confuses (interrupt → interrupting did).
  - **More drilling than new material**: few new words or phrases on a page (about 8 at most). Each one comes
    back at least three times in different sentences (gaps, answers, change the time, a final "Before you go"
    check), and words from earlier lessons are recycled inside the new sentences. The first part repeats only
    what the student has already had: never open with something new. A word or phrase that came up only once in talk (not taught
    on a page) counts as new: show it first (a `P` screen), then test it (Nov 23).
  - **Ukrainian prompts and gender** (Nov 23): only the student's own "I" sentences follow the student's gender;
    sentences to someone else ("А чого ти очікував?") or about other people mix he and she, never always feminine.
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
    Only what was taught. **Before making it, ask him with multiple-choice questions (AskUserQuestion, multiSelect)
    which of the week's words go in**: he picks them; a word that only came up in a lesson is often not taught yet.
  - Leave out what the student obviously knows ("Thank you!"): drilling it looks silly.
  - **A page used in a lesson stays exactly as it is**: never edit it or take anything out of it afterwards (students
    notice, and a missing word feels like "you don't think I can"). Changes go into the next page.
  - **Never drop a word on your own** (too rare, too hard to say): ask him. Work words a student brings herself
    (mothballed, subsidiary) are worth keeping: one or two a lesson, as a chunk, a few minutes, then recall.
  - Every wrong sentence or structure shown on a page is crossed out: write it as `~~He said to me~~` (rule rows,
    flip `from`/`subj`, "All together" hints). One structure per part: don't put two (it depends · I guess) on one screen.
  - Kids' pages: tiny stories as one sentence per screen with a big picture (`P('story', en, ua, '', pic)`), then the
    whole story (`{t:'email', icon:'📖', label, lines}`) and yes / no questions about it; `P('draw', …)` gives a
    "🎨 Draw it!" screen. No wrong forms on kids' pages.
    Moving pictures: `anim` on a screen with `pic` (hop, swim, fly, run, climb, dance, crawl, ring for an alarm clock, sleep). Games: `{t:'game', words:
    [[word, emoji]…], rounds}` (listen, tap the word) and `{t:'quiz', q, pic, anim, opts:[[text, emoji]…], ans}` (tap
    the answer: stars when right, a shake when wrong). Check them with `node tools/lesson-page/qa-play.js <work-dir>`.
  - Pictures: when presenting new words or phrases that are easy to picture, give the screen a big emoji
    (`pic`, the last argument of `P`/`R`, or `pic` on a `flip`). When an emoji doesn't show the thing (🛒 is not a
    checkout), draw an SVG (`pic` and card `svg` take one; keep it on one line in content.js). Reusable drawings: `tools/pics/`.
  - **Never put personal data on a page**: no student names (sign emails with a made-up name), no real
    details of their work or life (company deals, customers, places, dates of birth). Use made-up, general examples.
  - **No role-play** for now: he didn't like how it worked. Leave it out unless he asks for it.
  - Explain a word only in the meaning the topic needs (treat = лікувати at the dentist; no list of meanings).
  - **Never draw faces, mouths or body diagrams**: he found the drawn mouth creepy.
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
                    `grid: true` gives the tile grid in the adult look (no reading needed; `cols: 3` for 6+ items keeps it phone-sized); an item's `svg` replaces
                    the emoji when no emoji fits (🍴 shows a fork AND a knife, 🍽️ a plate with cutlery);
                    "\n" in `en` starts a new line ("It takes me …\nIt took me …": each form on its own line);
                    `[brackets]` in `en` highlight only that part ("[I want to] relax."); `say` = how it sounds in the
                    student's letters, small under the word ("We'll see." · `say: "«уил си»"`), never IPA
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
                    Leaner cards: an empty `kicker` / `title` is left out; `practiceLabel: ''` drops "Say each one 5 times".
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
with a short quality note (British usage, errors, overload). His "reviewed again" ticks live in
`state/mat-<slug>`. Materials follow the student's English (see **Students**); flag British forms when you see them.
`promises/<slug>` = what the teacher promised that student (`{items[{id, date, what, kind: next|send|other, t}]}`,
Claude adds them from transcripts) and `state/promises-<slug>` = his side (`{done{id: true}, added[{id, date, what}]}`):
the "Promised" list at the top of each student page (tick when done, add his own, ✕ his own) and "N promised" on the
Students cards.
`emails/<slug>` = real work emails a student sent or received, kept to build lessons from (`{note, items[{n, got, from,
kind: received|hers, text, use[]}], plan[]}`; `use` = the lines worth teaching). Read it before a lesson for that
student; never put an email on a page as it is: made-up versions only (other names, codes, customers, numbers).

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
