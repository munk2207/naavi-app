/**
 * Naavi Provider Adapter Interfaces
 *
 * Every provider (Google, Microsoft, Apple, etc.) implements these contracts.
 * The rest of the system only ever calls these interfaces — never provider libs directly.
 *
 * Adding a new provider = one new file that implements the relevant interface.
 * Nothing else in the system changes.
 */

import type {
  CalendarEvent,
  Email,
  EmailDraft,
  Contact,
  StorageFile,
  NavigationResult,
  Note,
} from '../types';

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarAdapter {
  /** Fetch upcoming events for the next N days */
  fetchEvents(userId: string, days: number): Promise<CalendarEvent[]>;
  /** Fetch birthday events */
  fetchBirthdays(userId: string): Promise<CalendarEvent[]>;
  /** Create a new calendar event */
  createEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent>;
  /** Sync latest data from provider into local cache */
  sync(userId: string): Promise<void>;
}

// ─── Email ────────────────────────────────────────────────────────────────────

export interface EmailAdapter {
  /** Fetch important unread emails */
  fetchImportant(userId: string): Promise<Email[]>;
  /** Fetch emails from a specific sender name */
  fetchFromPerson(name: string, userId: string): Promise<Email[]>;
  /** Send an email draft */
  send(draft: EmailDraft): Promise<{ success: boolean; error?: string }>;
  /** Sync latest emails from provider into local cache */
  sync(userId: string): Promise<void>;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export interface ContactAdapter {
  /** Look up a contact by name — returns first match or null */
  lookup(name: string): Promise<Contact | null>;
  /** Save a new contact */
  save(contact: Partial<Contact>): Promise<Contact>;
  /** Search contacts by query string */
  search(query: string): Promise<Contact[]>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StorageAdapter {
  /** Search files by query string */
  search(query: string, userId: string): Promise<StorageFile[]>;
  /** Save a new document with title and plain text content */
  save(title: string, content: string, userId: string): Promise<StorageFile>;
  /** Send a file as an email attachment */
  sendAsEmailAttachment(params: {
    fileId: string;
    fileName: string;
    mimeType: string;
    to: string;
  }): Promise<{ success: boolean; error?: string }>;
}

// ─── Maps / Navigation ────────────────────────────────────────────────────────

export interface MapsAdapter {
  /** Calculate travel time to a destination for a given event start time */
  fetchTravelTime(
    destination: string,
    eventStartISO: string,
  ): Promise<NavigationResult | null>;
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface NoteAdapter {
  /** Save a new note */
  save(note: Omit<Note, 'id'>): Promise<Note>;
  /** Fetch all notes for a user */
  fetchAll(userId: string): Promise<Note[]>;
  /** Delete a note by ID */
  delete(id: string): Promise<void>;
}
