# MyNaavi — Cost and Pricing Analysis

*Companion to the team status brief • April 21, 2026*

This document estimates the monthly cost to run MyNaavi, split into **fixed infrastructure** and **per-user variable** cost, so the team can reason about subscription pricing.

**All numbers below are estimates based on public provider pricing and projected usage profiles.** Real costs will vary by user behavior, provider promotions, and volume discounts.

---

## 0. How much to trust these numbers

Short version: **my per-user estimates could be off by ±30–50%.** Aggregate cost at 100+ users is much tighter (±10%) because individual user variance averages out.

### Realistic per-user ranges

| Profile | Point estimate | Realistic range | 80% confidence band |
|---|---|---|---|
| Light | $13 | $8–$25 | $10–$18 |
| Moderate | **$30** | **$20–$55** | **$25–$40** |
| Heavy | $106 | $70–$180 | $80–$140 |

### Top three sources of deviation (largest to smallest)

1. **User behavior variance.** The "moderate profile" (50 chat turns/day, 15 min voice, 20 alerts) is a hypothesis, not a measurement. One user might hit 15 turns/day, another 80. That alone moves Claude + Deepgram + Twilio costs by 3–5×. Until we have 30 days of actual usage across 5+ users, this is the single biggest uncertainty.

2. **Claude token patterns.** Two specific risks where actual cost may exceed estimates:
   - The `isBroadQuery` regex injects up to 100 knowledge fragments into the prompt for open-ended questions ("what do I know about…"). That's ~30k extra input tokens per query. If this fires 5–10× per day, it adds **$13–$27/month** per user on top of the $14 Claude estimate.
   - Calendar PDF ask-time reader attaches entire PDF documents to Claude's context. One PDF attach ≈ 20k tokens. Three attaches/day = $5.40/month per user.

   Working in our favor: Anthropic prompt caching gives a 90% discount on cached prefix. **Not yet implemented.** Once it is, Claude cost drops 30–40% at steady state.

3. **Feature adoption variance.** AssemblyAI (voice recording) and Twilio voice minutes are binary: most users won't use them; a few will use them heavily. My moderate profile splits the difference — which means most actual users will be below, and a small tail will be well above.

### Systematic risks — cost could be higher than estimated

| Risk | How much it could add | Mitigation |
|---|---|---|
| Claude token count per turn higher than 1,500 | +$10–$15/mo per user | Measure actual from `naavi-chat` Edge Function logs |
| `isBroadQuery` path firing often | +$13–$27/mo per user | Narrow the regex; cap knowledge fetch to 20 not 100 |
| Twilio voice minutes climbing if users treat Naavi as phone buddy | +$15–$25/mo per user | Add a soft cap on minutes; reach out if user exceeds |
| Support costs not modeled | +$5–$15/mo per user at scale | Price Plus tier with this headroom; triage support volume |

### Random risks — could go either way

- OCR usage depends on each user's email mix (scanned vs text PDFs).
- Places API calls depend on location rule churn.
- Voice recording adoption is feature-specific and binary.

### What would shrink the uncertainty

1. **30 days of real usage** from the 2 current users. Supabase logs + Twilio console + Deepgram dashboard + Anthropic console give exact per-user cost. The estimates then become measurements.
2. **Implement Anthropic prompt caching.** 30–40% Claude savings at steady state.
3. **Log token counts per turn** in the `naavi-chat` table. Lets us project accurately per user going forward.

### What this means for pricing

- **Don't price below $49.** The $39 Essentials tier has 22% margin at the moderate estimate; if moderate cost is actually $40 instead of $30, that margin collapses. $49 is a safer floor.
- **Plus at $59 has a buffer.** Even if moderate cost comes in at $40, margin stays around 30%.
- **Heavy users can be unprofitable on any tier.** A user consuming $150/month at a $89 Premium tier is a $61/month loss. Either soft-cap usage (works for ~95% of users), hard-cap (complaints), or bump Premium to $119.
- **Expect pricing to require one revision** within 60–90 days of paying users. That's normal; build it into the ToS.

---

## 1. Fixed infrastructure cost

These costs are incurred whether the service has 2 users or 2,000. They don't grow with user count until volume thresholds (bandwidth, storage, build quotas) are crossed.

