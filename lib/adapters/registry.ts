/**
 * Naavi Provider Registry
 *
 * The single routing table for all adapter calls.
 * Reads the user's provider preferences from UserProfile and returns
 * the correct adapter instance for each category.
 *
 * The rest of the system imports from here — never from individual adapter files.
 *
 * Adding a new provider:
 * 1. Create the adapter file in /adapters/<provider>/
 * 2. Add a case to the relevant getter below
 * 3. Update UserProfile.default*Provider to the new value
 * Nothing else changes.
 */

import type {
  CalendarAdapter,
  EmailAdapter,
  ContactAdapter,
  StorageAdapter,
  MapsAdapter,
} from './interfaces';

import type { UserProfile } from '../types';

import { GoogleCalendarAdapter } from './google/calendar.adapter';
import { GoogleEmailAdapter }    from './google/email.adapter';
import { GoogleContactAdapter }  from './google/contact.adapter';
import { GoogleStorageAdapter }  from './google/storage.adapter';
import { GoogleMapsAdapter }     from './google/maps.adapter';

// ─── Default profile ──────────────────────────────────────────────────────────
// Used when no UserProfile has been loaded yet (e.g. pre-login).
// All defaults point to Google — the current and only supported provider set.

const DEFAULT_PROFILE: Partial<UserProfile> = {
  defaultCalendarProvider: 'google',
  defaultEmailProvider:    'gmail',
  defaultStorageProvider:  'gdrive',
  defaultMapsProvider:     'google_maps',
  language:                'en',
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export class AdapterRegistry {
  private profile: Partial<UserProfile>;

  constructor(profile?: Partial<UserProfile>) {
    this.profile = profile ?? DEFAULT_PROFILE;
  }

  /** Update the active user profile (call after login or settings change) */
  setProfile(profile: Partial<UserProfile>): void {
    this.profile = profile;
  }

  // ── Calendar ──────────────────────────────────────────────────────────────

  get calendar(): CalendarAdapter {
    switch (this.profile.defaultCalendarProvider ?? 'google') {
      case 'google':  return new GoogleCalendarAdapter();
      // case 'outlook': return new OutlookCalendarAdapter();  // Phase 4
      // case 'apple':   return new AppleCalendarAdapter();    // Phase 4
      default:        return new GoogleCalendarAdapter();
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  get email(): EmailAdapter {
    switch (this.profile.defaultEmailProvider ?? 'gmail') {
      case 'gmail':   return new GoogleEmailAdapter();
      // case 'outlook': return new OutlookEmailAdapter();     // Phase 4
      default:        return new GoogleEmailAdapter();
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  get contacts(): ContactAdapter {
    switch (this.profile.defaultCalendarProvider ?? 'google') {
      case 'google':  return new GoogleContactAdapter();
      // case 'outlook': return new OutlookContactAdapter();   // Phase 4
      // case 'apple':   return new AppleContactAdapter();     // Phase 4
      default:        return new GoogleContactAdapter();
    }
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  get storage(): StorageAdapter {
    switch (this.profile.defaultStorageProvider ?? 'gdrive') {
      case 'gdrive':   return new GoogleStorageAdapter();
      // case 'onedrive': return new OneDriveStorageAdapter(); // Phase 4
      // case 'dropbox':  return new DropboxStorageAdapter();  // Phase 4
      default:         return new GoogleStorageAdapter();
    }
  }

  // ── Maps ──────────────────────────────────────────────────────────────────

  get maps(): MapsAdapter {
    switch (this.profile.defaultMapsProvider ?? 'google_maps') {
      case 'google_maps': return new GoogleMapsAdapter();
      // case 'apple_maps':  return new AppleMapsAdapter();    // Phase 4
      default:            return new GoogleMapsAdapter();
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
// A single registry instance used across the app.
// Call registry.setProfile(userProfile) after the user logs in.

export const registry = new AdapterRegistry();
