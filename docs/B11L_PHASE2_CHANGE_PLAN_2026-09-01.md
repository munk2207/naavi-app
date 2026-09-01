# B11l — Phase 2: Change Plan (v3)

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Version** | **v3** — supersedes v2 on the Phase 3 review, which disproved half of v2's self-resolution source. See "What changed in v3". |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.3, §3 Phase 2 |
| **Architecture Reference** | **2026.07.18.15**, supplemented by Phase 1A findings. No Reference edit during Phases 0–7. |
| **Platform** | **MOBILE ONLY.** Voice withdrawn (Phase 0). |
| **Risk** | **HIGH** — see §5 |
| **Status** | Awaiting Wael's approval. **No code written.** |

---

## What changed in v3

**v2 named the self-resolution source as *"`user_settings.phone` / `.email`"*. The `.email` half does
not exist.** Phase 3's assumption check enumerated every `user_settings` column referenced across the
Edge Functions: `name`, `phone`, `phone_numbers`, `home_address`, `work_address`, `voice_pin_hash`.
**There is no email column.**

**This is a design change, not a Phase 3 clarification, which is why it is corrected here rather than
in Phase 3.** The reviewer's ruling, 2026-09-01: *"We should not allow Phase 3 to silently rewrite an
approved Phase 2 design."* The email path needs a **different call, a different client privilege, and
a different failure mode** — see §1.1.

**Two scope rulings were also given and are recorded here so they are not re-litigated:**

| Question raised in Phase 3 | Ruling, 2026-09-01 |
|---|---|
| §4.5 — the self-reference vocabulary is English-only, against `feedback_global_first` | **Stays English-only for B11l.** Locale-aware recognition is a legitimate separate finding; folding multilingual semantics into a high-risk fix would materially expand scope. **Recorded as a finding, not scope.** |
| §9.4 — does the compound auto-send path belong in B11l? | **Yes, it stays in.** It is another consumer of the same defective `"me"` recipient, and it can send after a consent given when no resolved recipient existed. Leaving it would leave a **more dangerous** version of the same defect running. |

**Nothing else changed. No Architecture Reference edit. No scope expansion.**

---

## What changed in v2

**v1 planned to overwrite `action.to` with the resolved phone/email.** The review rejected that: it
changes the meaning of a field that four consumers already read, and v1's own consumer trace
discovered the problem without acting on it — then deferred four contract questions to Phase 4.

**The reviewer was right, and tracing the consumers made it decisive rather than a judgement call.**
Two facts found while re-tracing:

1. **`DraftCard.handleSend()` never reads `to_phone`.** `app/index.tsx:523-539` reads `action.to`,
   tries to parse it as a number, and **calls `lookupContact(to)` again** if it cannot. The
   `to_phone` field that `naavi-chat:2092` already sets is **dead on this path.**
2. **The card therefore resolves the recipient TWICE** — once at mount for display
   (`app/index.tsx:497`) and once at send (`:534`) — as two independent calls to a
   non-deterministic API. **Nothing guarantees they agree.** The card can display one person and
   send to another.

**All four of v1's deferred questions are answered in §3 of this document. None is left for Phase 4.**

---

## 1. The design decision

**`"me"` is not an invalid recipient — it is a valid one that resolves to the user.** Routing it into
the existing missing-recipient guard (*"Who should I send the message to?"*) would ask the user
something they already answered, and contradicts Phase 0 Success Criterion 1.

**So: resolution, not rejection.**

### The mechanism already exists in the same file

`naavi-chat:3978-3988`, the time-trigger self-default:

```js
const { data: _settingsRow } = await supabase.from('user_settings')
  .select('phone').eq('user_id', userId).maybeSingle();
…
action_config: { ..._ac, to_phone: (_ac).to_phone || _phone },
```

**This is precisely why *"text me in five minutes"* worked on Wael's live call and *"text me"* did
not.** Same file, same user, same column — one path reads it, the other does not.

### Self-reference vocabulary — exact match on the whole value

`me` · `myself` · `my phone` · `my number` · `my cell` · `my email`

Case-insensitive, trimmed, **matched against the entire `to` value, never as a substring** —
substring matching is the mechanism of the bug being fixed. `"my wife"` is not in the list and is not
a prefix test, so it continues to reach `resolveRelationshipToName` unchanged.

**Deliberately excluded:** `my`, `us`, `her` — the other collisions Phase 1 measured. **Evidence, not
scope.** None is a self-reference; none appears in Phase 0's Success Criteria.

### 1.1 — ⭐ The two destinations have two different sources, and only one is a settings column

**Corrected in v3.** They are not symmetric, and treating them as one field was v2's error.

