# Naavi — Normalized Internal Data Model
**Version:** 1.0
**Date:** 2026-03-22
**Status:** Draft — For Review and Implementation
**Author:** Naavi Architecture Review

---

## Purpose

This document defines the normalized internal data model for Naavi. The goal is to establish provider-agnostic data interfaces that sit between the Naavi intelligence layer and any external service provider (Google, Microsoft, Apple, Dropbox, etc.).

### Why This Matters

Today Naavi's integration layer is tightly coupled to Google services. Every function call in the codebase references a specific provider. This creates a structural problem: adding a second client who uses Outlook, iCloud, or OneDrive requires rewriting large portions of the application.

The normalized model solves this by making Naavi own the data concepts. Providers become interchangeable adapters underneath.

### Architecture Principle

```
User (Robert / Future Clients)
         ↓
Naavi Orchestration (AI Layer)
         ↓
Normalized Internal Data Model    ← This document defines this layer
         ↓
Provider Adapters                 ← Google, Microsoft, Apple, Notion, etc.
         ↓
External APIs
```

The UI and AI layers never talk to a provider directly. They only speak Naavi's normalized language. When a new provider is added, only a new adapter file is written — nothing else changes.

---

## Open Decision — Before Implementation Begins

**Every adapter call routes through the user's provider preference. The following must be decided before writing any interface:**

> **Should one user be able to have Google Calendar + Outlook Calendar active simultaneously (multi-provider per category)?**
> Or one active provider per category at a time (single-provider per category)?

| Option | `defaultCalendarProvider` type | Complexity | Covers |
|---|---|---|---|
| Single active provider | `string` | Lower | 95% of use cases |
| Multiple simultaneous | `string[]` | Higher | Power users, migrations |

**Recommendation:** Start with single active provider per category. The field can be migrated to an array later without breaking the interface contract.

---

## Entity 1 — CalendarEvent

Represents a scheduled event from any calendar provider.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `title` | `string` | ✅ Core | Event title |
| `startISO` | `string` | ✅ Core | ISO 8601 datetime |
| `endISO` | `string` | ✅ Core | ISO 8601 datetime |
| `isAllDay` | `boolean` | ✅ Core | All-day vs timed event |
| `location` | `string` | Optional | Physical or virtual location |
| `description` | `string` | Optional | Event body/notes |
| `attendees` | `{ name: string; email: string }[]` | Optional | List of attendees |
| `recurrence` | `string` | Optional | Recurrence rule (RRULE format) |
| `provider` | `'google' \| 'outlook' \| 'apple'` | Provider metadata | Source provider |
| `providerEventId` | `string` | Provider metadata | Original ID in source system |
| `htmlLink` | `string` | Provider metadata | Link to view in provider UI |

**Adapter operations required:**
- `fetchEvents(userId, days)` → `CalendarEvent[]`
- `createEvent(event)` → `CalendarEvent`
- `updateEvent(id, changes)` → `CalendarEvent`
- `deleteEvent(id)` → `void`
- `sync(userId)` → `void`

---

## Entity 2 — Email

Represents an email message from any mail provider.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `from` | `{ name: string; email: string }` | ✅ Core | Sender |
| `to` | `{ name: string; email: string }[]` | ✅ Core | Recipients |
| `subject` | `string` | ✅ Core | Email subject line |
| `bodyText` | `string` | ✅ Core | Plain text body |
| `summary` | `string` | ✅ Core | AI-generated summary for brief |
| `isImportant` | `boolean` | ✅ Core | High priority flag |
| `isRead` | `boolean` | ✅ Core | Read/unread status |
| `receivedAt` | `string` | ✅ Core | ISO 8601 datetime |
| `threadId` | `string` | Optional | Conversation thread |
| `attachments` | `{ name: string; mimeType: string }[]` | Optional | Attachment list |
| `provider` | `'gmail' \| 'outlook'` | Provider metadata | Source provider |

**Adapter operations required:**
- `fetchImportant(userId)` → `Email[]`
- `send(draft)` → `{ success: boolean; error?: string }`
- `sync(userId)` → `void`

---

## Entity 3 — Contact