| Line item | Provider | Monthly cost | Notes |
|---|---|---|---|
| Database + Edge Functions + Auth + Storage | Supabase Pro | **$25** | Current production tier. Free tier is insufficient for production. |
| Voice call server (Node / Twilio glue) | Railway Hobby | **$5–10** | Usage-based. Current footprint is small. |
| Marketing site | Vercel | **$0** | Free tier covers `mynaavi.com` (static HTML). |
| Domain registration | Registrar | **$1.25** | $15/year amortized. |
| Mobile CI/CD builds | EAS (Expo) Hobby | **$19** | 30 builds/month included. Free tier (15/month) works during private preview. |
| Google Play developer account | Google | **$2** | $25 one-time, amortized over 12 months = ~$2/month in year 1. |
| Apple Developer Program (if iOS) | Apple | **$8.25** | Not active today. Would be $99/year if iOS ships. |
| Supabase additional storage / bandwidth | Supabase | $0 today | Pro tier covers usage at current scale. Recalculate at 500+ users. |
| Monitoring (Sentry / etc.) | Free tier OK today | **$0** | Optional — $26/month Sentry Team plan worth considering pre-scale. |
| **Fixed monthly baseline (Android only)** | | **~$50–55** | |
| **Fixed monthly baseline (Android + iOS)** | | **~$60** | |

**One-time costs (not monthly):**

- Google Play developer account: $25 (one-time) — already paid.
- Apple developer: $99/year (renewing) — only if iOS ships.
- Domain: $15/year — already paid.

---

## 2. Per-user variable cost

These costs scale linearly with user activity. Three user profiles modeled:

- **Light** — 20 chat turns/day, 5 min voice/day, 10 alerts/day, no voice recording.
- **Moderate** — 50 chat turns/day, 15 min voice/day, 20 alerts/day, occasional voice recording. *(Baseline assumption.)*
- **Heavy** — 150 chat turns/day, 45 min voice/day, 50 alerts/day, regular doctor visit recordings.

### 2.1 Anthropic Claude (reasoning)

Primary model: **Claude Sonnet 4.6** ($3/M input tokens, $15/M output tokens)
Secondary: **Claude Haiku** ($1/M input, $5/M output) — for email action extraction, document classification.

**Per user per month:**

| Profile | Sonnet input | Sonnet output | Haiku (email/doc) | Monthly |
|---|---|---|---|---|
| Light | 900k toks ($2.70) | 180k toks ($2.70) | $0.20 | **~$5.60** |
| Moderate | 2.25M toks ($6.75) | 450k toks ($6.75) | $0.50 | **~$14.00** |
| Heavy | 9M toks ($27.00) | 2.25M toks ($33.75) | $1.20 | **~$61.95** |