| Destination | Source | Client required | Established pattern |
|---|---|---|---|
| **Phone** (`sms`, `whatsapp`) | `user_settings.phone` | ordinary request client | `naavi-chat:3978` |
| **Email** (`email`) | **`auth.admin.getUserById(userId).user.email`** | **service-role admin client** | `evaluate-rules:787-788`, and again at `:264-265` |

**`phone`, not `phone_numbers`.** `user_settings` holds both. `phone_numbers` is an **array** used to
*identify* a user by any of their numbers (`ingest-ticket:199` matches with `phone_numbers.cs.{…}`;
`manage-voice-pin` uses it for PIN eligibility). `phone` is the single primary number used to *send*.
Sending to an arbitrary element of an identification array would be new behaviour nobody asked for.

**The admin client already exists in this file** — `naavi-chat:3982` constructs one for the
time-trigger insert — so this reuses an in-file pattern rather than introducing a new privilege.

**Call it only when needed.** The email lookup runs **only when `channel === 'email'`**. An SMS draft
must not incur an auth-admin round trip.

### 1.2 — Failure behaviour, stated per destination

The two sources fail differently, and v2 could not have said so because it thought there was one.

| Condition | Behaviour |
|---|---|
| `user_settings.phone` is null or empty | Fall through to the existing `missingParam` path — *"Who should I send the message to?"* |
| `auth.admin.getUserById` **returns no email** | Same — fall through and ask |
| `auth.admin.getUserById` **throws or times out** | **Log with context (AI Coding Discipline #21 — no silent failures), then fall through and ask.** This is a network call to a different service from the phone read, so it can fail on its own while everything else works |
| Anything unexpected in the helper | Catch, log, **return the action untouched** — the turn proceeds with today's behaviour |

**In every failure case the outcome is a question or the status quo. Never a guess, never a fallback
to contact search, never a send.** The email path's extra failure surface therefore cannot produce a
wrong recipient — only an unanswered one.

---

## 2. ⭐ The contract — `to` is not touched

**Decision: `action.to` keeps its existing meaning — the recipient expression as the user said it.
Resolution is carried in separate, additive fields.**

| Field | Meaning | Set by | New? |
|---|---|---|---|
| `to` | **Requested recipient expression — unchanged.** `"me"`, `"Bob"`, `"my wife"` | as today | no |
| `to_phone` / `to_email` | **Resolved destination**, when Shared Core could resolve it. **Two different sources — see §1.1** | `naavi-chat` (self case) | no — `to_phone` already exists at `:2092`, currently unused on this path |
| `to_display` | **Display identity** — `"you"` for self; otherwise the matched contact's full name | `naavi-chat` (self); `DraftCard` at mount (contact match) | **yes** |

**Three distinct concepts, three fields: requested recipient → resolved destination → display
identity.** v1 collapsed the first two into one and left the third undecided.

**Why this is lower-risk, concretely.** Every existing consumer reads `to`. If a consumer is never
updated, it behaves **exactly as it does today** — correct for ordinary contacts, still wrong for
self. Failure is *unchanged behaviour*, not *new behaviour*. Overwriting `to` inverts that: an
unexamined consumer silently starts receiving a phone number where it expected a name, and nothing
announces it.

**The cost, stated honestly: additive fields do nothing until consumers prefer them.** Three
consumers resolve from `to` and must learn to check the resolved field first. That is three
deliberate, reviewable edits instead of one invisible semantic change — and it is why §3 exists.

---

## 3. The four questions v1 deferred — answered here

### 3.1 — Compound auto-send (`hooks/useOrchestrator.ts:3225-3251`)

**Must change.** It sends **without showing a card at all** (`:3230-3250`), calling
`lookupContact(to)` at `:3235` and sending to whatever comes back. With `to` = `"me"` it reaches the
stranger with **no confirmation surface whatsoever** — worse than the reported defect, which at least
rendered a card Wael could read.

**Change:** prefer `action.to_phone` when present; fall back to today's lookup when absent.

### 3.2 — Email queue step (`hooks/useOrchestrator.ts:743-762`)

**Must change.** `:748` — `if (!resolvedEmail) { const c = await lookupContact(to); … }`. Same shape,
email channel. **Change:** prefer `action.to_email` when present.

### 3.3 — Spoken summary (`lib/voice-confirm.ts:90-91`)

**Must change, minimally.** `buildActionSummary` reads `action.to`. Since `to` is unchanged it would
still say *"…to me"* — not wrong, but `to_display` gives *"…to you"*, and for a contact match it gives
the real name instead of the typed word. **Change:** prefer `to_display` when present.

### 3.4 — Which field carries the display name

**`to_display`.** Additive; no existing consumer reads it; absent for every action that does not set
it.

### 3.5 — ⭐ And one the review implies but v1 never asked: send must use what was displayed

**`DraftCard` currently displays a resolution made at mount and then makes a second, independent one
at send.** Two calls to a non-deterministic API, nothing binding them together.

**Phase 0 Success Criterion 2 — *"the card names the matched contact truthfully"* — cannot be
satisfied while this is true.** A card that names X and sends to Y does not name the recipient; it
names a guess. **Change: `handleSend()` uses the resolution the card already displayed.**

This is in scope because SC2 requires it, not because it is nearby.

---

## 4. Files that will change

| # | File | Classification | Change |
|---|---|---|---|
| 1 | `supabase/functions/naavi-chat/index.ts` | **Backend / Shared Logic** | `resolveSelfRecipient()`; called at **both** `DRAFT_MESSAGE` construction sites; sets `to_phone`/`to_email` + `to_display`; updates the B9x comment at `:3480-3484` |
| 2 | `app/index.tsx` | **UI** | Display `to_display` → matched contact name → `to`. `handleSend()` prefers `to_phone`/`to_email`, then the mount-time resolution (§3.5) |
| 3 | `hooks/useOrchestrator.ts` | **Shared Logic** | Two call sites (§3.1, §3.2) prefer the resolved fields |
| 4 | `lib/voice-confirm.ts` | **Shared Logic** | Spoken summary prefers `to_display` (§3.3) |
| 5 | `lib/naavi-client.ts` | **Shared Logic** | `NaaviAction` gains `to_display` (type only) |
| 6 | `tests/catalogue/b11l-self-recipient.ts` | **Tests** (new) | Rule 15a |
| 7 | `tests/runner.ts` | **Tests** | Register the suite |

**Unchanged:** `_shared/anthropic_tools.ts` · `get-naavi-prompt` · `lookup-contact` · any migration ·
any cron · `naavi-voice-server`.

### 4.1 — Both construction sites change

| Site | Location | Change |
|---|---|---|
| **A — Layer 2** | `:2067-2093` | `resolveSelfRecipient()` before the action literal returns |
| **B — Path B mapper** | `:3925-3958` | same helper, same pass |

**One helper, two call sites** — the `resolveLocationRecipient()` pattern. **A test asserts both are
covered**, because Architecture Reference §2e records B9x fixing one site while eleven passing tests
guarded the other.

### 4.2 — The B9x decision, confronted

`naavi-chat:3480-3484` says `DRAFT_MESSAGE` *"has its own recipient handling and must not acquire a
second one."*

**This plan adds no second recipient handling.** `resolveSelfRecipient()` performs **no contact
lookup** — no `lookup-contact`, no People API, no `resolve-recipient`. It rewrites one self-reference
token into the user's own stored details before the existing handling runs, and **for every
non-self recipient it does nothing at all.** The card's contact resolution remains the only recipient
resolver on this path.

**What that comment protects against is a second competing resolver that could disagree with the
first. v2 does the opposite — §3.5 removes an existing disagreement** by binding send to the
resolution already displayed.

The comment's literal wording becomes inaccurate and is updated in the same change. **If the reviewer
still reads this as a second handling, that is a Phase 3 rejection and the design returns here.**

---

## 5. Risk classification — **HIGH**

- **Protected Core, two areas:** Action Rules (recipient resolution) and Notification routing.
- **Every mobile draft passes through both changed Shared Core sites.** A regression could misroute
  any draft, not only self ones.
- **§3.1 is the sharpest edge:** a path that sends with no card at all.
- **Mitigating, and this is what the contract buys:** `to` is untouched, so an unexamined consumer
  keeps today's behaviour rather than acquiring new behaviour. The self path is gated by an
  exact-match whitelist that cannot fire on a real contact name. Every other recipient follows the
  existing code exactly.

---

## 6. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **YES** | `app/index.tsx`, `hooks/useOrchestrator.ts`, `lib/voice-confirm.ts`, `lib/naavi-client.ts` |
| **Voice** | **NO** | Out of scope (Phase 0) **and structurally unreachable** — voice never calls `naavi-chat` (Architecture Reference §2a), has its own `executeDraft` (`src/index.js:13949`) and its own tool copy (`src/anthropic_tools.js:402`). No changed file is read by voice. |
| **Shared Core** | **YES** | `naavi-chat/index.ts` — one helper, two call sites, one comment |
| **Database** | **NO** | `user_settings.phone` is **read**; the email path additionally **reads** the account email via `auth.admin.getUserById` (§1.1), which is the auth service rather than a table. **No migration, no schema change, no RLS change, no write of any kind.** |
| **Cron** | **NO** | None added, removed, or rescheduled |
| **API contracts** | **YES — additive only** | `to_display` added; `to_phone`/`to_email` populated on a path where they were previously empty. **`to` is unchanged.** No consumer's existing expectation is altered |
| **Tests** | **YES** | New suite + registration |

---

## 7. Regression Matrix — consumer trace

Produced by search, 2026-09-01: `grep -rn "DRAFT_MESSAGE"` and `grep -rn "to_phone"` across
`app/ hooks/ lib/ supabase/ tests/`, excluding `node_modules` and `.claude/worktrees`.

| Consumer | Reads | Effect |
|---|---|---|
| `app/index.tsx:450-515` display | `action.to` | **Changed** — prefers `to_display` |
| `app/index.tsx:517-571` `handleSend` | `action.to`, re-resolves at `:534` | **Changed** — §3.5 |
| `hooks/useOrchestrator.ts:3225-3251` compound auto-send | `action.to` → `lookupContact` | **Changed** — §3.1 |
| `hooks/useOrchestrator.ts:743-762` email queue | `action.to` → `lookupContact` | **Changed** — §3.2 |
| `lib/voice-confirm.ts:90-91` | `action.to` | **Changed** — §3.3 |
| `hooks/useOrchestrator.ts:3252` `turnDrafts.push` | whole action | **None** — pass-through |
| `lib/naavi-client.ts` | type | Type addition only |
| `naavi-chat/intentHandlers.ts` | type reference | **None expected** — verify at Phase 4 |
| `_shared/relationship_words.ts`, `resolve-recipient`, `send-sms` | comments / routing | **None** — not called by the self path |
| `app/alerts.tsx:166-315` | `to_phone` on **`action_rules`**, not on draft actions | **None** — different data shape, different table |
| 6 × `tests/catalogue/*` (`email`, `session-2026-06-13`, `session-2026-07-06-f12-high-risk-wiring`, `session-2026-08-13-draft-message-channel`, `session-2026-08-13-relationship-contact-resolution`, `session-2026-08-27-b9x-location-recipient`) | draft behaviour | **All six must stay green.** The relationship suite is the direct guard that `"my wife"` still resolves normally |
| `naavi-voice-server/*` | own copies | **Unaffected** |
| `src/orchestration/*` | own `DRAFT_MESSAGE` types | **Not imported by app code** — only a comment reference at `lib/naavi-client.ts:217`. **Reported, not touched** (No Extra Changes Rule) |

### Fixed regression checklist

| Area | Affected? |
|---|---|
| Voice commands | **NO** |
| Geofencing | **NO** |
| Gmail integration | **NO** |
| Calendar integration | **NO** |
| Reminders | **NO** — the time-alert self-default at `:3978` is **read as a pattern, not modified** |
| SMS / call alerts | **NO for alerts.** Draft sends change only where `to` is a self-reference token |
| Onboarding | **NO** |
| Staging build | **YES** — a staging APK is required |

---

## 8. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **Overwrite `action.to` with the resolved address** (v1's plan) | Changes the meaning of a field four consumers read. An unexamined consumer silently receives a number where it expected a name. Rejected on Phase 2 review; see "What changed in v2" |
| **Prompt rule in `get-naavi-prompt`** | Non-deterministic — ≥3 trials per case, and still fails on the trial Claude ignores it. Phase 0 warned against fixing this by keyword |
| **Change the `draft_message` tool schema** | The schema is **duplicated** — `_shared/anthropic_tools.ts:448` and voice `src/anthropic_tools.js:402` — and the two already differ (`subject` required in one, not the other). Changing it means touching voice, which Phase 0 withdrew |
| **Minimum-length guard in `lookup-contact`** | Wrong layer, wrong diagnosis. `"me"` is not a bad query, it is the user. Would break short real names and alter a function every caller depends on |
| **Route `"me"` into the missing-recipient guard** | Asks what the user already answered. Contradicts Success Criterion 1 |
| **Fix only the card** | Still sends to a stranger if tapped. Fails Success Criterion 1 |

---

## 9. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Modifies Shared Core? | **YES** — `naavi-chat/index.ts` |
| Modifies an Entry Point? | **YES** — mobile display and send preference. **No business logic is added to the entry point**; resolution moves *toward* Shared Core, and §3.5 *removes* a resolution decision the client was making on its own |
| Introduces new duplication? | **NO** — one helper, two existing sites, mirroring `resolveLocationRecipient()` |
| Eliminates existing duplication? | **PARTIALLY — and this is new in v2.** §3.5 removes the card's second, independent resolution, so display and send stop being two competing resolvers. The two `naavi-chat` construction sites remain two; merging them is outside B11l |
| Modifies Protected Core? | **YES** — Action Rules and Notification routing |

---

## 10. Deployment

Staging only — Supabase `xugvnfudofuskxoknhve`, plus a staging APK. **No production deploy, no AAB**
(Phase 0, and CLAUDE.md staging-first).

**Carried forward because it will otherwise be forgotten:** staging's contact list contains no name
matching `"me"`, so **staging cannot demonstrate the original defect.** A green staging run proves
the fix broke nothing — **not that it works.** Phase 7 must verify against a contact list carrying a
deliberate collision.
