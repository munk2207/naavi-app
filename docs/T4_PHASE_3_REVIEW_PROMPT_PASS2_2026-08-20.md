# Phase 3 Review Prompt — T4 Pass 2 — The Missing Objects

Paste everything below the line into ChatGPT. No attachments needed.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 3 — Technical Review (Before Coding)** under Release Gate Workflow v4.0. **Nothing has been written or applied.**

You approved Pass 1 through Phase 6; it is closing. **Pass 2 is the one that restores capability** — Pass 1 only made staging reject what production rejects.

## 1. Your two Phase 2 mandatory changes — both already acted on

**1. "Do not classify all 12 secrets as missing capability until usage is verified."**

**Done, by grepping the deployed code. You were right, and the margin is large:**

| Verdict | Secrets |
|---|---|
| **Genuinely used — replicate (6)** | `FIREBASE_SERVICE_ACCOUNT_JSON`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `GOOGLE_VISION_API_KEY`, `POSTMARK_SERVER_TOKEN` |
| **Not needed (1)** | `NAAVI_ANON_KEY` — read as `NAAVI_ANON_KEY ?? SUPABASE_ANON_KEY`; staging has the fallback |
| **Referenced by nothing — debris (5)** | `GOOGLE_CLOUD_STT_KEY`, `POSTMARK_INBOUND_ADDRESS`, `TWILIO_WHATSAPP_TEMPLATE_REMINDER_SID`, `TWILIO_WHATSAPP_TEMPLATE_TASK_SID`, `distance Matrix API` |

**Only 6 of 12 are real.** Copying all twelve would have moved five obsolete secrets into staging and called it parity.

**It also caught a false claim of mine.** Phase 1 listed *"WhatsApp reminders / tasks"* among features that cannot work on staging. **Wrong** — the only WhatsApp template secret any code reads is `TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID`, which staging already has. I inferred a broken feature from a missing secret without checking whether anything read it. Corrected in the Phase 1 document.

**And one alarm I nearly sent you on no evidence:** I had written `NAAVI_ANON_KEY` into the plan as possibly degrading alert firing on staging. One grep showed the fallback. Recorded because the near-miss is the point — a finding about the alert system would have consumed review attention for nothing.

**2. "Separate staging credentials should be the default, not an open preference."**

**Adopted as stated.** Staging gets its own credentials wherever the vendor supports it; sharing production's requires an explicit exception with justification. **Equivalent capability and equivalent secret names, not identical values.** Awaiting Wael's decision per vendor — it is a cost and safety call, not a technical one.

## 2. The scope

| | Contents |
|---|---|
| **2a** | **10 columns** on tables staging already has |
| **2b** | **4 tables** — `people`, `conversations`, `pending_disambig`, `waitlist_signups` — with their indexes, constraints and RLS |
| **2c** | **6 secrets** and **2 cron jobs** |

*(Phase 1 reported 36 missing columns. Filtered to tables staging actually has, it is 10 — the other 26 arrive with the four tables. Corrected before implementation rather than during.)*

## 3. Pass 2a — the 10 columns

All `ADD COLUMN IF NOT EXISTS`, all nullable or defaulted, all taken from production's catalogue:

| Table | Column | Restores |
|---|---|---|
| `user_settings` | `first_call_completed_at` | **B11c** — without it staging replays a 30-second uninterruptible onboarding **on every call**. This blocked B11f testing |
| `user_settings` | `voice_keyterms` | Deepgram name boosting — staging transcribes names worse than production |
| `user_settings` | `morning_call_status` / `_attempts` / `_last_attempt` | Morning call |
| `documents` | `extracted_text`, `ocr_sidecar_drive_file_id` | OCR output |
| `reminders` | `source` | Provenance |
| `user_tokens` / `calendar_events` | `created_at` | Row age |

## 4. Pass 2b — the four tables

| Table | Cols | Idx | Constraints | RLS policies |
|---|---|---|---|---|
| `people` | 9 | 1 | 2 | **4** |
| `conversations` | 5 | 2 | 2 | 1 |
| `pending_disambig` | 5 | 1 | 1 | **0** — RLS on, service-role only |
| `waitlist_signups` | 7 | 3 | 2 | **0** — RLS on, service-role only |

**You asked that the `people` and `conversations` policies be verified individually against intended access before implementation. Agreed — that is Phase 4's first task, and this prompt does not claim it is done.**

**The two zero-policy tables are the subtle case.** RLS enabled with no policy denies everything to non-service-role clients. In production that reads as a deliberate server-only pattern. Reproducing the *definition* is easy; reproducing the *intent* is the actual requirement, and getting it wrong in the permissive direction would leak, while getting it wrong in the restrictive direction would silently return empty results rather than an error.

## 5. Pass 2c — 6 secrets, 2 crons

**Crons:**

| Cron | Effect of absence on staging |
|---|---|
| `sync-calendar-every-6h` | **`calendar_events` is never populated** — every calendar test runs against an empty table |
| `cleanup-old-emails` | Gmail rows accumulate. Housekeeping only |

**You required more than URL verification** — schedule, target function, staging URL, authentication mechanism and expected behaviour, all checked against production. **Accepted.** The reason is on record: earlier today a migration was found that would have scheduled **production** to call **staging** every five minutes with an unfilled key placeholder. It carried a comment saying "STAGING ONLY", which `db push` does not read. It has since been made to refuse rather than warn.

## 6. What to evaluate

- **Is the 6/1/5 secret classification right?** It rests on grep across `supabase/functions`, `naavi-voice-server/src`, `app`, `hooks`, `lib`. **What would that miss** — a secret referenced by name construction, by a dashboard-configured webhook, or by something not in the repository?
- **Is deleting the 5 debris secrets from production safe**, or should they simply be left alone? Deleting is tidier; leaving them costs nothing and risks nothing.
- **2b's zero-policy tables** — is reproducing "RLS on, no policy" correct, or should staging get an explicit service-role policy that states the intent rather than implying it?
- **Ordering** — 2a first is proposed because `first_call_completed_at` unblocks B11f, which is built and untestable. Is letting a *different work item's* testing drive the order of this one legitimate, or should the technically safest order win?
- **`pg_net` version differs** (production 0.20.0, staging 0.20.3). Out of scope for Pass 2 as proposed. Should it be?
- **The 5 debris secrets and the 5 dead staging-only Edge Functions** are both "exists but nothing uses it". Should Pass 2 handle debris at all, or should that be its own pass?

## 7. Required output

A decision per §13: **Approved / Approved with Mandatory Changes / Rejected**.

Close with **Implementation Boundaries Confirmed** — the specific files and the specific change in each, so Phase 4 has a boundary to implement against and Phase 6 has one to audit against. Note that 2c touches **no file at all** — secrets and crons are configuration — so its boundary needs expressing differently from a migration's.
