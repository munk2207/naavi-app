# Session Handoff — 2026-06-11 (afternoon)
## B4w Postal Code Normalization — Investigation in Progress

---

## What was accomplished this session

### Fix deployed
`postalInQuery` was moved outside the per-contact loop so it is computed once per search. The core logic: strip spaces + lowercase the raw query, then regex-match a Canadian postal code pattern. If found, the contact address match uses EXACT normalized comparison (`postalNorm === postalInQuery || addrNorm.includes(postalInQuery)`) instead of broad token fallback.

### What the diagnostic confirmed
- `postalInQuery=k1c5m3` — the fix IS detecting the postal code correctly for the no-space query ✓
- For WITH-SPACE "k1c 5m3" → 3 contacts found (Fatma + Wael + Gordon) ✓
- For NO-SPACE "K1C5M3" → only 2 contacts found (Fatma + Gordon) — Wael missing ✗

### Root cause NOT yet found
The `postalInQuery` value is identical (`k1c5m3`) for both cases. The address match logic is identical. Yet Wael's contact appears for with-space and disappears for no-space. The difference between the two cases at the code level is only the `tokens` set:
- With-space: tokens = `{"postal", "code", "k1c", "5m3"}` (4 tokens)
- No-space: tokens = `{"postal", "code", "k1c5m3"}` (3 tokens)

Since `postalInQuery` is set, the `if (postalInQuery)` branch short-circuits and tokens are NOT used in `addressTokenMatch`. So the token difference should NOT matter — but empirically it does.

**Unexplained:** why does Wael's contact match for with-space but not no-space, given postalInQuery is the same for both?

---

## ⚠️ CURRENT STATE OF DEPLOYED CODE — ACTION REQUIRED FIRST

The `global-search` Edge Function currently has **DIAGNOSTIC CODE** deployed that injects a fake `[DIAG]` contact result at the top of every contacts search. **This must be removed before any user-facing testing or shipping.**

File: `supabase/functions/global-search/adapters/contacts.ts`

Remove this block (lines ~723-732, before `return hits.slice(0, ctx.limit)`):
```javascript
// TEMP DIAG
hits.unshift({
  source: 'contacts',
  title: `[DIAG] limit=${ctx.limit} found: ${hits.map(h => (h.title ?? '').slice(0,8)).join('|')}`,
  snippet: `postalInQuery=${postalInQuery}`,
  score: 99,
  url: undefined,
  metadata: { resource_name: null, name: null, emails: [], phones: [], is_community: false, addresses: [] },
});
```

Also remove the `[contacts-diag]` console.log inside `addressTokenMatch` (line ~646):
```javascript
console.log(`[contacts-diag] addr check: postalNorm="${postalNorm}" addrNorm="${addrNorm.slice(0,40)}" match=${match}`);
```

Deploy after cleaning: `npx supabase functions deploy global-search --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`

---

## Next session investigation plan

### Hypothesis to test
The `nameTokenMatch` for no-space may be firing TRUE for Wael, giving him score=1.0, which then OVERRIDES the address match and returns him — but something downstream filters him out. OR: the Community Phase 1 check is somehow matching Wael for the no-space case and returning early with a result set that excludes the address match.

### Specific thing to verify
Add a per-contact log when Wael's contact is processed:
```javascript
if (displayName.toLowerCase().includes('wael') || displayName.toLowerCase().includes('aggan')) {
  console.log(`[wael-diag] name="${displayName}" nameTokenMatch=${nameTokenMatch} addressTokenMatch=${addressTokenMatch} isCommunity=${isCommunity} score=${score} addresses.length=${addresses.length}`);
}
```

Place this right before `if (score === 0) continue;` in Phase 2.

Then check Supabase logs (use the dashboard: https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/functions).

### Alternative hypothesis (Wael's theory)
Wael suggested: "If you ask without space, there is no space to trigger the normalization, then the result of normalization is null."

This could mean: the `postalInQuery` detection only fires when the user types with a space (i.e., the normalization was designed as a SPACE-TRIGGERED path). Without a space in the original query, something causes postalInQuery to remain null even though `qn` strips spaces.

To test: what if `q` (the raw query) does NOT contain the postal code at all for the no-space case — i.e., Claude strips "K1C5M3" before passing the query to global-search? Check what `ctx.query` actually is for no-space by logging `q` in the next diagnostic.

---

## Files currently modified (vs last clean commit)

| File | Change |
|------|--------|
| `supabase/functions/global-search/adapters/contacts.ts` | postalInQuery moved outside loop; DIAG code still present — MUST CLEAN |

---

## Auto-tester status
**NOT run this session.** Must run `npm run test:auto` before any build. Last known state: 241/242 passing (B7d regex assertion was the 1 failure — was fixed last session but not re-confirmed).

---

## Next session start checklist
1. Remove DIAG code from contacts.ts (see above)
2. Deploy clean global-search
3. Add targeted per-contact log for Wael's contact
4. Deploy again
5. Ask Wael to test "Find contacts with postal code K1C5M3" (no space)
6. Check Supabase dashboard logs for the `[wael-diag]` line
7. From the log: determine if `addressTokenMatch` is true or false for Wael, and if `addresses.length` is 0
8. Fix from there
