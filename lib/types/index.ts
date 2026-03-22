/**
 * Naavi Normalized Internal Data Model
 * Version 1.0 — 2026-03-22
 *
 * These are Naavi-owned types. No provider leaks through this layer.
 * Adapters map provider-specific data into these shapes.
 * The UI and AI layers only ever import from here.
 */

// ─── Controlled vocabulary ────────────────────────────────────────────────────

export type ProviderCalendar   = 'google' | 'outlook' | 'apple';
export type ProviderEmail      = 'gmail'  | 'outlook';
export type ProviderStorage    = 'gdrive' | 'onedrive' | 'dropbox';
export type ProviderMaps       = 'google_maps' | 'apple_maps' | 'waze';
export type ProviderContacts   = 'google' | 'outlook' | 'apple';

export type AdapterType        = 'api' | 'protocol' | 'file' | 'automation' | 'agent' | 'rpa';

export type BriefCategory      = 'calendar' | 'email' | 'social' | 'weather' | 'health' | 'home';
export type BriefPriority      = 'high' | 'medium' | 'low';
export type ConvActionType     = 'meeting' | 'email' | 'task' | 'reminder';
export type Language           = 'en';  // extend via BCP-47 tag when new language is added

// ─── Entity 1 — CalendarEvent ─────────────────────────────────────────────────

export interface CalendarEvent {
  // Core
  id: string;                         // evt_ + UUID v4
  title: string;                      // "Cardiology appointment with Dr. Ahmed"
  startISO: string;                   // "2026-03-22T14:00:00-05:00"
  endISO: string;                     // "2026-03-22T15:00:00-05:00"
  isAllDay: boolean;
  // Optional
  location?: string;                  // "501 Smyth Rd, Ottawa, ON K1H 8L6"
  description?: string;               // "Bring blood work results."
  attendees?: { name: string; email: string }[];
  recurrence?: string;                // "RRULE:FREQ=WEEKLY;BYDAY=MO"
  // Provider metadata
  provider: ProviderCalendar;
  providerEventId: string;            // Opaque — do not parse
  htmlLink?: string;                  // Link to view in provider UI
}

// ─── Entity 2 — Email ─────────────────────────────────────────────────────────

export interface Email {
  // Core
  id: string;                         // email_ + UUID v4
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  bodyText: string;                   // Plain text only — no HTML
  summary: string;                    // AI-generated 1–2 sentence digest
  isImportant: boolean;
  isRead: boolean;
  receivedAt: string;                 // "2026-03-21T09:30:00-05:00"
  // Optional
  threadId?: string;                  // Opaque thread ID — do not parse
  attachments?: { name: string; mimeType: string }[];
  // Provider metadata
  provider: ProviderEmail;
}

export interface EmailDraft {
  to: { name?: string; email: string }[];
  subject: string;
  body: string;
}

// ─── Entity 3 — Contact ───────────────────────────────────────────────────────

export interface Contact {
  // Core
  id: string;                         // contact_ + UUID v4
  name: string;                       // "Dr. Ahmed Al-Rashid"
  // Optional
  email?: string;
  phone?: string;                     // E.164 format: "+1-613-555-0123"
  relationship?: string;              // lowercase: "cardiologist", "colleague"
  photoUrl?: string;                  // Absolute HTTPS URL
  // Provider metadata
  provider?: ProviderContacts;
  providerContactId?: string;         // Opaque — do not parse
}

// ─── Entity 4 — StorageFile ───────────────────────────────────────────────────

export interface StorageFile {
  // Core
  id: string;                         // Provider file ID used directly
  name: string;                       // "Q1 2026 Meeting Notes.docx"
  mimeType: string;                   // "application/vnd.google-apps.document"
  mimeTypeLabel: string;              // "Google Doc", "PDF", "Image"
  webViewLink: string;                // Full HTTPS URL to open in browser
  modifiedAt: string;                 // ISO 8601 UTC: "2026-03-20T16:45:00Z"
  // Optional
  parentFolderId?: string;
  parentFolderName?: string;
  // Provider metadata
  provider: ProviderStorage;
}

// ─── Entity 5 — NavigationResult ─────────────────────────────────────────────

export interface NavigationResult {
  // Core
  destination: string;                // Full street address
  durationMinutes: number;            // Integer
  distanceKm: number;                 // Float, one decimal
  leaveByMs: number;                  // Unix timestamp in milliseconds
  summary: string;                    // "23 min via Highway 417 — leave by 1:37 PM"
  // Optional
  origin?: string;                    // Full address or "Home"
  // Provider metadata
  provider: ProviderMaps;
}

// ─── Entity 6 — Note ─────────────────────────────────────────────────────────

export interface Note {
  // Core
  id: string;                         // note_ + UUID v4
  title: string;
  content: string;                    // Full plain text
  createdAt: string;                  // ISO 8601 with timezone offset
  userId: string;                     // Supabase UUID
  // Optional
  audioUrl?: string;                  // HTTPS URL to audio file in storage
  tags?: string[];                    // Lowercase: ["medical", "follow-up"]
}

// ─── Entity 7 — Conversation ─────────────────────────────────────────────────

export interface Utterance {
  speaker: string;                    // Single uppercase letter: "A", "B"
  text: string;
  startMs: number;                    // Ms from recording start
  endMs: number;
}

export interface ConversationAction {
  type: ConvActionType;
  title: string;
  description: string;
  assignee?: string;                  // "Robert"
  timing?: string;                    // "in 3 months", "next week"
  calendarTitle?: string;
  emailDraft?: string;
  // Legacy fields kept for backward compatibility with existing hook
  calendar_title?: string;
  email_draft?: string;
}

export interface Conversation {
  // Core
  id: string;                         // conv_ + UUID v4
  title: string;
  recordedAt: string;                 // ISO 8601 with timezone offset
  userId: string;
  utterances: Utterance[];
  speakers: string[];                 // ["A", "B"]
  confirmedNames: Record<string, string>; // { "A": "Robert", "B": "Dr. Ahmed" }
  actions: ConversationAction[];
  // Optional
  transcriptDocLink?: string;
}

// ─── Entity 8 — UserProfile ───────────────────────────────────────────────────

export interface UserProfile {
  // Core
  userId: string;                     // Supabase UUID
  displayName: string;                // "Robert" — used for auto-labeling
  defaultCalendarProvider: ProviderCalendar;
  defaultEmailProvider: ProviderEmail;
  defaultStorageProvider: ProviderStorage;
  defaultMapsProvider: ProviderMaps;
  timezone: string;                   // IANA: "America/Toronto"
  language: Language;
  // Optional
  homeAddress?: string;               // Full street address
  workAddress?: string;
  // Adapter type per category — defaults to "api"
  calendarAdapterType?: AdapterType;
  emailAdapterType?: AdapterType;
  storageAdapterType?: AdapterType;
}

// ─── Entity 9 — BriefItem ────────────────────────────────────────────────────
// Naavi-owned concept — no provider owns this.
// Normalized output assembled from CalendarEvents, Emails, and other sources.

export interface BriefItem {
  // Core
  id: string;
  category: BriefCategory;
  title: string;
  priority: BriefPriority;
  // Optional
  detail?: string;                    // "501 Smyth Rd · 23 min drive · leave by 1:37 PM"
  startISO?: string;
  endISO?: string;
  location?: string;
  leaveByMs?: number;                 // Unix ms — triggers leave-now alert
  actionUrl?: string;                 // HTTPS URL to open source item
  sourceProvider?: string;            // "google", "outlook", "open-meteo"
  sourceId?: string;                  // Original item ID in source system
}
