# MyNaavi Website — Session 11 Work Summary

**Date:** April 17, 2026
**Repo:** `munk2207/mynaavi-website` (deployed to https://mynaavi.com via Vercel)
**Branch:** `main`

---

## What was done

### 1. Honest website review
An end-to-end assessment of the previous mynaavi.com, covering strengths, weaknesses, and gaps. Key findings:
- Pitch was too abstract ("AI life orchestration") — didn't say what Naavi actually does
- No product demo, screenshots, or video
- Waitlist as primary CTA was weak given the product is actually working
- Non-profit framing was risky without reinforcement
- No social proof, no comparison to existing voice assistants
- Blog existed but was invisible from the homepage

### 2. Homepage rewrite (`index.html`)
Complete content rewrite, same dark-teal visual style. Sections now include:

- **Hero** — "One phone number. Naavi handles the rest." with a third-person Robert narrative (not inviting the reader to call today)
- **Sixty seconds at a doctor's visit** — concrete flagship scene with three numbered steps, ending in a "while Robert walks to his car" list showing nine orchestrated outcomes
- **Why it's different from Siri, Alexa, Google Assistant** — five-row comparison table
- **Who Naavi is for** — four audience cards (active senior, adult child, care facility, healthcare partner)
- **Founder letter** — named (Wael Aggan), concrete origin story, personal voice
- **Thinking in public** — blog teaser cards with three existing essays
- **Be among the first** — expanded signup form (email + role dropdown + optional message)

### 3. Blog articles refreshed

All three existing articles polished. Each now has:
- Tightened lead paragraph where appropriate
- A new "what this looks like in practice" section tying the essay to a real Naavi interaction
- A unified CTA block with the private-preview message and two buttons

Articles updated:
- `/blog/aging-in-place-gap` — leads with the 81% / 26% gap
- `/blog/orchestration-not-automation` — Google Maps analogy intact; Naavi-in-action close added
- `/blog/retrieval-not-storage` — Carvalho memory story intact; "what retrieval looks like when it works" added

### 4. Phone-number removal (critical)

Identified a gap: the voice server has no onboarding path for strangers. If a visitor calls the public number before signing in through the mobile app, they hit a dead-end (no Google refresh token, no Gmail / Calendar / Drive access).

Removed the public phone number from:
- Homepage hero CTA
- Homepage meta text
- All three blog article CTAs
- Blog article body copy

Replaced with two-button approach: **"Join the private preview"** (primary) and **"Talk to us"** (secondary), both scrolling to the same signup form. Hero meta text now reads *"Currently in private preview with families in Ontario. Expanding soon."*

### 5. Signup form expansion

The form previously collected only email. Now:
- Email (required)
- "I'm a…" dropdown: Active senior / Family / Care facility / Healthcare organization / Other
- Optional message textarea
- Reply-within-3-business-days promise

Submissions go to Formspree (form ID `xvzdkjod`, wired up in commit `e7eeffb`).

### 6. Guide page update (`/guide`)

Two changes:
- **Rebranding** — "MyNaavi Foundation" → "MyNaavi" everywhere (nav, footer, copyright, OG tags)
- **New "Voice by Phone" section** — three steps explaining how the phone-call experience relates to the mobile app sign-in. Sets the expectation: app first for onboarding, phone for everyday voice. Resolves the inconsistency between the homepage's voice-first promise and the guide's app-only walkthrough.

---

## Commits pushed this session

All on `munk2207/mynaavi-website` branch `main`. Vercel auto-deploys every push.

| SHA | Title |
|---|---|
| `ab454ba` | Rewrite homepage and tighten blog CTAs |
| `4e7d47f` | Remove public phone number; replace with private-preview CTAs |
| `e7eeffb` | Wire up Formspree form ID for the signup form |
| `ad1b543` | Guide: align branding and add voice-by-phone section |

---

## What's live now at https://mynaavi.com

- **Homepage** — new hero, doctor-visit scene, Siri/Alexa comparison, audience cards, founder letter, blog teasers, signup form
- **Blog** — three essays with consistent private-preview CTAs
- **Guide** (`/guide`) — app setup + voice-by-phone explanation
- **Signup form** — live, delivering to Formspree
- **No public phone number anywhere** — protects against strangers hitting a broken onboarding path

---

## What's still outstanding

### Short-term (no new code required, mostly content / credentials)

1. **Verify Formspree delivery** — submit a test entry from the live site and confirm the email arrives in your inbox. First submission from a new form usually requires a one-time confirmation click.
2. **Review copy for anything that still feels off** — the homepage narrative assumes Robert and Marie as representative users; confirm those names work or substitute your actual target users' names.
3. **Founder photo** — the founder section uses a "W" dot placeholder. A headshot would be more credible.

### Medium-term (requires product work)

4. **SMS-triggered OAuth onboarding** (Option 1 from earlier discussion) — when an unknown number calls +1 249 523 5394, Naavi detects it and texts a sign-up link. Unlocks the "call to try" path for strangers without requiring mobile-app install first. ~1 hour of voice-server + EF work.
5. **Web signup-then-OAuth flow** (Option 2) — make the signup form the start of onboarding: email → Google sign-in → phone number confirmation → automatically registered. Better UX, ~2 hours.
6. **Reinstate phone number on the homepage** — after either (4) or (5) is live, put the Twilio number back as a working "try it now" CTA. Until then, keep the number off the public site.

### Longer-term (optional polish)

7. **Demo video or audio clip** — a 30-60 second recording of a real "record my visit" → summary flow would be a strong addition to the hero.
8. **Social proof** — one quote from a private-preview family would move conversion meaningfully.
9. **Pricing / model page** — add a simple page explaining the service model (subscription? insurance-billed? non-profit donation-supported?). Absence of this can feel unfinished to serious evaluators.
10. **Plausible or Fathom analytics** — privacy-friendly visitor tracking; ~$9-14/month.

---

## Hosting recommendation (from the session discussion)

**Stay on Vercel.** Free, fast, auto-deploys from GitHub, SSL included, no migration pain. HubSpot is wrong for this stage — it's a CRM + marketing platform priced for teams with active sales funnels. For now:

- Vercel (hosting) — free
- Formspree (forms) — free tier sufficient
- Add Plausible (analytics) when desired — ~$9/month
- Add Buttondown (newsletter) when you have ~50 subscribers — ~$9/month

Total stack: **$0-20/month** through 10,000 visitors and 1,000 signups.

Revisit HubSpot when you have paying users and a team.

---

*Generated April 17, 2026 as part of the Session 11 website overhaul.*
