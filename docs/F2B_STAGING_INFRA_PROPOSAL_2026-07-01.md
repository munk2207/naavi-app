# F2b — Staging Infrastructure Proposal (Voice/Railway)

Supersedes plan decision #1 in `docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md` §1.
Nothing in this document has been executed. This is a proposal awaiting explicit go-ahead, per Wael's instruction to pause Phase 7 and revisit staging isolation for the voice service first.

---

## 1. Why the original decision #1 doesn't hold up

Decision #1 ("same Railway service, conditional routing") assumed a shared process could safely serve both the real production demo number and a new staging demo number, gated only by which Twilio number was dialed. That's true at the *code* level — `getDemoEnvironment()` genuinely picks the right Supabase project per call. But at the *infrastructure* level, it means the box handling every real user's call (and, if anything ever goes wrong — a bad deploy, a crash loop, a bug in shared code) is the exact same box being used to iterate on unproven F2b code. That's not staging in any meaningful sense — it's feature-flagged production. Wael is right to reject it.

## 2. Proposed architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Railway: PRODUCTION service  │        │  Railway: STAGING service (NEW) │
│  branch: main (unchanged)     │        │  branch: staging (NEW)          │
│  env: production Supabase     │        │  env: staging Supabase          │
└──────────────┬────────────────┘        └───────────────┬──────────────┘
               │                                          │
   Twilio: existing 1-888-91-NAAVI            Twilio: NEW staging-only number
   (production demo + all real users)         (nothing else points here)
```

- **Two separate Railway services**, same project (independent env vars, independent deploys, independent URLs — a crash or bad deploy on one cannot affect the other). A fully separate Railway *project* would add stronger billing/account isolation but no additional safety for this purpose; recommending service-level separation as sufficient and simpler.
- **Two separate git branches** in `munk2207/naavi-voice-server`: `main` (production, untouched) and a new `staging` branch that the staging Railway service deploys from.
- **Two separate Twilio numbers**: the existing production `+18889162284` (webhook unchanged, still points at the production Railway service) and one brand-new number purchased specifically for staging (webhook points only at the staging Railway service).
- **Two separate Supabase projects** (already exist): production (`hhgyppbxgmjrwdpdubcx`) and staging (`xugvnfudofuskxoknhve`).

No code changes are needed. `getDemoEnvironment.js`'s `STAGING_*`-prefixed env var branch (already written, already Phase 3/Phase 6 reviewed) is exactly the mechanism this needs — the only thing changing is *where* it runs and *which* vars get set.

## 3. Exact setup steps

None of these have been done. Each is listed with what it requires from you (money, Twilio/Railway console access, or a decision) versus what I can do directly.

### Step 1 — Commit the F2b work (not yet done — needs your go-ahead)
Everything from this session is still uncommitted in both repos. Nothing can be deployed until it's committed and pushed to a branch.

### Step 2 — Create the `staging` branch (naavi-voice-server)
```
git checkout -b staging
git push -u origin staging
```
`main` stays exactly where it is — this is what satisfies "production Railway service must remain unchanged."

### Step 3 — Provision a staging demo user
`DEMO_USER_ID` needs to reference a real row in **staging** Supabase's `auth.users` (the row that owns every anonymous demo caller's `action_rules`/`sent_messages`). **Open question — I don't know whether one already exists in staging.** Need to check `xugvnfudofuskxoknhve`'s `auth.users` for an existing demo/test account, or create one, before this can work.

### Step 4 — Deploy the two new Edge Functions to staging Supabase
```
npx supabase functions deploy create-demo-reminder --no-verify-jwt --project-ref xugvnfudofuskxoknhve
npx supabase functions deploy receive-demo-sms-reply --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```
Then set the `DEMO_USER_ID` function secret on the **staging** project (Supabase dashboard → Edge Functions → Secrets, or `supabase secrets set`) to the user id from Step 3.

### Step 5 — Push the migration to staging
```
npx supabase db push --db-url "postgresql://postgres.xugvnfudofuskxoknhve:NaaviStaging2026@aws-1-us-east-1.pooler.supabase.com:6543/postgres?prefer_simple_protocol=true" --include-all --yes
```
Creates `demo_optouts` in staging only. Production is untouched.

### Step 6 — Buy a new Twilio number for staging (your action — costs ~$1–2/month)
In the Twilio console: buy one new number, dedicated to staging. **Do not touch the existing `+18889162284` number's configuration** — that's what protects requirement 5/6.

### Step 7 — Create the new Railway service (your action, or I can walk you through it live)
In the Railway dashboard, inside the existing project: "New Service" → deploy from GitHub → `munk2207/naavi-voice-server` → branch `staging`. Give it a distinct name, e.g. `naavi-voice-staging`.

### Step 8 — Set staging service env vars (your action, Railway dashboard)
| Var | Value |
|---|---|
| `SUPABASE_URL` | staging project URL (`https://xugvnfudofuskxoknhve.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key |
| `STAGING_SUPABASE_URL` | same as `SUPABASE_URL` above (mirrored — belt-and-suspenders, see §4 risk 2) |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | same as `SUPABASE_SERVICE_ROLE_KEY` above |
| `DEMO_TWILIO_NUMBER` | **leave unset** — this must never equal the real production number |
| `STAGING_DEMO_TWILIO_NUMBER` | the new number from Step 6, E.164 format |
| `DEMO_USER_ID` | **leave unset** |
| `STAGING_DEMO_USER_ID` | the user id from Step 3 |
| `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | can reuse the same values as production (same accounts, just a different phone number) unless you want cost tracking separated |

### Step 9 — Point the new Twilio number's webhooks at the staging service
- Voice webhook → `https://<staging-railway-url>/voice`
- SMS/Messaging webhook → `https://xugvnfudofuskxoknhve.supabase.co/functions/v1/receive-demo-sms-reply` (a Supabase Edge Function, not Railway — inbound SMS never touches the voice server in this design)

