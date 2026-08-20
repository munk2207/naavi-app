# T4 — Phase 5 Evidence Package (all passes)

**Work item:** T4 — staging/production functional parity
**Date:** 2026-08-20
**Environment changed:** Supabase staging (`xugvnfudofuskxoknhve`) only. Production was read from, never written to.

Covers Passes 1, 2a, 2b, 2c, 3 and 4, the drift check, and the `search_path` fix.
Supersedes `T4_PHASE_5_EVIDENCE_PASS1_2026-08-20.md`, which covered Pass 1 alone.

One package rather than six. The passes share one measurement, one verification
method and one rollback story; splitting them would repeat the same context five
times and make the whole harder to audit than any part.

---

## 1. Summary

**Target, in Wael's words:** *"production and staging as 100% replica (FUNCTION)"* — equal in
capability, not in data.

**Result: 184 differences → 97.** The remaining 97 are recorded as accepted in
`docs/T4_accepted_differences.json`, and they break down very differently from the raw number:

| | Count | What it means |
|---|---|---|
| Staging-only | 45 | Work not yet promoted to production. **Not a defect** — the promotion list |
| Defined differently | ~40 | Includes 12 T5 columns, and ~20 entries that are known-false pending a production re-capture (see §6) |
| Missing from staging | 12 | Mostly policies staging already has under different names |

**Genuine functional gaps closed:**