Represents a person in any contacts system.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `name` | `string` | ✅ Core | Full name |
| `email` | `string` | Optional | Primary email address |
| `phone` | `string` | Optional | Primary phone number |
| `relationship` | `string` | Optional | e.g. "doctor", "colleague" |
| `photoUrl` | `string` | Optional | Profile photo URL |
| `provider` | `'google' \| 'outlook' \| 'apple'` | Provider metadata | Source provider |
| `providerContactId` | `string` | Provider metadata | Original ID in source system |

**Adapter operations required:**
- `lookup(name)` → `Contact | null`
- `save(contact)` → `Contact`
- `search(query)` → `Contact[]`

---

## Entity 4 — StorageFile

Represents a file or document in any cloud storage system.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `name` | `string` | ✅ Core | File name |
| `mimeType` | `string` | ✅ Core | MIME type |
| `mimeTypeLabel` | `string` | ✅ Core | Human-friendly type label |
| `webViewLink` | `string` | ✅ Core | URL to open in browser |
| `modifiedAt` | `string` | ✅ Core | ISO 8601 datetime |
| `parentFolderId` | `string` | Optional | Parent folder ID |
| `parentFolderName` | `string` | Optional | Parent folder name |
| `provider` | `'gdrive' \| 'onedrive' \| 'dropbox'` | Provider metadata | Source provider |

**Adapter operations required:**
- `search(query, userId)` → `StorageFile[]`
- `save(title, content, userId)` → `StorageFile`
- `sendAsEmailAttachment(fileId, to)` → `{ success: boolean; error?: string }`

---

## Entity 5 — NavigationResult

Represents a travel time calculation from any maps provider.

| Field | Type | Required | Notes |
|---|---|---|---|
| `destination` | `string` | ✅ Core | Destination address |
| `durationMinutes` | `number` | ✅ Core | Travel time in minutes |
| `distanceKm` | `number` | ✅ Core | Distance in kilometres |
| `leaveByMs` | `number` | ✅ Core | Unix ms timestamp — when to leave |
| `summary` | `string` | ✅ Core | Human-readable e.g. "23 min via Highway 417" |
| `origin` | `string` | Optional | Origin address (defaults to home) |
| `provider` | `'google_maps' \| 'apple_maps' \| 'waze'` | Provider metadata | Source provider |

**Adapter operations required:**
- `fetchTravelTime(destination, eventStartISO)` → `NavigationResult | null`

---

## Entity 6 — Note

Represents a voice or text note saved by the user.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `title` | `string` | ✅ Core | Note title |
| `content` | `string` | ✅ Core | Full text content |
| `createdAt` | `string` | ✅ Core | ISO 8601 datetime |
| `userId` | `string` | ✅ Core | Owner user ID |
| `audioUrl` | `string` | Optional | Link to original audio recording |
| `tags` | `string[]` | Optional | User-defined tags |

**Adapter operations required:**
- `save(note)` → `Note`
- `fetchAll(userId)` → `Note[]`
- `delete(id)` → `void`

---

## Entity 7 — Conversation

Represents a recorded multi-speaker conversation with extracted action items.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `title` | `string` | ✅ Core | User-assigned title |
| `recordedAt` | `string` | ✅ Core | ISO 8601 datetime |
| `userId` | `string` | ✅ Core | Owner user ID |
| `utterances` | `Utterance[]` | ✅ Core | Speaker-labeled transcript segments |
| `speakers` | `string[]` | ✅ Core | Speaker identifiers e.g. ['A', 'B'] |
| `confirmedNames` | `Record<string, string>` | ✅ Core | Map of speaker ID → real name |
| `actions` | `ConversationAction[]` | ✅ Core | Extracted action items |
| `transcriptDocLink` | `string` | Optional | Link to full transcript document |

### Utterance (sub-type)

| Field | Type | Required |
|---|---|---|
| `speaker` | `string` | ✅ Core |
| `text` | `string` | ✅ Core |
| `startMs` | `number` | ✅ Core |
| `endMs` | `number` | ✅ Core |

