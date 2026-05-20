# Session Handoff — 2026-05-20 — HubSpot + EAS both blocked

Two unresolved blockers carry into the next session. Both are top priority.

---

## ⭐⭐ BLOCKER #1 — EAS AAB build regression (carried from 2026-05-19)

**Status:** Still blocked. Windows Task Scheduler armed for autonomous hourly retries.

**Symptom.** Every `npx eas build` invocation today (5 attempts) fails with the same Hermes / `otelModulePromise = import(/* webpackIgnore: true */ ...)` error during EAS's internal compilation step.

**Confirmed via bisect: NOT our code.** Branch had reverted to a previously-green commit and still failed. EAS-side regression.

**V57.20.1 build 194 ready to ship** once EAS lifts:
- B2l (orphan SDK geofence) — 4 delete paths fixed (1 in `app/alerts.tsx`, 3 in `hooks/useOrchestrator.ts`)
- B3i (`react-native-background-geolocation` mobile lib)
- AppState listener leak (closure captures stale state)
- B4j eager-create fix for legacy `action_config.list_name` references (mobile + voice mirrored)

**Autonomous retry setup.** Windows Task Scheduler runs `eas-retry.ps1` hourly. When EAS clears, the script self-completes and writes `.eas-retry-success`. Confirm next session:

```
ls C:\Users\waela\naavi-mobile\.eas-retry-success
cat C:\Users\waela\naavi-mobile\eas-retry.log | tail -40
```

If `.eas-retry-success` exists → AAB was queued and submitted. Confirm via Play Console.
If not → check `eas-retry.log` for what EAS is still returning.

---

## ⭐⭐ BLOCKER #2 — HubSpot auto-acknowledgment doesn't reach gmail.com addresses

**Status:** Migration to HubSpot is complete and verified for non-gmail.com domains. Gmail-specific deliverability gap is unresolved.

### What got built this session (all working, end-to-end verified)

1. **Migrated ingest-ticket from Help Scout to HubSpot.** 
   - File: `supabase/functions/ingest-ticket/index.ts`
   - HubSpot Service Key: saved in `tests/.env` (gitignored) + Supabase secret `HUBSPOT_ACCESS_TOKEN`
   - HubSpot portal ID: `343125145` (MyNaavi Foundation)
   - Pipeline: "Support Pipeline" id=`0`, stage "New" id=`1`
   - Flow: form POST → DB ticket row → HubSpot contact find-or-create → HubSpot ticket create with association → audit_trail records HubSpot ticket id

2. **Started Sales Hub Professional 14-day trial** to unlock Workflows (started 2026-05-20; expires 2026-06-03).

3. **Built Auto-acknowledge new ticket workflow.**
   - Trigger: Create date is known + Pipeline = Support Pipeline
   - Action: Send "Ticket received" automated email to all associated contacts
   - Status: ON
   - Pre-built template: subject `Your ticket '{{ticket.subject}}' has been received`

4. **Help Scout setup is dismantled** — the trial subscription is still active (free), but ingest-ticket no longer calls it. Safe to cancel the Help Scout trial at user's convenience.

### The blocker — gmail.com addresses receive nothing

