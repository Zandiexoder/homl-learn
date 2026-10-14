# Scene kit catalogue

Every scene object is `{"type": <kit type>, "title": <short scene name for chapters>, "props": {...}, "lines": [<narration lines>]}`.
Optional `at` on an item = the 0-based line index where it appears. Text limits are in words.

| type | use it for | props |
|---|---|---|
| Title | the opening card, or a new part of the video | `kicker` (2-3 words, optional), `title` (≤8), `subtitle` (≤12, optional) |
| Hook | an opening question or surprising fact, with a character | `question` (≤14) |
| Definition | a key term and its definition from the source | `term` (≤4), `definition` (≤25), `source` (source title, optional) |
| Quote | a short exact quote from a source | `quote` (≤30), `attribution` |
| Steps | an ordered process or method (2-6 steps) | `title`, `steps`: [{`title` (≤4), `detail` (≤8, optional)}] |
| Flow | a chain where each thing leads to the next (2-5 nodes); animated packets travel along the arrows | `title`, `nodes`: [string ≤3 words], `caption` (≤10, optional) |
| Comparison | two things side by side (2-4 points each) | `left`: {`title`, `points`: [string ≤8]}, `right`: same |
| Timeline | dated events in order (2-6) | `title`, `events`: [{`date`, `label` (≤5)}] |
| Chart | a bar chart (2-7 bars). Use `value` only with figures from the source and `showValues: true`; otherwise `level` 1-5 for a schematic chart | `title`, `bars`: [{`label` (≤2), `value` or `level`, `highlight` (bool)}], `showValues`, `unit` |
| Panels | 2-4 parallel ideas, causes, examples or parts | `title`, `panels`: [{`title` (≤4), `text` (≤14)}] |
| Cast | people who matter in the story (2-4) | `title`, `people`: [{`name`, `role` (≤6)}] |
| Orbit | one central concept and its related parts (3-6) | `center` (≤3), `items`: [string ≤3] |
| Spectrum | a range between two extremes with things placed on it (2-5) | `title`, `left`, `right`, `markers`: [{`label` (≤3), `position` 0-1}] |
| Recap | the closing summary (3-5 points) | `title` (optional), `points`: [string ≤8] |
| Custom | a moving mechanism the kit can't show (see the custom scene rules) | `name` (PascalCase), `code` (the .tsx file), `props` (passed through), `fallback`: {`type`, `props`} |