### Step 10 — Verify isolation before any call test
- Confirm the production number's webhook still points at the production Railway URL (unchanged).
- Confirm the staging Railway service has no `DEMO_TWILIO_NUMBER` set (so even if someone dialed it by mistake through the wrong number, it wouldn't recognize itself as "the" demo line).
- Only then proceed to Phase 7 manual tests against the staging number.

## 4. Risks

1. **Branch drift.** `staging` will diverge from `main` the moment new work lands on `main` without also being merged/fast-forwarded into `staging`. This is the direct cost of "separate branch" — CLAUDE.md's existing single-branch rule exists specifically to avoid this class of overhead. Accepted per your explicit instruction; flagging so it's a known tradeoff, not a surprise later. Recommend fast-forwarding `staging` to `main`'s tip only when there's something specific to test, not automatically.
2. **Mirrored env vars reduce, not eliminate, cross-environment risk.** Setting both `SUPABASE_URL` and `STAGING_SUPABASE_URL` to the staging project on the staging service means *any* code path on that box (not just the demo flow) can only ever reach staging Supabase — this is a deliberate belt-and-suspenders choice given a staging box should never see real-user traffic in the first place (no real Twilio number points at it), but it's worth being explicit that this is what makes a misconfiguration fail safe rather than fail into production.
3. **New Twilio number = new monthly cost** (~$1–2/mo) and one more piece of Twilio-console state to keep track of.
4. **Manual steps (6, 7, 8, 9) require Railway/Twilio console access** — I can produce exact instructions but can't click through either console myself in this session.
5. **Step 3 is a genuine unknown** — I have not confirmed whether a usable staging demo user already exists. This blocks Steps 4 onward until resolved.
6. **Nothing here has been tested.** This is infrastructure-only; it doesn't reduce the Phase 7 manual-test obligations already listed in `docs/F2B_PHASE5_EVIDENCE_2026-07-01.md` §5 — it's the prerequisite that makes those tests trustworthy.

## 5. What I need from you before doing anything

- Confirm this architecture (or tell me what to change).
- Say the word to commit the F2b work in both repos (Step 1) — I haven't committed anything yet.
- Tell me if you want me to check staging Supabase for an existing demo user (Step 3), or if you already know the answer.
- Steps 6–9 need you at the Twilio/Railway consoles — I'll give you exact copy-paste values when we get there.
