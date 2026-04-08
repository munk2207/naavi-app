# AI Orchestration Layer

## What this layer does

This is the brain of Naavi. It sits between Robert's voice and every action Naavi takes.

Every time Robert says something, this layer:
1. Gathers everything Naavi knows — his Cognitive Profile, today's calendar and health snapshot, recent conversation
2. Packages it all into a structured request to Claude
3. Claude decides what to say and what to do
4. This layer carries out Claude's decisions — sets reminders, updates the profile, drafts messages, flags concerns

## The five files

### `types.ts`
Defines every data shape in the layer — what an action looks like, what Claude must return, what gets sent to Claude. Think of it as the "vocabulary" that all the other files speak.

### `prompt-builder.ts`
Builds the full "briefing document" that Claude reads before responding. It includes:
- Who Robert is and what Naavi knows about him
- Everything happening today (calendar, health, weather, smart home)
- Open threads from previous conversations
- Exact instructions on how to format the response

This is rebuilt fresh on every turn so Claude always has up-to-date context.

### `action-parser.ts`
Claude responds with structured JSON. This file reads that JSON safely — if Claude returns something unexpected or malformed, it falls back to a safe default rather than crashing. It also validates every action to make sure it is a known type before passing it along.

### `action-executor.ts`
Carries out each action Claude decided on:
- `SET_REMINDER` → schedules a phone notification
- `UPDATE_PROFILE` → writes a new fact to Robert's Cognitive Profile
- `DRAFT_MESSAGE` → saves a message for Robert to review before sending
- `FETCH_DETAIL` → asks an integration adapter for more specific information
- `LOG_CONCERN` → flags something for long-term pattern tracking

All implementations are currently stubbed with TODO comments pointing to the exact Expo APIs that will replace them in Phase 7.

### `orchestrator.ts`
The director. Calls everything in order, handles errors gracefully, and returns a single clean result to the calling layer. Also decides which Claude model to use — Sonnet for routine requests, Opus for health concerns and complex reasoning.

## Model selection logic

| Situation | Model | Reason |
|-----------|-------|--------|
| Morning brief, reminders, weather | `claude-sonnet-4-6` | Fast, cost-effective, sufficient |
| Health keywords (pain, symptom, medication) | `claude-opus-4-6` | Deeper reasoning needed |
| Scheduling conflicts | `claude-opus-4-6` | Multi-step reasoning |
| Relationship concerns | `claude-opus-4-6` | Nuanced context required |

## Security decisions

**The Claude API key is never hardcoded.** It is read from the `ANTHROPIC_API_KEY` environment variable. In the Expo mobile app it will be stored in a secure server-side config — the key never appears in the app bundle that gets shipped to Robert's phone.

**Naavi never sends messages without Robert seeing them first.** `DRAFT_MESSAGE` actions save to a review queue — Robert approves before anything goes out.

**Naavi never stores passwords or credentials.** Integration connections use OAuth tokens stored in Supabase with encryption at rest.

## What comes next (Phase 7)

The TODO comments in `action-executor.ts` mark exactly where Expo APIs plug in:
- `expo-notifications` for SET_REMINDER
- `expo-sqlite` for UPDATE_PROFILE and LOG_CONCERN
- A review screen component for DRAFT_MESSAGE

Once the Expo project is initialised, these stubs get replaced one by one with real implementations.
