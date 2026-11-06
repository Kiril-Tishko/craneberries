# Passive voice lessons

Two minimal slide-deck lessons in American English. Both are plain HTML, CSS and JS, with no build step and no dependencies. They share `styles.css` and `app.js`.

| Page | Lesson | Slides |
| --- | --- | --- |
| `index.html` | **Passive + modal verbs** (B1–B2) for learners who already know the passive | 19 |
| `practice.html` | **Passive practice** (A2–B1): make the passive automatic | 9 |

## Using them

- **← / →**, Space, or swipe to move between slides
- Click the **slide counter** (e.g. `3 / 9`) to jump to any slide
- **F** toggles fullscreen; **◐** switches light / dark
- Each slide has its own link (`practice.html#5`)
- Printing gives one slide per page, which works as a worksheet

## Passive + modal verbs (`index.html`)

| Type | Slides |
| --- | --- |
| Form & meaning | modal verbs reminder · modal + be + V3 (with negatives & questions) · modal + have been + V3 · what each past modal means · summary |
| Short exercises | complete · rewrite · choose · find the mistake |
| Open questions | warm-up · why the passive? · write the rules · should it be allowed? · what happened here? · in hindsight · “mistakes were made” · 12 closing discussion questions |

## Passive practice (`practice.html`)

| Type | Slides |
| --- | --- |
| Irregular verbs | table of 24 A1–B1 verbs (base · past · participle), with a hide-and-reveal quiz · flashcard drill |
| Form | one verb in every tense: only *be* changes |
| Short exercises | complete (mixed tenses) · active or passive? · rewrite · find the mistake |
| Discussion | 8 questions |

All the exercises and questions reuse the 24 verbs from the table.

## Editing

All content is in the HTML files, one `<section class="slide">` per slide.

- Typed gap: `<input data-answer="must be signed">`. Separate alternative answers with `|`. Typed answers are checked on **Check** (or Enter), and contractions are accepted, so *can't* and *cannot* both count.
- Multiple choice: mark the correct button with `data-ok`.
- Sentence starters: `<button class="chip">should be</button>` inserts its text into that slide's notes box. Notes are saved in the viewer's own browser only.
- Irregular verbs: edit the rows of the `data-verbs` table. The flashcard drill reads its verbs from that table.

## Publishing

To publish with GitHub Pages: **Settings → Pages → Deploy from a branch**, then pick this branch and `/ (root)`.
