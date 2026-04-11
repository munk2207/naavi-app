/**
 * AI Orchestration Layer — Types
 *
 * Defines every action Naavi can take after Claude processes
 * Robert's message. Claude returns structured JSON; these types
 * describe exactly what that JSON must contain.
 */

// ─── Actions Claude can instruct Naavi to take ───────────────────────────────

/** Speak a response aloud to Robert */
export interface SpeakAction {
  type: 'SPEAK';
  text: string; // What Naavi says out loud — always present
}

/** Set a local push notification reminder */
export interface SetReminderAction {
  type: 'SET_REMINDER';
  title: string;       // e.g. "Call pharmacy about Metformin refill"
  datetime: string;    // ISO 8601 — e.g. "2026-03-28T09:00:00-05:00"
  notes?: string;      // Optional context shown in the notification
  source: string;      // Why this was created — e.g. "medication refill due April 10"
}

/** Update something in Robert's Cognitive Profile */
export interface UpdateProfileAction {
  type: 'UPDATE_PROFILE';
  field: string;  // Dot-notation path — e.g. "health.medications[0].nextRefill"
  value: unknown; // The new value
  reason: string; // Why the update is being made — for audit trail
}

/** Prepare a message draft for Robert to review before sending */
export interface DraftMessageAction {
  type: 'DRAFT_MESSAGE';
  to: string;      // Recipient name or email
  subject: string;
  body: string;
  channel: 'email' | 'sms'; // How to send it
}

/** Fetch more detail from a specific integration */
export interface FetchDetailAction {
  type: 'FETCH_DETAIL';
  integration: 'calendar' | 'health_portal' | 'weather' | 'smart_home';
  resourceId: string; // The ID of the specific item to fetch
  reason: string;     // Why more detail is needed
}

/** Flag a concern for the Cognitive Profile's long-term pattern tracking */
export interface LogConcernAction {
  type: 'LOG_CONCERN';
  category: 'health' | 'social' | 'routine' | 'cognitive';
  note: string;        // What was observed
  severity: 'low' | 'medium' | 'high';
}

/**
 * Set an email watch rule — alert Robert by SMS when an email arrives
 * from a specific person or with a specific word in the subject.
 * At least one of fromName, fromEmail, or subjectKeyword must be provided.
 */
export interface SetEmailAlertAction {
  type: 'SET_EMAIL_ALERT';
  fromName?: string;        // Sender name to watch for, e.g. "John Smith"
  fromEmail?: string;       // Exact sender email, e.g. "john@acme.com"
  subjectKeyword?: string;  // Word or phrase in subject, e.g. "invoice"
  phoneNumber: string;      // Robert's cell phone number to SMS
  label: string;            // Human label, e.g. "Emails from John Smith"
}

/** Add a person to Robert's contacts (people table) */
export interface AddContactAction {
  type: 'ADD_CONTACT';
  name: string;
  phone?: string;
  email?: string;
  relationship?: string;
  notes?: string;
}

export type NaaviAction =
  | SpeakAction
  | SetReminderAction
  | UpdateProfileAction
  | DraftMessageAction
  | FetchDetailAction
  | LogConcernAction
  | SetEmailAlertAction
  | AddContactAction;

// ─── The structured response Claude returns ──────────────────────────────────

/**
 * Every response from Claude must match this shape.
 * The orchestrator validates this before acting on it.
 */
export interface ClaudeResponse {
  /** What Naavi says out loud to Robert */
  speech: string;

  /** Zero or more actions to execute */
  actions: NaaviAction[];

  /**
   * Threads left open — things Robert mentioned but didn't resolve.
   * Naavi tracks these and follows up.
   * e.g. "Robert said he'd call Louise — not confirmed yet"
   */
  pendingThreads: PendingThread[];

  /**
   * New things Naavi learned about Robert in this turn.
   * Used to keep the Cognitive Profile current.
   */
  profileUpdates: ProfileUpdate[];
}

export interface PendingThread {
  id: string;
  description: string;    // What is unresolved
  followUpDate?: string;  // When to check back — ISO 8601
  category: 'task' | 'health' | 'social' | 'errand';
}

export interface ProfileUpdate {
  field: string;
  value: unknown;
  reason: string;
}

// ─── The full context package sent to Claude ─────────────────────────────────

export interface OrchestrationRequest {
  /** What Robert just said */
  userMessage: string;

  /** The integration snapshot — what was collected this morning */
  integrationSnapshot: IntegrationSnapshot;

  /** Condensed view of Robert's Cognitive Profile */
  profileSummary: ProfileSummary;

  /** Last N turns of conversation (for context) */
  conversationHistory: ConversationTurn[];

  /** Which language Robert is currently using */
  language: 'en' | 'fr';
}

export interface IntegrationSnapshot {
  capturedAt: string; // ISO 8601
  calendar: {
    todayEvents: Array<{ time: string; title: string; location?: string }>;
    upcomingEvents: Array<{ date: string; title: string }>;
  };
  health: {
    upcomingAppointments: Array<{ date: string; doctor: string; reason?: string }>;
    medicationsDueSoon: Array<{ name: string; dueDate: string }>;
    recentResults?: string; // Plain text summary only — no raw lab values
  };
  weather: {
    summary: string;         // e.g. "-8°C, light snow"
    walkAdvisory?: string;   // e.g. "Sidewalks icy — consider yaktrax"
  };
  smartHome: {
    alerts: string[];        // e.g. ["Front door unlocked since 8pm"]
  };
}

export interface ProfileSummary {
  name: string;
  age: number;
  city: string;
  keyRelationships: Array<{ name: string; relation: string; lastContact?: string }>;
  activeHealthContext: string[]; // Plain text items — e.g. "Managing Type 2 diabetes"
  currentGoals: string[];
  openThreads: PendingThread[];
  preferences: {
    responseLength: 'brief' | 'detailed';
    language: 'en' | 'fr' | 'both';
    morningBriefTime: string; // e.g. "08:00"
  };
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO 8601
}