- Four code paths that failed silently on staging because the table did not exist:
  `pending_disambig` (naavi-chat's disambiguation), `people` (contacts, keyterms, memory),
  `conversations` (history), `waitlist_signups` (website signups)
- Staging rejected the `calendar` document type that CLAUDE.md documents as valid, and every
  ticket raised from the website
- Staging granted write access to `calendar_events` and `gmail_messages` where production
  grants read only *(subsequently restored on Wael's instruction — see §7)*
- Users could not delete their own token on staging; support tickets could not be read or worked
- Three unique indexes absent, so staging could accept duplicates production would refuse
- `sync-calendar-every-6h` missing, which is why `calendar_events` was never populated
- Six Edge Function secrets absent: OCR, inbound email, push
- `search_knowledge_fragments` had no `search_path` pinning

---

## 2. Files changed

**Migrations applied to staging (9):**

```
20260820000000_t4_pass1_definition_parity.sql
20260820000001_t4_pass2a_missing_columns.sql
20260820130000_t4_align_check_constraints_with_production.sql
20260820150000_t4_pass2b_four_missing_tables.sql
20260820160000_t4_pass3_indexes_and_constraints.sql
20260820170000_t4_pass3_knowledge_checks_not_valid.sql
20260820180000_t4_pass4_access_policies.sql
20260820190000_t4_restore_staging_manage_policies.sql
20260820200000_t4_knowledge_search_search_path.sql
```

**Tooling:**

```
scripts/t4-drift-check.js            new — the parity gate
docs/T4_SCHEMA_FINGERPRINT.sql       amended three times (§6)
docs/T4_accepted_differences.json    new — the accepted baseline
package.json                         drift:check script, pg pinned as a devDependency
```

**Not migrations — applied directly to staging, deliberately:**

- Two cron jobs (`cleanup-old-emails`, `sync-calendar-every-6h`). A migration carrying staging's
  address is the trap defused the night before, which would have pointed production at staging
  every five minutes. A "STAGING ONLY" comment does not stop `db push` reading the file.
- Six Edge Function secrets, entered by Wael through the Supabase dashboard so no value passed
  through a transcript or a command line.

---

## 3. Git diff

Commits, all on `main`:

```
ee52dcf  two constraints where staging rejected what production accepts
8f9a9fa  a drift check that fails when staging and production separate
3d371a7  Pass 2c: push gets a per-environment identity
4c151de  Pass 2c: the last two cron jobs, on staging
53e0e13  Pass 2b: four tables staging never had, and four code paths that failed
172257f  Pass 3: the quiet ones — unique indexes and a value check
ad80eed  Pass 3: the three value rules, added NOT VALID
d7cb1ea  Pass 4: access policies, compared by effect rather than by name
254860b  Restore the two staging policies Pass 4 removed
0ed48b8  Step 1: two of the three unknown functions were formatting
187d9ae  Step 1b: all seven cron differences are artifacts, not drift
1b5025a  the one real function gap, and what fixing it uncovered
```

---

## 4. Tests executed

**The drift check is the primary evidence, and it was verified in both directions** — a gate
that has only ever passed has not been tested:

- Passes clean at the recorded baseline
- Removing two entries from the baseline produces exit 1, naming both, in the correct categories
- After each pass, it reported exactly the expected entries as closed **and no new drift**. That
  second half is the real proof: a wrong type, default, or policy expression would surface as
  "defined differently" rather than silently matching

**Per-pass live verification against staging, after applying:**

| Pass | Verified by |
|---|---|
| 2b | 49 differences closed, no new drift |
| 2c | Secret fingerprints compared against production — Vision and Postmark match exactly |
| 3 | 10 closed, no new drift. Pre-flight data check ran first (§8) |
| 3 (NOT VALID) | 36 memories still present; a new row with `source='conversation'` refused |
| 4 | 7 closed; policies re-read from `pg_policies` after applying |
| search_path | Setting present; 12 columns unchanged; live call returns 5 rows |

**Voice server (B11f, same session):** 119/119 automated, plus the `no-undef` pre-push gate,
verified in both directions.

---

## 5. Manual tests required

Phase 7 states plainly that passing automated tests alone is not sufficient, and lists voice,
notifications and end-to-end integrations as requiring manual validation.

**Done, by Wael:**

- **Pause and resume on a live staging call** — confirmed working. This is the only user-facing
  behaviour changed in this session and it was validated by a person on a phone, not by a test.

**Outstanding — not yet validated by a person:**

| What | Why it needs a human |
|---|---|
| **Push notifications on staging** | Requires a new staging APK. The new key only takes effect in a build; the current APK still carries production's |
| **OCR / document extraction on staging** | Vision key now present, never exercised |
| **Inbound email on staging** | Postmark token now present, never exercised |
| **Calendar sync on staging** | `sync-calendar-every-6h` now runs; `calendar_events` should populate within six hours. Nobody has looked |
| **Knowledge search on staging** | Verified by direct SQL call, not through the app |
| **The four restored code paths** | Contacts, conversation history, disambiguation and website signup all have their tables now; none exercised through the product |

**⚠️ One behaviour change to watch for:** the three `NOT VALID` constraints mean anything writing
`source='conversation'` is now refused on staging, exactly as production would refuse it. If that
path is live, memories that used to save will stop saving. That is intended — it makes a failure
production would have had visible where someone can see it — but it will look like a bug if it
appears without this context.

---

## 6. The fingerprint was amended three times, mid-work

Recorded because the amendments are themselves findings, and because a measurement instrument
changed during the measurement:

1. **Function bodies were hashed raw.** One extra space produced a completely different hash, and
   a hash cannot be un-normalised afterwards. Two identical functions — including the geofence
   dwell logic — sat in the differences list all day looking like unresolved risk. Now hashes the
   normalised body.
2. **Cron commands were truncated at 400 characters before redaction.** Production's key is a
   long `eyJ…` JWT and staging's is the short `sb_secret_` format, so production's command was cut
   mid-key and lost its tail; the two were then compared against different amounts of text. Four
   jobs reported as drift for having the correct key in the correct environment. Now redacts
   first, truncates second.
3. **Extensions recorded name and version but not schema.** pgvector is in `extensions` on
   staging and reachable from `public` on production — a difference invisible to every comparison
   run, which surfaced only when a migration failed (§8). Now records the schema.

**Consequence, known and temporary:** production's snapshot on disk predates all three
amendments, so ~20 entries currently report as differing purely because the two sides are
measured differently. They are recorded as accepted and will resolve at the next production
capture. **This is the single largest source of noise in the remaining 97.**

---

## 7. Rollback

**Per migration:** each is idempotent and additive. Reverting means dropping what was added —
which is now forbidden under Wael's standing instruction, so rollback in practice means "leave
it and record the difference", not "undo it".

**The one thing already rolled back:** Pass 4 removed staging's "manage own" policies on
`calendar_events` and `gmail_messages`. Both were restored in `20260820190000` on Wael's
instruction. Nothing was dropped to restore them — the read-only policies added in Pass 4 remain
alongside, since permissive policies OR together.

**The drift check:** `npm run drift:check -- --write-baseline` re-records the current state.
There is no destructive path in the tool; every statement in the fingerprint is a `SELECT`.

**Secrets:** the Firebase key generated for staging replaced one that was exposed in a chat
transcript and revoked in Google Cloud. Production's Firebase key was never touched.

---

## 8. Known risks

1. **~20 of the remaining 97 differences are measurement artifacts, not drift.** Until production
   is recaptured, the number overstates the gap. Anyone reading "97" without §6 will over-read it.
2. **The drift check is not enforced by anything.** It is a command someone must remember to run.
   That is a warning, not a gate — the precise pattern this session was spent undoing. It is
   Wael's open decision where it binds.
3. **No automated test covers the B11f fast-path fix** (voice server). Flagged under Rule 15a and
   not yet ruled on.
4. **`app.settings.service_role_key` does not exist on staging**, and seven staging crons hardcode
   the key inline. Production reads it from that setting. Hygiene, not function — deliberately
   deferred because the failure mode lands on alerts, reminders and the morning call, on the
   environment Wael actively tests.
5. **Production's Epic policies allow any authenticated user to read every user's rows.** Staging
   is correct. Not fixed: Epic was trialled and postponed, its Edge Functions are empty folders,
   and the client gates those reads behind a per-user check, so it was never reachable. Recorded
   for whenever Epic is picked up.
6. **A pre-flight data check is now mandatory before adding any constraint.** Pass 3 found four
   would have failed. Two of those four were themselves false alarms — `documents` looked blocked
   by seven duplicate groups but all rows have a NULL `gmail_message_id`, and Postgres treats
   NULLs as distinct. **Grouping and uniqueness disagree about NULL, and only one of them is the
   rule the database enforces.**

---

## 9. What this package does NOT authorise

Nothing in T4 authorises a production change. Every promotion on the list — S1, the phone-number
uniqueness guard, the targeted email sync, the Epic integrity constraints, T5, the foreign keys,
the `is_unread` default — is a separate decision requiring Wael's explicit go-ahead, one at a
time.
