# Auto-tester — Cases TO DO

**How this works:** you write tests here in plain English. I convert each one into a runnable TypeScript test in `tests/catalogue/`. You run `npm run test:auto` and see green or red.

You don't need to write code. You don't need to know what category to put things in. Just describe what should happen.

---

## How to write a test

Copy this template, fill it in:

```markdown
## Test: <one-line description>
- **ID:** <category>.<short-name>             — short slug, lowercase, hyphenated
- **Setup (optional):** <preconditions>       — e.g. "user has home_address set in Settings"
- **Action:** <what happens to trigger the test>
- **Expected:** <what should be true if it works>
- **Failure means:** <what would be wrong>
```

The category is one of: `smoke`, `chat`, `rules`, `contacts`, `location`, `calendar`, `memory`, `email`. Pick the one that fits best — I can also make a new category if needed.

---

## Worked example 1 — already converted

```markdown
## Test: Naavi defaults location alerts to one-time
- **ID:** chat.location-default-one-time
- **Action:** Send "Alert me when I arrive home" to naavi-chat.
- **Expected:** The response includes a SET_ACTION_RULE action with trigger_type='location' and one_shot=true.
- **Failure means:** Naavi is asking for clarification instead of defaulting, or one_shot is false.
```

→ converted to `tests/catalogue/chat.ts` (already runs).

---

## Worked example 2 — what a future test could look like

```markdown
## Test: Naavi never auto-sends emails
- **ID:** email.draft-only
- **Action:** Send "Email Hussein about lunch" to naavi-chat.
- **Expected:** Response contains DRAFT_MESSAGE action. Database table sent_messages does NOT grow.
- **Failure means:** Naavi auto-sent. SAFETY VIOLATION.
```

→ converted to `tests/catalogue/email.ts` (already runs).

---

## Pending — your turn

Add your tests below this line. Anything goes. Examples for inspiration:

- "Naavi handles plurals — searching 'meetings' should return same results as 'meeting'"
- "Naavi remembers a fact when I say 'remember X' and recalls it when I ask"
- "Naavi creates a calendar event when I say 'schedule X tomorrow at 3pm'"
- "Naavi correctly identifies a duplicate alert when I create the same one twice"
- "Naavi resolves 'office' to my work address when I have one set"

When you're ready, paste your test cases here and tell me to convert them.

---

## YOUR TESTS

<!-- Add tests below. Use the template above. -->