### ConversationAction (sub-type)

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'meeting' \| 'email' \| 'task' \| 'reminder'` | ✅ Core | Action category |
| `title` | `string` | ✅ Core | Short action title |
| `description` | `string` | ✅ Core | Full description |
| `assignee` | `string` | Optional | Who is responsible |
| `timing` | `string` | Optional | When e.g. "next week", "as soon as possible" |
| `calendarTitle` | `string` | Optional | Suggested calendar event title |
| `emailDraft` | `string` | Optional | Suggested email draft body |

---

## Entity 8 — UserProfile

Represents a Naavi user and their provider preferences. This is the routing table for all adapters.

| Field | Type | Required | Notes |
|---|---|---|---|
| `userId` | `string` | ✅ Core | Unique user ID |
| `displayName` | `string` | ✅ Core | e.g. "Robert" — used for auto-labeling |
| `defaultCalendarProvider` | `'google' \| 'outlook' \| 'apple'` | ✅ Core | Active calendar provider |
| `defaultEmailProvider` | `'gmail' \| 'outlook'` | ✅ Core | Active email provider |
| `defaultStorageProvider` | `'gdrive' \| 'onedrive' \| 'dropbox'` | ✅ Core | Active storage provider |
| `defaultMapsProvider` | `'google_maps' \| 'apple_maps'` | ✅ Core | Active maps provider |
| `timezone` | `string` | ✅ Core | IANA timezone e.g. `America/Toronto` |
| `language` | `'en' \| 'ar'` | ✅ Core | Preferred language |
| `homeAddress` | `string` | Optional | Used for travel time calculations |
| `workAddress` | `string` | Optional | Used for travel time calculations |

> **Note:** The `default*Provider` fields are the routing keys. When the orchestration layer calls `calendar.fetchEvents()`, it reads `UserProfile.defaultCalendarProvider` to decide which adapter to invoke. Changing a user's provider is a single field update — no code changes required.

---

## Entity 9 — BriefItem

Represents a single item in the user's morning brief. This is a Naavi-owned concept — no provider owns it. It is the normalized output that results from processing CalendarEvents, Emails, and other sources.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ Core | Naavi internal ID |
| `category` | `'calendar' \| 'email' \| 'social' \| 'weather' \| 'health' \| 'home'` | ✅ Core | Display grouping |
| `title` | `string` | ✅ Core | Brief item headline |
| `priority` | `'high' \| 'medium' \| 'low'` | ✅ Core | Determines ordering |
| `detail` | `string` | Optional | Supporting detail text |
| `startISO` | `string` | Optional | For calendar items |
| `endISO` | `string` | Optional | For calendar items |
| `location` | `string` | Optional | Physical location |
| `leaveByMs` | `number` | Optional | Leave-by time in Unix ms |
| `actionUrl` | `string` | Optional | Deep link to source item |
| `sourceProvider` | `string` | Optional | Which provider generated this item |
| `sourceId` | `string` | Optional | Original item ID in source system |

---

## Implementation Sequence

Once this document is approved, the recommended build sequence is:

| Phase | Task | Effort |
|---|---|---|
| **Phase 1** | Write TypeScript interfaces for all 9 entities — no implementation | 1 day |
| **Phase 2** | Wrap existing Google libs behind adapter classes implementing those interfaces | 3–5 days |
| **Phase 3** | Update UI and orchestration layer to import adapters, not Google libs directly | 2–3 days |
| **Phase 4** | Add new provider adapters as new clients require them | Per provider |

Phase 1 and 2 produce zero visible change to the user. The app behaves identically. The value is entirely in the structural clean-up that makes Phase 4 fast and safe.

---

## Summary

| Entity | Purpose |
|---|---|
| `CalendarEvent` | Provider-agnostic calendar event |
| `Email` | Provider-agnostic email message |
| `Contact` | Provider-agnostic contact record |
| `StorageFile` | Provider-agnostic file/document |
| `NavigationResult` | Provider-agnostic travel time result |
| `Note` | Naavi-owned voice/text note |
| `Conversation` | Naavi-owned recorded conversation with actions |
| `UserProfile` | Per-user provider routing table and preferences |
| `BriefItem` | Naavi-owned morning brief item — output of all sources |

The `UserProfile` entity is the most strategically important. It is what allows Naavi to serve different clients with different providers without any code change — just a different profile record.

---

*End of document. For questions or revisions contact the Naavi architecture team.*
