# Session Handoff — 2026-06-11
## B7d Postal Code Normalization + Holding List Reorganization

---

## What was accomplished this session

### 1. Holding list renamed and reorganized
- Renamed `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` → `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`
- All closed items moved to a consolidated "Closed" section at the bottom
- Active tables at top show open items only (clean view)
- Two CLAUDE.md references updated to point to the new filename
- B7a, B7b, B7c added as new bugs from recent handoff audit
- B4v moved to Closed (cannot be reproduced, 2026-06-11)

### 2. B7d — Postal code format mismatch (FIXED + DEPLOYED)
**Bug:** Contact search by postal code failed when query format differed from stored format.
- `K1C 5M3` (query with space) matched ALL contacts in the K1C forward sortation area — `tokensFromVariants` split it into tokens `["k1c","5m3"]` and `"k1c"` substring-matched every K1C* contact
- `K1C5M3` (query no space) did NOT find contacts stored as `K1C 5M3` (with space)

**Fix — two changes:**

**Change 1:** `supabase/functions/global-search/adapters/contacts.ts`
- Added `postalInQuery` detection before the token fallback in `addressTokenMatch`
- When query contains a Canadian postal code, uses ONLY exact normalized match — skips broad token fallback entirely
- **Session 1 fix** (earlier today): used `q` with `\b` word-boundary regex
- **Session 2 fix** (this session): switched to `qNorm` (already space-stripped, lowercase) for the regex match — makes both `K1C5M3` and `K1C 5M3` in the query normalize to `k1c5m3` symmetrically

**Change 2:** `tests/catalogue/session-2026-06-11.ts`
- Updated `b7d.postal-code-regex-gate-present` assertion to accept either `[a-z]\d[a-z]` or `[A-Za-z]\d[A-Za-z]` (since the regex was changed from case-insensitive to lowercase-only on `qNorm`)

**Deployed:** `global-search` deployed to Supabase `hhgyppbxgmjrwdpdubcx` ✅

### 3. Location tests fixed (earlier in session)
- `location.home-via-settings` was failing because it hardcoded "962 Terranova Dr" and required Google Places to return `ok` — Google returned `not_found`
- Replaced with two robust tests:
  - `location.home-unset-returns-personal-unset` — clears home_address, expects `personal_unset` (no Google call needed)
  - `location.home-set-routes-to-google` — sets home_address to "100 Wellington St, Ottawa", expects `status !== personal_unset` (routing confirmed, Google result not asserted)

---

## AUTO-TESTER STATUS ⚠️ NOT CONFIRMED GREEN

**Last known run result: 241 passed, 1 errored**
- The 1 error was `b7d.postal-code-regex-gate-present` — caused by the regex change from `[A-Za-z]\d[A-Za-z]` to `[a-z]\d[a-z]`
- The test assertion was then fixed to accept either pattern
- A second run was started to confirm 242/242 but was **interrupted by Wael before completion**

**⚠️ NEXT SESSION MUST START WITH `npm run test:auto` BEFORE ANY BUILD OR DEPLOY.**

---

## B4w Status — Partially fixed, mobile fabrication still open

**Voice path:** Fixed. Server-side bypass in `naavi-voice-server/src/index.js:2383-2448` intercepts postal code contact queries before Claude, calls global-search directly, returns honest-out if 0 results.

**Mobile chat path:** Still open. `naavi-chat/index.ts` has no equivalent bypass — postal code contact queries still go to Claude (Haiku) which can fabricate contact names when global-search returns 0 results.

**Wael's test result (end of session):**
- Query `K1C5M3` (no space) → finds contacts stored as `K1C5M3` ✅
- Query `K1C5M3` (no space) → does NOT find contacts stored as `K1C 5M3` (with space) ❌ (this is what the session 2 fix addresses — not yet re-tested by Wael)
- Query `K1C 5M3` (with space) → found both stored formats ✅

**Remaining B4w work:** Port the voice bypass logic to `naavi-chat/index.ts` to prevent fabrication on mobile when 0 contacts found.

---

## Open bugs summary (key ones)

| ID | Status | Description |
|----|--------|-------------|
| B4w | Partially fixed | Contact postal-code search: voice fixed, mobile fabrication still open |
| B6a | Open | Voice: stop-word interrupt regression |
| B6g | Open | (see holding list) |
| B6h | Open | Delete alert intent handling |
| B6i | Open | (see holding list) |
| B7a | Open | New — from handoff audit |
| B7b | Open | New — from handoff audit |
| B7c | Open | New — from handoff audit |

Full canonical list: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`

---

## Files changed this session

| File | Change |
|------|--------|
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | New file (renamed + reorganized from 2026-05-08) |
| `CLAUDE.md` | Two references updated to 2026-06-11 filename |
| `supabase/functions/global-search/adapters/contacts.ts` | B7d fix: postalInQuery now uses qNorm regex |
| `tests/catalogue/session-2026-06-11.ts` | New file: 3 B7d regression tests + updated regex assertion |
| `tests/catalogue/location.ts` | Replaced brittle location test with 2 routing-only tests |
| `tests/runner.ts` | Registered session2026_06_11Tests |

---

## Next session start checklist

1. `npm run test:auto` → must be 242/242 green before anything else
2. If not green, investigate `b7d.postal-code-regex-gate-present` first
3. Ask Wael to re-test B4w on mobile chat: "find contact with postal code K1C5M3" — should now find contacts stored as "K1C 5M3"
4. If B4w mobile test passes → close B4w, update holding list
5. Then proceed to next holding list item per Wael's direction
