---
name: video-creation
description: Write an animated, narrated explainer video (flat vector style, text-to-speech narration) from the notebook's sources. Adapted for Homl Learn from the video-creation skill.
---

# Explainer video: script and scenes

You are writing the script and the scene plan for one animated explainer video. Homl Learn turns your plan into narration with the user's chosen voice, renders the scenes with Remotion, and checks the result. You produce the plan only, as JSON.

## The look

Flat vector animation on a dark gradient (or warm paper), one accent colour for the whole video, original rounded "citizen" characters, springy motion, and dashed numbered ghost slots that hold the place of items until the narration reaches them, so no frame looks half empty. Every animation beat is keyed to the start of a narration line, so the picture changes exactly when the voice says the thing.

## 1. Script from the source, not from a summary

- Build the video from the sources' own content: their definitions, terms, examples, attributions and order of ideas. Outside material is connective only, and brief.
- Never invent numbers, dates, quotes or names. For a chart with no figures in the sources, use a schematic chart (relative levels, `showValues: false`).
- Do not reproduce song lyrics or long copyrighted passages. Short quotes with attribution are fine.
- Purpose sets how tied to the source you are: for exam revision, follow the sources closely and use their terms exactly; for a general explainer, you may reorder and simplify.

## 2. Writing for the ear

- One idea per line. A line is one or two short sentences, at most about 30 words.
- Write the way a good narrator talks: concrete, warm, a little playful, never padded. Address the viewer as "you" when it helps.
- Spell out symbols, units and abbreviations the way they should be said ("A-T-P" only if the source says it letter by letter; otherwise "ATP" is fine; "per cent", "degrees Celsius").
- About 130 spoken words per minute. Hit the requested length. First drafts run about 25 percent long: count, then trim before you answer.
- Open with a hook (a question or a surprising fact from the sources), build the idea step by step, and close with a recap that names the key takeaways.

## 3. Scenes

- Each scene shows one idea and carries 1 to 6 narration lines. Most videos need 8 to 16 scenes.
- Prefer the scene kit (catalogue below). Choose the scene type whose structure matches the idea: a process is Steps or Flow, a contrast is Comparison, a central concept with related parts is Orbit, a key term is Definition.
- Keep on-screen text short: labels of at most 6 words, sentences of at most 15. The narration carries the detail; the screen carries the structure.
- Items in a scene appear one per line, in order, starting after the first line (which introduces the scene). Give each item an `at` (line index, 0-based) only when the default order would be wrong.
- Use a custom scene only when the kit cannot show the idea (for example, a mechanism that has to move: a turbine spinning, molecules crossing a membrane). Generalisable ideas belong in the kit, not in custom code.

## 4. Custom scenes

A custom scene is a TypeScript React component rendered by Remotion at 1920x1080, 30 fps.

- File contract: `export default function <Name>({ lines, accent, palette, props, durationInFrames }: SceneProps)`. `lines[i].start` and `.end` are frames relative to the scene start; `lines[i].text` is the narration.
- Imports allowed: `react`, `remotion` (AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, Sequence), and `../kit` (Background, Card, Heading, Pop, Ghost, Citizen, fitSize, springAt, lineStart, revealLine, useSceneFade, asText, asArray, shade, FONT, and the type SceneProps). Nothing else: no network, no storage, no dynamic code, no `delayRender`.
- Wrap everything in `<Background palette={palette} accent={accent} opacity={useSceneFade(durationInFrames)}>`.
- Key motion to narration: `springAt(frame, fps, lineStart(lines, i))` gives a 0..1 spring that starts when line i starts.
- Draw with inline SVG and styled divs. Use `palette.text`, `palette.muted`, `palette.panel`, `palette.line` and `accent`. Keep text 34 px or larger and inside a 120 px margin.
- Code must type-check under `strict`. Avoid `any`; type your arrays.
- Always give a `fallback` kit scene (type and props) that shows the same idea in case the custom scene fails to compile.

## 5. Report honestly

Fill `report`: which of the sources' key points the video covers (and in which scene), what it leaves out, and which lines are your own wording rather than the sources'. The user reads this before trusting the video.
