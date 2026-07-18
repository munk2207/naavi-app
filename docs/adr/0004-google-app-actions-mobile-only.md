# ADR 0004 — Google App Actions (list Built-in Intents) are Android-only by platform constraint, not an architecture duplication decision

**Status:** Accepted — genuinely decided, with real evidence, unlike ADR-0001/0002/0003
**Date:** 2026-07-18
**Related:** [[F9a]] in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`

## Problem

This one is worth calling out precisely because it looks like the others but isn't. F9a lets a user say "Hey Google, ask Naavi to add milk to my Costco list" directly to their Android phone's Google Assistant, without opening the app or calling Naavi's phone number. It's easy to mistake this for another "why isn't this shared with voice" case — it is not.

## Decision

**Genuinely decided, with a documented, verified reason** (holding list, F9a entry, 2026-07-03): Google's App Actions Built-in Intents are an **Android OS / Google Assistant integration mechanism**, structurally unrelated to Naavi's own Twilio-based phone system. "Voice" here means "Google Assistant voice on the Android phone" — a completely different thing from calling Naavi's own number. There is no equivalent surface on a phone call to `naavi-voice-server` for this to be "shared" with — it isn't a Shared-Core-vs-duplicated question, it's a platform capability that only exists on Android.

Location-alert creation by this mechanism was explicitly investigated and ruled out (not just skipped): Naavi's verified-address rule requires an in-conversation confirmation step before creating a location alert, and Google's App Actions fulfillment model has no multi-turn dialog since Conversational Actions was discontinued in 2023 — a single Assistant utterance cannot provide that confirmation, and a touch-confirmation fallback was explicitly ruled out by Wael as unacceptable for this feature's scope.

## Alternatives Considered

1. **Build the same Built-in Intents for a hypothetical Google Assistant-on-other-platforms surface.** Doesn't exist — Google Assistant Built-in Intents are Android-only by Google's own design, not a choice available to this project.
2. **Extend Naavi's phone-call voice system to support the same three list intents.** Technically possible (it's just another way to reach the same `manage-list` Edge Function), but out of scope for F9a's spike, which was specifically about removing the "call Naavi first" friction — building it into the phone-call system would reintroduce exactly the friction the feature exists to remove.
3. **Support location-alert creation via App Actions too.** Explicitly investigated and rejected — see Decision above; no safe voice-only path exists given the verified-address confirmation requirement and Google's fulfillment model.

## Why Rejected

Alternative 1 isn't a real option (platform constraint, not a project decision). Alternative 2 was out of scope by design, not rejected for a flaw. Alternative 3 was rejected for a concrete, verified technical reason (no multi-turn confirmation in Google's current fulfillment model), not by default.

## Consequences

- This feature is reachable only via "Hey Google" on the user's own Android phone — not via calling Naavi, not via the in-app chat. That's intentional, not a gap.
- Because this was a genuinely evidence-based decision (unlike ADR-0001/0002/0003), it does **not** need an Architecture Exception record or a review date — it isn't debt, it's a settled platform boundary.
