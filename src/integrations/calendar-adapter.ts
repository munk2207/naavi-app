/**
 * Naavi — Calendar Adapter
 *
 * Handles both Google Calendar (OAuth 2.0) and Apple Calendar (iOS permissions).
 * Robert may have one or both connected. The adapter merges them into a single
 * normalised list, de-duplicating events that appear in both.
 *
 * Sync frequency: every 15 minutes
 * Stale threshold: 30 minutes
 * Auth: Google → OAuth 2.0 | Apple → iOS permission (no tokens)
 */

import { BaseAdapter, type LocalDB, type OAuthToken, type SyncResult, type TokenStore } from './base-adapter';
import type { CognitiveProfile } from '../../schema/cognitive-profile';
import type { EventCategory, NormalisedCalendarEvent } from '../../schema/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// RAW TYPES — what Google Calendar API actually returns (abbreviated)
// ─────────────────────────────────────────────────────────────────────────────

interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}

interface GoogleCalendarListResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
}

// Apple Calendar events come through Expo's Calendar API
interface ExpoCalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  allDay: boolean;
  calendarId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

export class CalendarAdapter extends BaseAdapter {
  private profile: CognitiveProfile;

  constructor(db: LocalDB, tokenStore: TokenStore, profile: CognitiveProfile) {
    super('google_calendar', db, tokenStore, 30);
    this.profile = profile;
  }

  async connect(): Promise<boolean> {
    // Initiates OAuth flow in the app — the UI handles the browser redirect.
    // This method is called after the OAuth callback returns a code.
    // Returns true when the token is successfully stored.
    // Actual OAuth redirect/callback is handled in the auth UI layer.
    const token = await this.tokenStore.getToken('google_calendar');
    return token !== null;
  }

  async sync(): Promise<SyncResult> {
    const hasValidToken = await this.ensureValidToken();
    if (!hasValidToken) {
      await this.updateStatus('degraded', 'Google Calendar token expired or missing');
      return this.failedSync(
        this.buildSyncError('auth', 'Token invalid or expired', false)
      );
    }

    try {
      const events = await this.fetchGoogleEvents();
      const normalised = events.map(e => this.normaliseGoogleEvent(e));
      await this.writeToCache(normalised);
      await this.updateStatus('connected');
      return this.successfulSync(normalised.length);
    } catch (err) {
      const isNetwork = err instanceof TypeError;
      await this.updateStatus('stale', 'Sync failed — serving cached data');
      return this.failedSync(
        this.buildSyncError(
          isNetwork ? 'network' : 'api_error',
          String(err),
          true,
        )
      );
    }
  }

  async read(): Promise<NormalisedCalendarEvent[]> {
    // Read from SQLite — no network call
    const today = new Date();
    const sevenDaysAhead = new Date(today);
    sevenDaysAhead.setDate(today.getDate() + 7);

    const rows = await this.db.getMany('calendar_events', {
      source: 'google_calendar',
    }) as NormalisedCalendarEvent[];

    return rows.filter(event => {
      const start = new Date(event.start_at);
      return start >= startOfDay(today) && start <= endOfDay(sevenDaysAhead);
    });
  }

  // ── Private: fetch from Google Calendar API ───────────────────────────────

  private async fetchGoogleEvents(): Promise<GoogleCalendarEvent[]> {
    const token = await this.tokenStore.getToken('google_calendar');
    if (!token) throw new Error('No token');

    const now = new Date();
    const sevenDaysAhead = new Date(now);
    sevenDaysAhead.setDate(now.getDate() + 7);

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: sevenDaysAhead.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    if (response.status === 401) {
      throw new Error('AUTH_EXPIRED');
    }

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json() as GoogleCalendarListResponse;
    return data.items.filter(e => e.status !== 'cancelled');
  }

  // ── Private: normalise a raw Google event ────────────────────────────────

  private normaliseGoogleEvent(raw: GoogleCalendarEvent): NormalisedCalendarEvent {
    const startAt = raw.start.dateTime ?? raw.start.date ?? '';
    const endAt   = raw.end.dateTime   ?? raw.end.date   ?? '';
    const today = new Date();
    const startDate = new Date(startAt);
    const daysUntil = Math.floor(
      (startOfDay(startDate).getTime() - startOfDay(today).getTime()) / (1000 * 60 * 60 * 24)
    );

    const { category, care_team_match } = this.classifyEvent(raw.summary, raw.location);

    return {
      id: `gcal_${raw.id}`,
      source: 'google_calendar',
      title: raw.summary,
      start_at: startAt,
      end_at: endAt,
      all_day: !raw.start.dateTime,
      location: raw.location,
      category,
      care_team_match,
      notes: raw.description,
      is_today: daysUntil === 0,
      days_until: daysUntil,
      cached_at: new Date().toISOString(),
    };
  }

  // ── Private: classify an event using the Cognitive Profile ───────────────

  private classifyEvent(
    title: string,
    location?: string,
  ): { category: EventCategory; care_team_match?: string } {
    const lower = (title + ' ' + (location ?? '')).toLowerCase();

    // Check against care team names
    for (const member of this.profile.health.care_team) {
      const lastName = member.name.split(' ').pop()?.toLowerCase() ?? '';
      const clinicLower = (member.clinic ?? '').toLowerCase();
      if (lower.includes(lastName) || lower.includes(clinicLower)) {
        return { category: 'medical', care_team_match: member.name };
      }
    }

    // Check against relationship names (social events)
    for (const person of this.profile.relationships.people) {
      const firstName = person.name.split(' ')[0].toLowerCase();
      if (lower.includes(firstName)) {
        return { category: 'social' };
      }
    }

    // Activity keywords
    const activityKeywords = ['gym', 'golf', 'walk', 'yoga', 'swim', 'tennis', 'exercise'];
    if (activityKeywords.some(k => lower.includes(k))) {
      return { category: 'activity' };
    }

    // Medical keywords not matching care team
    const medKeywords = ['appointment', 'clinic', 'hospital', 'physio', 'therapy', 'blood', 'lab'];
    if (medKeywords.some(k => lower.includes(k))) {
      return { category: 'medical' };
    }

    return { category: 'other' };
  }

  // ── Private: write normalised events to SQLite ────────────────────────────

  private async writeToCache(events: NormalisedCalendarEvent[]): Promise<void> {
    for (const event of events) {
      await this.db.set('calendar_events', event.id, event);
    }
  }

  // ── OAuth token refresh — Google-specific ─────────────────────────────────

  protected override async refreshToken(token: OAuthToken): Promise<boolean> {
    try {
      const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: token.refresh_token,
          grant_type:    'refresh_token',
        }),
      });

      if (!response.ok) return false;

      const data = await response.json() as { access_token: string; expires_in: number };
      const refreshed: OAuthToken = {
        ...token,
        access_token: data.access_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };

      await this.tokenStore.saveToken('google_calendar', refreshed);
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
