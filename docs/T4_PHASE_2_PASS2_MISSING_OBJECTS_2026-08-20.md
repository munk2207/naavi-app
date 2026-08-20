# Phase 2 — Pass 2 — Change Plan — the missing objects

**Date:** 2026-08-20
**Governance version:** v4.0
**Pass 1:** approved through Phase 6, closing at Phase 8
**Status:** Plan complete. **Awaiting Wael's go-ahead for Phase 2 → 3.**

---

## 1. Why Pass 2 is the one that matters

Pass 1 fixed *constraint definitions*. It restored **no functionality** — it made staging reject what production rejects.

**Pass 2 is where staging gets its missing capability back.** Everything Wael named when he said staging and production must be functionally equal is in here.

**A correction to the Phase 1 figure, before anything else.** Phase 1 reported **36 missing columns**. Filtering to tables staging actually has, it is **10**. The other 26 belong to the four missing tables and arrive with them. The work is materially smaller than the measurement implied, and saying so now is better than discovering it mid-implementation.

## 2. Scope, split into three parts

| | Contents | Restores | Size |
|---|---|---|---|
| **2a** | **10 columns** on existing tables | first-call state, name accuracy, morning call, OCR | one small migration |
| **2b** | **4 tables** + their indexes, constraints and RLS | `people`, `conversations`, `pending_disambig`, `waitlist_signups` | one larger migration |
| **2c** | **12 secrets, 2 cron jobs** | push, WhatsApp, OCR keys, inbound email, calendar sync | configuration, **not** a migration |

**Split because they fail differently.** 2a is additive and near-riskless. 2b creates tables with security rules that must be read, not copied. 2c is not SQL at all and cannot go in a migration — secrets are set through the dashboard or CLI, and the cron jobs need a service-role key that must never enter a file.

## 3. Pass 2a — the 10 columns

Every one taken from production's catalogue, exact type and default:

| Table | Column | Definition | Why it matters |
|---|---|---|---|
| `user_settings` | `first_call_completed_at` | `timestamptz` | ⭐ **[[B11c]]** — without it staging replays a **30-second uninterruptible onboarding on every call**. This is what blocked B11f testing |
| `user_settings` | `voice_keyterms` | `text[] DEFAULT '{}'` | Deepgram name boosting — staging currently transcribes names **worse** than production |
| `user_settings` | `morning_call_status` | `text DEFAULT 'pending'` | Morning call cannot run without these three |
| `user_settings` | `morning_call_attempts` | `integer DEFAULT 0` | " |
| `user_settings` | `morning_call_last_attempt` | `timestamptz` | " |
| `documents` | `extracted_text` | `text` | OCR pipeline output |
| `documents` | `ocr_sidecar_drive_file_id` | `text` | OCR sidecar reference |
| `reminders` | `source` | `text DEFAULT 'voice'` | Reminder provenance |
| `user_tokens` | `created_at` | `timestamptz DEFAULT now()` | Row age |
| `calendar_events` | `created_at` | `timestamptz DEFAULT now()` | Row age |

**All ten are `ADD COLUMN IF NOT EXISTS`, all nullable or defaulted.** No existing row is touched, nothing is rewritten, and the migration is a no-op on production — which already has all ten.

**Risk: low.** Adding a nullable column cannot break an existing write path.

## 4. Pass 2b — the four tables

| Table | Columns | Indexes | Constraints | RLS policies |
|---|---|---|---|---|
| `people` | 9 | 1 | 2 | **4** |
| `conversations` | 5 | 2 | 2 | 1 |
| `pending_disambig` | 5 | 1 | 1 | **0** — RLS on, service-role only |
| `waitlist_signups` | 7 | 3 | 2 | **0** — RLS on, service-role only |

**⚠️ The two with zero policies need care, not copying.** RLS enabled with no policy denies everything to non-service-role clients. In production that is a coherent server-only pattern. Reproducing it means reproducing that *intent* — and getting it wrong in the other direction (RLS on, no policy, where a client is meant to read) would silently return empty results rather than an error.

**Also worth stating: `people` and `pending_disambig` are the two tables whose absence has printed a warning in every auto-tester run for months.** Creating them makes that noise stop — and that noise was the system reporting this drift continuously, unread.

## 5. Pass 2c — secrets and crons

**12 secrets missing from staging.** Names only; **values differ by environment and must never be committed.**

`FIREBASE_SERVICE_ACCOUNT_JSON` · `GOOGLE_CLOUD_STT_KEY` · `GOOGLE_VISION_API_KEY` · `NAAVI_ANON_KEY` · `POSTMARK_INBOUND_ADDRESS` · `POSTMARK_SERVER_TOKEN` · `TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID` · `TWILIO_WHATSAPP_TEMPLATE_TASK_SID` · `VAPID_PRIVATE_KEY` · `VAPID_PUBLIC_KEY` · `VAPID_SUBJECT` · `distance Matrix API`

### 5.1 ⭐ Usage verified — 5 of the 12 are dead, not missing capability

The Phase 2 review required evidence that each secret is actually referenced before replicating it. **Done, by grepping the deployed code.**

