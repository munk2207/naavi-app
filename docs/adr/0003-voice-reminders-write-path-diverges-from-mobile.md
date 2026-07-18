# ADR 0003 — Voice writes to the `reminders` table directly; mobile redirects reminders into `action_rules`

**Status:** Accepted, but only one side of this decision is actually documented — flagged for follow-up, not fully resolved
**Date:** 2026-07-18
**Related:** Architecture Reference §2 (Reminders)

## Problem

`SET_REMINDER` requests are handled differently depending on which surface receives them. Mobile's `naavi-chat` (`handleSetReminderExec`) does **not** write to the `reminders` table — it writes into `action_rules` instead, with an in-code comment explaining why: "so they appear in the Alerts screen." Voice writes directly to `/rest/v1/reminders`. A separate mobile client function (`saveReminder()` in `lib/supabase.ts`) that does write to `reminders` exists but is dead code — never called anywhere in the app.

## Decision

**Half of this is a real, documented decision; half is likely drift.** Mobile's choice to redirect reminders into `action_rules` is genuinely explained in-code — it exists so a reminder shows up on the same Alerts screen as every other rule type, rather than living in a second, separately-displayed data source. That reasoning is sound and is treated as the accepted decision for mobile.

Voice's continued direct write to `reminders`, however, has no equivalent documented reasoning found anywhere. The most likely explanation is that voice's reminder-writing code predates mobile's redirect-to-`action_rules` decision, and voice was never updated to match when mobile's approach changed. This is recorded honestly as an open gap, not as a considered two-sided architectural choice.

## Alternatives Considered

1. **Update voice to also write reminders into `action_rules`,** matching mobile's documented reasoning (unified Alerts-screen visibility) and the "one source of truth" principle.
2. **Update mobile to also use the `reminders` table**, retiring the `action_rules`-redirect approach. Rejected implicitly by mobile's own in-code comment, which gives a real, current reason for the opposite choice.
3. **Leave as-is.** Current state, not because it was evaluated and chosen, but because no one has revisited it since mobile's redirect was added.

## Why Rejected

Option 2 is effectively already rejected by mobile's own documented reasoning (Alerts-screen visibility is a real, current product requirement). Option 1 has not been rejected — it simply hasn't been done. This is the honest state: one side of the codebase already knows why it does what it does; the other side just hasn't caught up.

## Consequences

- A reminder created via voice does not show up on the mobile Alerts screen the way a mobile-created one does — a real, user-visible inconsistency, not just an internal code-cleanliness issue.
- This should be re-evaluated as a candidate fix (bring voice's `SET_REMINDER` path in line with mobile's `action_rules` redirect) rather than left as a permanent Architecture Exception — unlike ADR-0001/0002, this one has an actual right answer already documented on one side, it just hasn't been applied to the other.