**Verified data** (Wael's testing):
- 4 form submissions with `@gmail.com` reporter emails (wael.aggan@gmail.com, aggan2207@gmail.com, mynaavi2207@gmail.com): **0 acknowledgment emails received**
- 3 form submissions with non-gmail domains (mynaavi.com + others): **3 received instantly**

**HubSpot's email-stats page reports "Sent to 1, delivered to 1"** for one of the gmail.com sends. So HubSpot's MTA accepted the handoff. But the email never appears in Gmail Inbox/Spam/Promotions/All Mail.

Gmail searches that returned **nothing** for the missing acknowledgments:
- `from:hubspot` (today only)
- `from:hs-send.com` (today only)
- `"has been received"` (no HubSpot matches today)

**Verified HubSpot contact properties — all 3 identical:**
- `hs_marketable_status = false` (same for the mynaavi.com contact that DID receive)
- `hs_email_optout = null`
- `hs_email_bounce = null`
- `lifecyclestage = lead`

So contact marketing status is **not** the differentiator.

**Sender domain Wael's mynaavi.com inbox saw** (when an email DID arrive at support@mynaavi.com):
`support+2D1=343125145.na3.r.hubspot-inbox.com@hubspotstarter.na3.hs-send.com`
Display name: `mynaavi.com`

### Hypothesis from research (NOT yet verified)

DMARC alignment: HubSpot's display claims `mynaavi.com` but actual SMTP sender is `hubspotstarter.na3.hs-send.com`. Since Feb 2024, Gmail strictly enforces DMARC alignment on outbound and inbound. Free Gmail accounts apply stricter filtering than Google Workspace accounts of the same root. **This is a research-agent hypothesis, not confirmed against logs.**

### What's NOT yet checked (do these FIRST next session, evidence-based)

1. **HubSpot's per-recipient delivery log.** We never reached the Recipients tab on the "Ticket received" email's stats page. That page shows the exact `Sent / Delivered / Opened / Bounced / Filtered` status per recipient address. Direct evidence of whether HubSpot reports gmail.com sends as delivered or as bounced/filtered.
   - Path: Marketing → Email → click "Ticket received" row → Recipients tab.
   - We kept landing on the wrong panel in the UI today. Try again clean.

2. **HubSpot's workflow enrollment history.** Confirms whether the workflow actually enrolled the gmail.com tickets and whether the Send Email action fired.
   - Path: Automation → Workflows → "Auto-acknowledge new ticket" → Performance history → Enrollment history.

3. **If logs show "Sent" but Gmail shows nothing → DMARC investigation.** Connect mynaavi.com as Email Sending Domain in HubSpot (DKIM CNAME + DMARC TXT). Then re-test. Cost: free (DNS only).

4. **If logs show "Bounced/Filtered" → HubSpot deliverability issue.** Different fix path (sender warm-up, paid Transactional Email add-on, or vendor switch).

### Vendor comparison if HubSpot can't reach gmail.com

If after step #1-3 above gmail.com still can't be reached, revisit the 2026-05-20 research-agent table. Top alternatives:
- **Zendesk Suite Team** — $55/seat/mo, most documented, native SMS via Talk
- **Plain** — ~$60/seat/mo, modern, GraphQL, dev-friendly, no SMS

The DB schema + `ingest-ticket` skeleton are vendor-agnostic. Switching cost is ~2-3 hours: replace the HubSpot find-or-create+ticket block in `ingest-ticket` with the new vendor's API.

---

## Other notes from today

- **Help Scout email forwarding fix shipped.** Gmail filters for `support@/hello@/bugs@` aliases now forward to `help@mynaavi.helpscoutapp.com` via per-filter "Forward to" action. Help Scout itself is no longer in the ingest path, but the email forwarding still works if any customer emails one of those aliases directly.
- **Web forms migrated off Formspree to `ingest-ticket`.** All 4 forms (`report.html`, `contact.html`, `start.html`, `index.html` signup) POST directly with `source_channel` hidden field. Verified end-to-end (tickets #1029-#1041).
- **Holding list F6a Phase 1 — closed.** Migrated forms + DB tickets + HubSpot integration is the F6a Phase 1 scope. Phase 2 (Naavi AI auto-triage drafts) is queued, blocked on the HubSpot Gmail issue.

---

## File state at end of session

**Modified, uncommitted (main repo):**
- `supabase/functions/ingest-ticket/index.ts` — Help Scout removed, HubSpot added

**New, uncommitted:**
- `tmp/hubspot-connectivity-test.mjs` — verifies HubSpot token, pipelines, contact search, ticket create
- `tmp/helpscout-connectivity-test.mjs` — kept for reference (Help Scout no longer in path)
- `tmp/helpscout-list-recent.mjs` — kept for reference
- `docs/SESSION_HANDOFF_2026-05-20_HUBSPOT_GMAIL_BLOCKER.md` — this file

**Secrets state:**
- `tests/.env` (gitignored): `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PORTAL_ID`, plus the Help Scout pair (now unused)
- Supabase secrets: `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PORTAL_ID` set 2026-05-20
- Help Scout secrets in Supabase + tests/.env still present but no longer referenced by deployed `ingest-ticket`

**Tickets created today (HubSpot portal 343125145):**
- #1029-#1036 — early Help Scout era
- #1037-#1041 — HubSpot era; verified via API