| Secret | Referenced by | Verdict |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `send-push-notification` | **replicate** |
| `VAPID_PRIVATE_KEY` / `PUBLIC_KEY` / `SUBJECT` | `send-push-notification`, `lib/push.ts` | **replicate** |
| `GOOGLE_VISION_API_KEY` | `extract-document-text` | **replicate** |
| `POSTMARK_SERVER_TOKEN` | `check-ticket-replies`, inbound email | **replicate** |
| `NAAVI_ANON_KEY` | `evaluate-rules`, `fire-pending-dwells` | **not required** — both read it as `NAAVI_ANON_KEY ?? SUPABASE_ANON_KEY`, and staging has the fallback. No functional gap |
| `GOOGLE_CLOUD_STT_KEY` | **nothing** | **debris** |
| `POSTMARK_INBOUND_ADDRESS` | **nothing** | **debris** |
| `TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID` | **nothing** | **debris** |
| `TWILIO_WHATSAPP_TEMPLATE_TASK_SID` | **nothing** | **debris** |
| `distance Matrix API` | **nothing** — the name contains a space and cannot be a valid env var | **debris** |

**So only 7 represent real missing capability.** Replicating all 12 would have propagated five obsolete secrets into staging and called it parity. The reviewer's point — *"functional parity requires required configuration, not accumulation of obsolete secrets"* — was exactly right.

**⚠️ This also corrects an earlier claim of mine.** Phase 1 listed *"WhatsApp reminders / tasks"* among the features that cannot work on staging. **That was wrong.** The only WhatsApp template secret in use is `TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID`, which staging has. I inferred a broken feature from a missing secret without checking whether any code read it. Corrected in the Phase 1 document.

**⚠️ And a worry of mine that turned out to be unfounded — recorded because I nearly passed it to the reviewer as a finding.** I flagged `NAAVI_ANON_KEY` as possibly degrading alert firing on staging, since it is read by `evaluate-rules` and `fire-pending-dwells` and is missing there. **It does not.** Both read it as `Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')`, and staging has the fallback. Checking took one grep; not checking would have sent an alarm about the alert system into a review on no evidence.

**Revised proposal: replicate 6, skip 1 (covered by a fallback), delete the 5 from production** rather than copying them onward. The six that matter: `FIREBASE_SERVICE_ACCOUNT_JSON`, the three `VAPID_*`, `GOOGLE_VISION_API_KEY`, `POSTMARK_SERVER_TOKEN` — push notifications, OCR, and inbound email.

**⚠️ A real question, not a copying exercise:** several of these are *live third-party credentials*. Should staging get the **same** keys as production, or its **own**? Sharing means staging can send real push notifications and real WhatsApp messages, and consume production's quota. **Recommend separate staging credentials wherever the vendor allows**, but this is Wael's decision and it is a cost and safety question, not a technical one.

**2 crons missing:**

| Cron | Effect of absence |
|---|---|
| `sync-calendar-every-6h` | ⭐ **`calendar_events` is never populated on staging** — every calendar test runs against an empty table |
| `cleanup-old-emails` | Staging accumulates Gmail rows indefinitely. Housekeeping only |

**Both must point at the STAGING URL, not production's.** This is exactly the failure defused earlier today, and the same mistake is available here.

## 6. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No app file changes |
| **Voice** | **No** *(no code)* | Voice **behaviour** changes on staging — the greeting stops replaying — but no voice-server file is touched |
| **Shared Core** | **No** | No Edge Function changes |
| **Database** | **Yes** | Two migrations (2a, 2b), applied to both environments; no-ops on production |
| **Cron** | **Yes** *(2c)* | Two jobs created on **staging only**, pointing at staging |
| **API contracts** | **No** | No request or response shape changes |
| **Tests** | **Yes** | Two auto-tester teardown warnings stop once `people` and `pending_disambig` exist |

## 7. Risk

| Risk | Likelihood | Mitigation |
|---|---|---|
| A new cron points at the wrong environment | **Medium, high impact** | The exact failure defused today. URLs verified against the target project before creation |
| A shared third-party key lets staging spend production quota or message real users | **Medium** | §5 raises it as a decision, not an assumption. T2's outbound allowlist is a second line, not the first |
| RLS reproduced with the wrong intent | **Medium** | Policies read individually; the two zero-policy tables handled explicitly |
| Column additions break something | **Very low** | All nullable or defaulted, all `IF NOT EXISTS` |
| Applied to production by accident | Low | Both migrations are no-ops there — production has every object already |

## 8. Recommended order

1. **2a first, and within it `first_call_completed_at` matters tonight** — it unblocks [[B11f]], which has been finished and untestable since this afternoon.
2. **2c's calendar cron next** — it makes staging's calendar non-empty, which affects a large amount of testing.
3. **2b** — the tables, needing the most reading.
4. **2c's secrets** — after Wael decides shared-versus-separate credentials.

## 9. Not authorized

No migration written, no secret set, no cron created. Phase 3 review, then Phase 4 on Wael's explicit go-ahead.