Assumes average chat turn: ~1.5k input + ~300 output. Morning brief: ~2k input + 500 output. System prompt cached (Anthropic prompt caching reduces input by ~40% after first call of the session; conservative estimates above don't apply caching discount).

### 2.2 Deepgram (speech)

**Aura TTS**: $0.015 per 1,000 characters
**Nova-2 STT** (live voice calls + in-app mic): $0.0043/minute

**Per user per month:**

| Profile | Voice min | STT cost | TTS chars | TTS cost | Monthly |
|---|---|---|---|---|---|
| Light | 150 | $0.65 | 15k | $0.23 | **~$0.88** |
| Moderate | 450 | $1.94 | 45k | $0.68 | **~$2.62** |
| Heavy | 1,350 | $5.81 | 120k | $1.80 | **~$7.61** |

### 2.3 AssemblyAI (voice-call recording transcription)

$0.37 per hour of audio.

**Per user per month:**

| Profile | Hours recorded | Monthly |
|---|---|---|
| Light | 0 | $0.00 |
| Moderate | 2 | **$0.74** |
| Heavy | 5 | **$1.85** |

### 2.4 Google Cloud APIs

- **Places Text Search**: $17/1,000 requests
- **Geocoding**: $5/1,000 requests
- **Vision OCR (DOCUMENT_TEXT_DETECTION)**: $1.50/1,000 pages

**Per user per month:**

| Profile | Places calls | Geocode | OCR pages | Monthly |
|---|---|---|---|---|
| Light | 10 | 5 | 5 | **$0.22** |
| Moderate | 30 | 15 | 10 | **$0.60** |
| Heavy | 80 | 40 | 30 | **$1.61** |

### 2.5 Twilio (SMS + WhatsApp + Voice)

- **SMS (CA/US)**: ~$0.008/message
- **WhatsApp business template**: ~$0.005/message
- **Outbound voice (morning brief)**: ~$0.014/minute
- **Inbound voice (user-initiated call)**: ~$0.0085/minute

Note: every self-alert fires on 4 channels (SMS + WhatsApp + Email + Push). Email and push are effectively free (Gmail via user's OAuth, FCM free). So per alert, Twilio cost ≈ $0.013 ($0.008 SMS + $0.005 WhatsApp).

**Per user per month:**

| Profile | Alerts/day | Morning calls | Inbound voice min | Monthly |
|---|---|---|---|---|
| Light | 10 | 30 × 2 min = $0.84 | 150 × $0.0085 = $1.28 | $3.90 alerts + $2.12 voice = **$6.02** |
| Moderate | 20 | $0.84 | 450 × $0.0085 = $3.83 | $7.80 + $4.67 = **$12.47** |
| Heavy | 50 | $1.68 (longer calls) | 1,350 × $0.0085 = $11.48 | $19.50 + $13.16 = **$32.66** |

### 2.6 Push notifications (FCM) and Open-Meteo weather

**Free tier for both**, no per-user cost at our scale.

---

## 3. Per-user totals

| Cost component | Light | Moderate | Heavy |
|---|---|---|---|
| Anthropic Claude | $5.60 | $14.00 | $61.95 |
| Deepgram | $0.88 | $2.62 | $7.61 |
| AssemblyAI | $0.00 | $0.74 | $1.85 |
| Google Cloud | $0.22 | $0.60 | $1.61 |
| Twilio | $6.02 | $12.47 | $32.66 |
| **Point estimate** | **~$13** | **~$30** | **~$106** |
| **Realistic range** | $8–$25 | $20–$55 | $70–$180 |
| **80% confidence band** | $10–$18 | $25–$40 | $80–$140 |

The moderate profile — the expected baseline for the target senior user — is **~$30/month at the point estimate, with a realistic range of $20–$55**. See §0 for the sources of variance.

---

## 4. Total cost at different scales

Assuming moderate-profile users:

| Users | Fixed | Variable | Total monthly | Per-user run cost |
|---|---|---|---|---|
| 1 | $55 | $30 | **$85** | $85.00 |
| 10 | $55 | $300 | **$355** | $35.50 |
| 50 | $55 | $1,500 | **$1,555** | $31.10 |
| 100 | $55 | $3,000 | **$3,055** | $30.55 |
| 500 | $90 (bigger Supabase tier) | $15,000 | **$15,090** | $30.18 |
| 1,000 | $150 | $30,000 | **$30,150** | $30.15 |

At ~100+ users, per-user cost stabilizes around the variable cost (~$30/month for moderate). Fixed costs become negligible per-user.

---

## 5. Subscription pricing analysis

### What the cost floor tells us

A single moderate user costs ~$30/month in direct provider fees. Any subscription pricing must clear that plus cover:

- Customer acquisition cost (marketing, referrals)
- Ongoing product development (your time + any team)
- Customer support
- Payment processing (Stripe ~3% + $0.30/transaction)
- Taxes
- Margin / profit

Rule of thumb: **subscription price should be 2–3× variable cost** to have durable margins and reinvestment capacity.

### Recommended pricing tiers

Three options modeled. Numbers below show **gross margin at 100 users, moderate profile**.

| Tier | Monthly price | Revenue @ 100 users | Total cost @ 100 | Gross margin | % margin |
|---|---|---|---|---|---|
| **$39** (cost-plus) | $39 | $3,900 | $3,055 | $845 | **21.6%** |
| **$59** (market-aligned) | $59 | $5,900 | $3,055 | $2,845 | **48.2%** |
| **$79** (premium-aligned) | $79 | $7,900 | $3,055 | $4,845 | **61.3%** |
| **$99** (high-touch) | $99 | $9,900 | $3,055 | $6,845 | **69.1%** |

### Competitive reference points

- ChatGPT Plus: $20/month (general-purpose AI, no messaging, no phone calls)
- Google Nest Aware: $8–15/month (home monitoring only)
- LifeAlert / Philips Lifeline medical alert: $30–50/month (single-function)
- Concierge services (GoGoGrandparent, Papa): $30–300/month (human agents, variable)

### Three tier structure (recommended)

| Tier | Price/month | Features | Target user |
|---|---|---|---|
| **Essentials** | **$39** | Text chat, morning brief call, SMS/email alerts, 2 hrs voice/month, basic location alerts | Users who want the reliability without heavy voice use |
| **Plus** *(default)* | **$59** | Everything in Essentials + unlimited voice, WhatsApp alerts, voice recording up to 4 hrs/month, weather alerts, context-aware alerts (tasks + lists) | The expected default — good margins, covers normal usage |
| **Premium** | **$89** | Everything in Plus + unlimited voice recording, priority support, multi-location alerts, family access (spouse can receive alerts too) | Heavy users, power users, small households |

Unit economics at **100 users** with a 15 / 70 / 15 tier split (Essentials / Plus / Premium):

- Revenue: (15 × $39) + (70 × $59) + (15 × $89) = $585 + $4,130 + $1,335 = **$6,050/month**
- Cost: $55 fixed + 100 × avg $30 variable = **$3,055/month**
- **Gross margin: $2,995 (49.5%)**

---

## 6. Break-even analysis

Assuming **Plus tier at $59** as the reference price (covering customer support and modest development reinvestment):

| User count | Monthly revenue | Monthly cost | Monthly margin |
|---|---|---|---|
| 1 | $59 | $85 | **-$26** (loss) |
| 5 | $295 | $205 | $90 |
| 10 | $590 | $355 | $235 |
| 25 | $1,475 | $805 | $670 |
| 50 | $2,950 | $1,555 | $1,395 |
| 100 | $5,900 | $3,055 | $2,845 |

**Break-even: ~2 paying users** at $59/month.

To sustain part-time development (~$3,000/month contribution): ~10 paying users.
To sustain full-time development (~$15,000/month): ~50 paying users.

---

## 7. Assumptions, risks, and sensitivity

### Where these numbers could drift

- **Claude usage**: if users ask more complex questions or the isBroadQuery path fires often (fetches all 100 knowledge items), Sonnet input tokens balloon. Per-user Claude cost could double in heavy use.
- **Voice minutes**: Twilio voice is the third-largest cost driver. Users who treat Naavi as a phone buddy (hours/day) could push this 5–10×.
- **Fan-out multiplier**: every self-alert fires on 4 channels. If Robert sets 20 alerts/day, that's 80 Twilio events. We accepted this cost in exchange for reliability — worth re-examining if average alert count spikes.
- **Prompt caching**: Anthropic offers 90% discount on cached prompt prefixes. Not applied to the estimates above but could reduce Claude cost by 30–40% at steady state.
- **Volume discounts**: Twilio, Deepgram, Google Cloud all have volume tiers that kick in at 10k+/month. Not factored in.

### Things we haven't paid for yet

- **Sentry / Datadog / observability**: $0 today; likely $30–100/month at scale.
- **Dedicated voice server scaling** (Railway): current $5/month covers tiny load. At 500 active users making phone calls, probably need $30–50/month.
- **Legal / compliance**: privacy review, ToS update, HIPAA if medical data grows.
- **Support**: even light email support at 1 reply/user/month = time cost.

### Things NOT in per-user variable cost

- Marketing / CAC — large unknown. Word-of-mouth and family-member referral is cheapest; paid ads for senior-targeted products are expensive.
- Payment processing — Stripe ~3% + $0.30. On a $59 subscription, that's ~$2.07/month deducted from revenue. Include this when calculating true gross margin.

---

## 8. Recommendations for the subscription decision

1. **Adopt the three-tier structure** (Essentials $39 / Plus $59 / Premium $89). It captures different willingness-to-pay without excluding lower-usage users and gives margin room on higher-use ones.

2. **Price Plus at $59 as the default** — clears ~2× variable cost, leaves room for ongoing development, aligns with competitive points in senior-targeted services.

3. **Offer a 14-day free trial**, not a freemium free tier. Free tier on a service with Twilio per-send costs bleeds cash with no upside.

4. **Set a soft usage cap on Premium** — "up to 10 hours of voice recording per month". Hard caps alienate users; soft caps let you have a conversation with the 1–2% heavy outliers.

5. **Revisit pricing at 100, 500, and 1,000 users.** Volume discounts from providers AND our own usage data will make the $30/moderate-user estimate more precise.

6. **Separate pricing for family access** — if Wael wants alerts about his parent's arrivals, he may pay for his own "family member" seat at a lower price (e.g., $10/month) without a full feature set.

7. **Don't underprice.** Seniors value reliability and support. Naavi's advantage is orchestration + integration + voice — not discount pricing. Price for the value delivered, not the raw token cost.

---

## 9. Summary one-liner

> **The $30/moderate estimate is my best guess from public pricing and assumed usage. Actual could land anywhere from $20 to $55 per user per month. I would bet on $25–$40 with 70% confidence — which is why the $59 Plus tier leaves room. Ship at that price, measure actual costs over the first 60 days from 5+ users, and be prepared to adjust within 90 days.**

---

*Prepared by Wael and Claude Code. All figures are estimates based on public pricing as of April 2026 and projected usage. Revisit quarterly.*
