# Passive voice + modal verbs

A minimal slide-deck website for one lesson (B1–B2) for learners who already know the passive: a quick modal-verbs reminder, short exercises and lots of open questions. American English throughout.

Open `index.html` in a browser. It is plain HTML, CSS and JS with no build step and no dependencies.

## Using it

- **← / →**, Space, or swipe to move between slides
- Click the **slide counter** (e.g. `7 / 17`) to jump to any slide
- **F** toggles fullscreen; **◐** switches light / dark
- Each slide has its own link (`index.html#12`)
- Printing gives one slide per page, which works as a worksheet

## What's inside

| Type | Slides |
| --- | --- |
| Form & meaning | modal verbs reminder · modal + be + V3 (with negatives & questions) · modal + have been + V3 · what each past modal means · summary |
| Short exercises | complete · rewrite · choose · find the mistake |
| Open questions | warm-up · why the passive? · write the rules · should it be allowed? · what happened here? · in hindsight · “mistakes were made” |

Typed exercises are checked on **Check** (or Enter). Contractions are accepted, so *can't* and *cannot* both count. Answers on the open-question slides are saved in the viewer's own browser only.

## Editing

All content is in `index.html`, one `<section class="slide">` per slide.

- Typed gap: `<input data-answer="must be signed">`. Separate alternative answers with `|`.
- Multiple choice: mark the correct button with `data-ok`.
- Sentence starters: `<button class="chip">should be</button>` inserts its text into that slide's notes box.

## Publishing

To publish with GitHub Pages: **Settings → Pages → Deploy from a branch**, then pick this branch and `/ (root)`.
