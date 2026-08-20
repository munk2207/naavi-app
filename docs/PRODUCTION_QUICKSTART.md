# Making a MyNaavi Demo — Start Here

This is the only page you need to open to make a video. Everything else in `docs/PRODUCTION_*.md` exists for consistency across sessions when Claude builds things for you — not as required reading for you. If you're following this page, you're doing it right.

---

## The 6 steps

1. **Write the one-sentence story.** Reuse the existing cast — Robert, Linda, Home, Costco, etc. Don't invent new people or places unless the story genuinely needs one.

2. **Copy the folder.** Duplicate `Scenarios/Demo1_Arrive_Home_Personal_And_ThirdParty_Message/` as a starting template, rename it, and fill in:
   - `Script.md` — the story + what you say to Naavi
   - `Storyboard.md` — the scene-by-scene shot list
   - `Notes.md` — the on-screen card timing
   - `Exposure.md` — anything real (phone numbers, addresses) that must be blurred/cropped before the video goes public

3. **Check readiness before you hit record.** A handful of things drift between sessions — pending alerts, inbox state, screen recording actually running. Ask Claude "check technical readiness for this scenario" before recording; don't try to remember the list yourself.

4. **Record two things:** your screen (MyNaavi), and the second phone (Evidence) — remember Evidence must show a light/white background, never dark, so it reads as a different device.

5. **Edit in CapCut** using the master template (once it exists) — drop your clips into the labeled slots, don't rebuild the layout each time.

6. **Export, write the title/description, publish.**

---

## If something feels off — optional, not required

You will probably never need these, but if a specific question comes up:

| You're wondering... | Ask Claude to check |
|---|---|
| "Does the color/pacing/subtitle style look right?" | Presentation Governance |
| "Am I about to leak a real phone number or address?" | This scenario's `Exposure.md` |
| "Is the account actually ready to record?" | Technical Readiness |
| "Which people/places am I supposed to reuse?" | Demo Data Package |

You don't need to open these yourself — just ask, and point at what feels off. That's the whole point of building it this way: the complexity is Claude's job to carry, not yours.
