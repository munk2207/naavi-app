/**
 * useOrchestrator hook
 *
 * Manages the full conversation loop:
 * - Sending Robert's message to Naavi
 * - Tracking conversation history
 * - Speaking the response aloud via expo-speech
 * - Returning loading/error state to the UI
 *
 * Each turn stores its own cards (travel time, drive files, drafts, etc.)
 * so the UI can render them interleaved with the conversation.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { sendToNaavi, type NaaviMessage, type NaaviAction, type BriefItem, type GlobalSearchResult } from '@/lib/naavi-client';
import { saveContact, saveReminder, saveDriveNote, saveConversationTurn, supabase } from '@/lib/supabase';
import { sendPushNotification } from '@/lib/push';
import { extractPersonQuery, getPersonContext, formatPersonContext, savePerson, saveTopic } from '@/lib/memory';
import { lookupContact, lookupContactByPhone } from '@/lib/contacts';
import { ingestNote, deleteKnowledge, fetchAllKnowledge, searchKnowledge } from '@/lib/knowledge';
import { registry } from '@/lib/adapters/registry';
import { createList, addToList, removeFromList, readList } from '@/lib/lists';
import type { StorageFile, NavigationResult } from '@/lib/types';

import { isConfirmable, buildActionSummary, SPEECH, type PendingAction } from '@/lib/voice-confirm';

// Endpoints for direct Edge Function calls from the orchestrator (location-rule
// confirmation flow and resolve-place cache writes).
const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Affirmative / negative patterns for the pending-location confirmation turn.
// Kept tight so ambiguous replies fall through to the clarification branch.
const AFFIRMATIVE_RE = /^(yes|yeah|yep|yup|sure|confirm|confirmed|correct|ok|okay|alright|do it|go ahead|set it|please|please do)[.!?]*$/i;
const NEGATIVE_RE    = /^(no|nope|cancel|never ?mind|stop|forget it|don[']?t)[.!?]*$/i;

export type OrchestratorStatus = 'idle' | 'thinking' | 'speaking' | 'pending_confirm' | 'error';

export interface ConversationTurn {
  userMessage: string;
  assistantSpeech: string;
  drafts: NaaviAction[];
  createdEvents: { summary: string; htmlLink?: string }[];
  deletedEvents: { count: number; titles: string[] }[];
  savedDocs: { title: string; webViewLink?: string }[];
  rememberedItems: { text: string; count: number }[];
  driveFiles: StorageFile[];
  navigationResults: NavigationResult[];
  listResults: { action: string; listName: string; items?: string[]; webViewLink?: string }[];
  globalSearch?: { query: string; results: GlobalSearchResult[] };
  timestamp?: string;
}

export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = [], avoidHighways = false, isHandsfree = false) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);

  // Pending location rule — between the "Found X, shall I set?" turn and the
  // user's yes/no confirmation. Supports the verified-address-only rule
  // (see project_naavi_location_verified_address.md).
  //   originalAction: the SET_ACTION_RULE Claude emitted, kept so we can
  //                   insert with the original label/action_config/one_shot.
  //   placeName:      the query that was searched (e.g. "Costco Merivale").
  //   resolved:       present when resolve-place returned a fresh success;
  //                   null when the last attempt returned not_found.
  //   attempts:       1-3. At >3 we bail with "call me back."
  const pendingLocationRef = useRef<{
    originalAction: any;
    placeName: string;
    resolved: {
      place_name: string;
      address?: string;
      lat: number;
      lng: number;
      canonical_alias?: string;
      radius_meters: number;
    } | null;
    attempts: number;
  } | null>(null);

  // Always-current ref — send() reads this so it never uses a stale brief
  const briefRef = useRef(briefItems);
  useEffect(() => { briefRef.current = briefItems; }, [briefItems]);

  // Always-current ref for hands-free state
  const handsfreeRef = useRef(isHandsfree);
  useEffect(() => { handsfreeRef.current = isHandsfree; }, [isHandsfree]);

  // Derive history for Claude context from turns
  const historyRef = useRef<NaaviMessage[]>([]);
  useEffect(() => {
    historyRef.current = turns.flatMap(t => [
      { role: 'user' as const,      content: t.userMessage },
      { role: 'assistant' as const, content: t.assistantSpeech },
    ]);
  }, [turns]);

  const send = useCallback(async (userMessage: string) => {
    if (status === 'thinking' || status === 'speaking' || status === 'pending_confirm') return;
    // Clear any pending confirm when a new message comes in (edit flow)
    if (pendingActionRef.current) {
      pendingActionRef.current = null;
      setPendingAction(null);
    }

    _speechStopped = false;
    setStatus('thinking');
    setError(null);

    // ── PENDING LOCATION CONFIRMATION (M1 verified-address flow) ──────────────
    // If there's a pending location rule from the previous turn, handle this
    // user message as either a confirmation, a cancel, or a clarification.
    // Skips the Claude round-trip entirely.
    if (pendingLocationRef.current && supabase) {
      const pending = pendingLocationRef.current;
      const msg = userMessage.trim();
      const isYes = AFFIRMATIVE_RE.test(msg);
      const isNo  = NEGATIVE_RE.test(msg);

      // Helper — emit a text-only turn and reset status. No cards, no actions.
      const emitPendingTurn = (speech: string) => {
        setTurns(prev => [...prev, {
          userMessage,
          assistantSpeech: speech,
          drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
          rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [],
          globalSearch: undefined,
          timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                   + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
        }]);
        setStatus('idle');
      };

      // Helper — commit the pending rule (used by yes-path AND clarification-memory-hit-path).
      const commitPending = async (sessionUserId: string, sourceLabel: 'confirmed' | 'memory') => {
        if (!pending.resolved) return false;
        const triggerConfig = {
          ...(pending.originalAction?.trigger_config ?? {}),
          place_name: pending.resolved.place_name,
          resolved_lat: pending.resolved.lat,
          resolved_lng: pending.resolved.lng,
        };
        const { error } = await supabase.from('action_rules').insert({
          user_id:        sessionUserId,
          trigger_type:   'location',
          trigger_config: triggerConfig,
          action_type:    String(pending.originalAction?.action_type ?? 'sms'),
          action_config:  pending.originalAction?.action_config ?? {},
          label:          String(pending.originalAction?.label ?? 'Location alert'),
          one_shot:       pending.originalAction?.one_shot ?? false,
        });
        if (error) {
          console.error('[Orchestrator] pending location insert failed:', error.message);
          return false;
        }
        // Only write to cache on explicit user confirmation (not on memory-hit during clarification).
        if (sourceLabel === 'confirmed') {
          await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
            body: JSON.stringify({
              user_id: sessionUserId,
              place_name: pending.placeName,
              save_to_cache: true,
              canonical_alias: pending.resolved.canonical_alias,
            }),
          }).catch((err) => console.error('[Orchestrator] save-to-cache failed:', err));
        }
        try {
          const { syncGeofencesForUser } = await import('@/hooks/useGeofencing');
          await syncGeofencesForUser(sessionUserId);
        } catch (err) {
          console.error('[Orchestrator] geofence sync after confirmed location rule:', err);
        }
        return true;
      };

      // ── CASE: yes + we have a resolved place → commit
      if (isYes && pending.resolved) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          pendingLocationRef.current = null;
          emitPendingTurn("I'm not signed in. Please sign in and try again.");
          return;
        }
        const ok = await commitPending(session.user.id, 'confirmed');
        const speech = ok
          ? `Alert set — ${pending.resolved.place_name}.`
          : `Couldn't save the rule — something went wrong. Try again?`;
        pendingLocationRef.current = null;
        emitPendingTurn(speech);
        return;
      }

      // ── CASE: no / cancel → drop and move on
      if (isNo) {
        pendingLocationRef.current = null;
        emitPendingTurn('Cancelled.');
        return;
      }

      // ── CASE: clarification — user provided more detail (or a new place name)
      pending.attempts += 1;
      if (pending.attempts > 3) {
        pendingLocationRef.current = null;
        emitPendingTurn("I couldn't find that. Please check the exact location and call me back.");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        pendingLocationRef.current = null;
        emitPendingTurn("I'm not signed in. Please sign in and try again.");
        return;
      }

      // Combine the original query with the new clarification so we search
      // for "Costco Merivale" not just "Merivale".
      const combinedQuery = `${pending.placeName} ${msg}`.trim();

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
          body: JSON.stringify({ user_id: session.user.id, place_name: combinedQuery, save_to_cache: false }),
        });
        const data = await res.json();

        if (data?.status === 'ok' && (data.source === 'fresh' || data.source === 'memory' || data.source === 'settings_home' || data.source === 'settings_work')) {
          pending.placeName = combinedQuery;
          pending.resolved = {
            place_name:      data.place_name,
            address:         data.address,
            lat:             data.lat,
            lng:             data.lng,
            canonical_alias: data.canonical_alias,
            radius_meters:   data.radius_meters,
          };
          pendingLocationRef.current = pending;

          if (data.source === 'memory' || data.source === 'settings_home' || data.source === 'settings_work') {
            // Already in memory/settings — treat as verified without re-asking.
            const ok = await commitPending(session.user.id, 'memory');
            pendingLocationRef.current = null;
            const sourceText = data.source === 'memory' ? 'from your saved locations' :
                               data.source === 'settings_home' ? 'from Settings (home)' :
                               'from Settings (work)';
            emitPendingTurn(ok
              ? `${data.place_name} ${sourceText} — I'll alert you when you arrive.`
              : `Couldn't save the rule — something went wrong.`);
            return;
          }

          // Fresh — ask for confirmation.
          emitPendingTurn(`Found ${data.place_name}${data.address ? ' at ' + data.address : ''}. Shall I set the alert?`);
          return;
        }

        if (data?.status === 'personal_unset') {
          pendingLocationRef.current = null;
          const which = data.personal === 'work' ? 'work' : 'home';
          emitPendingTurn(`Please add your ${which} address in Settings first, then try again.`);
          return;
        }

        // not_found or error — ask for different input
        emitPendingTurn(`I couldn't find "${combinedQuery}" near you. Can you try a different street or neighborhood?`);
        return;
      } catch (err) {
        console.error('[Orchestrator] pending location clarification failed:', err);
        pendingLocationRef.current = null;
        emitPendingTurn('Could not reach the location service. Try again later.');
        return;
      }
    }
    // ── end pending location handler ──────────────────────────────────────────

    // This turn's cards — collected during processing
    // Set to a string to override Claude's speech for this turn (used by the
    // location-rule intercept, where the orchestrator produces the reply).
    let turnSpeechOverride: string | null = null;
    // Flag indicating the location intercept ran — skips geofence sync based
    // on Claude-emitted SET_ACTION_RULE (the intercept handles its own sync).
    let locationIntercepted = false;
    const turnNav: NavigationResult[] = [];
    const turnDrive: StorageFile[] = [];
    const turnDrafts: NaaviAction[] = [];
    const turnEvents: { summary: string; htmlLink?: string }[] = [];
    const turnDeleted: { count: number; titles: string[] }[] = [];
    const turnDocs: { title: string; webViewLink?: string }[] = [];
    const turnMemory: { text: string; count: number }[] = [];
    const turnLists: { action: string; listName: string; items?: string[]; webViewLink?: string }[] = [];
    let turnGlobalSearch: {
      query: string;
      results: GlobalSearchResult[];
      /**
       * Where the turnGlobalSearch came from:
       *   'pre-search'    — orchestrator ran global-search BEFORE Claude and
       *                     injected results into Claude's prompt. Claude's
       *                     own speech already incorporates them, so we
       *                     skip the tail-append (avoid double reading).
       *   'claude-action' — Claude explicitly emitted a GLOBAL_SEARCH action.
       *                     Its speech is typically a filler ("Let me
       *                     check..."); the tail-append IS the answer.
       */
      origin: 'pre-search' | 'claude-action';
    } | undefined;

    try {
      let enrichedMessage = userMessage;

      // ── STEP 1: Person context lookup (async) ──────────────────────────────────
      const personName = extractPersonQuery(userMessage);
      console.log('[Orchestrator] extractPersonQuery result:', personName);
      if (personName) {
        const [ctx, contact] = await Promise.all([
          getPersonContext(personName),
          lookupContact(personName),
        ]);

        const lines: string[] = [];
        if (ctx) lines.push(formatPersonContext(ctx));

        if (contact && (contact.email || contact.phone)) {
          lines.push(`## Contact info for ${personName}`);
          if (contact.email) lines.push(`Email: ${contact.email}`);
          if (contact.phone) lines.push(`Phone: ${contact.phone}`);
        }

        console.log('[Orchestrator] contact lookup result:', contact);
        if (lines.length > 0) {
          enrichedMessage = `${userMessage}\n\n${lines.join('\n')}`;
        } else {
          enrichedMessage = `${userMessage}\n\n## Contact lookup result\nSearched for "${personName}" in contacts, calendar, emails, and notes — no data found.`;
        }
      }

      // ── STEP 2: Phone number lookup ────────────────────────────────────────────
      // Extract digits from message; if 10 consecutive or spaced digits found, treat as phone
      const digitsOnly = userMessage.replace(/[\s\-().+]/g, '');
      const phoneDigitsMatch = digitsOnly.match(/1?(\d{10})/);
      const phoneMatch = userMessage.match(/\b(\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})\b/) ||
                         (phoneDigitsMatch ? [null, phoneDigitsMatch[1]] : null);
      if (phoneMatch) {
        const phone = phoneMatch[1];
        console.log('[Orchestrator] Phone number detected, looking up:', phone);
        const contact = await lookupContactByPhone(phone);
        console.log('[Orchestrator] Phone lookup result:', contact);
        if (contact) {
          enrichedMessage = `${userMessage}\n\n## Contact found for ${phone}\nName: ${contact.name}${contact.email ? '\nEmail: ' + contact.email : ''}${contact.phone ? '\nPhone: ' + contact.phone : ''}`;
        } else {
          enrichedMessage = `${userMessage}\n\n## Phone lookup result\nSearched for "${phone}" in contacts — no contact found with that number.`;
        }
      }

      // Check if this is a broad knowledge query — fetch memories directly
      const isBroadQuery = /\b(all|list all|list everything|everything|what do you know|preferences?|what.*know.*me|know about me|what is my|what are my)\b/i.test(userMessage);

      // ── Retrieval pre-search — orchestrator-driven, Claude-free ──────────
      // When the user asks about their own data (retrieval intent), run
      // global-search FIRST with the literal user message and inject the
      // results into Claude's context. This is the same pattern the voice
      // server uses. Without it, Claude sometimes answers "nothing found"
      // from its own reasoning while the search did find results — which
      // for a blind user hearing only Claude's voice is catastrophic.
      // (reuses `digitsOnly` from the phone-lookup block above)
      const hasLongDigitRun = /\d{7,}/.test(digitsOnly);
      const hasAtSign = /@/.test(userMessage);
      const retrievalRe = /\b(find|look\s*up|search|show\s*me|what\s+do\s+(we|you|i)\s+have|what\s+do\s+you\s+know|do\s+(we|you|i)\s+have|is\s+there|tell\s+me\s+about|information\s+on|anything\s+(about|on))\b/i;
      const isRetrievalQuery = hasLongDigitRun || hasAtSign || retrievalRe.test(userMessage);

      // Strip question/retrieval verbs and trailing filler so the search
      // query matches real content. The raw user message "Find Gordon Doig's
      // phone number" was being sent as-is to substring search, and no
      // contact has a name literally containing that entire phrase. Extract
      // just the noun phrase at the core.
      const searchQuery = userMessage
        .replace(/^\s*(can you\s+)?(please\s+)?(find|look\s*up|search\s+(for)?|show\s*me|tell\s*me\s*(about)?|what\s+do\s+(we|you|i)\s+have\s+(on|about)?|what\s+do\s+you\s+know\s+about|do\s+(we|you|i)\s+have|is\s+there|information\s+on|anything\s+(about|on))\s+/i, '')
        .replace(/['\u2019]s\s+(phone|email|number|address|contact|info|information|details?)\s*$/i, '')
        .replace(/\s+(phone|email|number|address|contact|info|information|details?)\s*$/i, '')
        .replace(/[?.!,;]+\s*$/, '')
        .trim() || userMessage.trim();

      let preSearchResults: GlobalSearchResult[] = [];
      if (isRetrievalQuery && supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const { data, error } = await supabase.functions.invoke('global-search', {
              body: { query: searchQuery, user_id: session.user.id, limit: 8 },
            });
            if (!error && Array.isArray(data?.ranked)) {
              preSearchResults = (data.ranked as GlobalSearchResult[]).slice(0, 8);
              console.log('[Orchestrator] pre-search query=', JSON.stringify(searchQuery), 'returned', preSearchResults.length, 'results');
            }
          }
        } catch (err) {
          console.error('[Orchestrator] pre-search failed:', err);
        }

        if (preSearchResults.length > 0) {
          const lines = preSearchResults.map(r => `- [${r.source}] ${r.title}${r.snippet ? ' — ' + r.snippet : ''}`);
          enrichedMessage = `${enrichedMessage}\n\n## Live search results for the user's question (these are authoritative — use them to answer; do NOT say "I couldn't find" if results are listed here)\n${lines.join('\n')}`;
          turnGlobalSearch = { query: userMessage, results: preSearchResults, origin: 'pre-search' };
        } else {
          enrichedMessage = `${enrichedMessage}\n\n## Live search results for the user's question\nSearched calendar, contacts, memory, lists, email, rules, and sent messages. Nothing matched. Say that plainly — do not guess.`;
        }
      }

      const [response, knowledgeResult] = await Promise.all([
        sendToNaavi(enrichedMessage, historyRef.current, briefRef.current, language),
        isBroadQuery ? fetchAllKnowledge(100) : Promise.resolve([]),
      ]);
      console.log('[Orchestrator] actions:', JSON.stringify(response.actions));
      console.log('[Orchestrator] knowledgeItems from direct fetch:', knowledgeResult.length);

      // ── Execute actions ────────────────────────────────────────────────────────

      for (const action of response.actions) {
        if (action.type === 'SAVE_TO_DRIVE') {
          const title = String(action.title ?? 'Naavi Note');
          try {
            const file = await registry.storage.save(title, String(action.content ?? ''), '');
            turnDocs.push({ title, webViewLink: file.webViewLink });
            await saveDriveNote({ title, webViewLink: file.webViewLink });
          } catch (err) {
            console.error('[Orchestrator] SAVE_TO_DRIVE failed:', err);
          }
        }

        if (action.type === 'REMEMBER') {
          const text = String(action.text ?? '');
          if (text) {
            ingestNote(text, 'stated').then(fragments => {
              turnMemory.push({ text, count: fragments.length });
              setTurns(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) updated[updated.length - 1] = { ...last, rememberedItems: [...last.rememberedItems, { text, count: fragments.length }] };
                return updated;
              });
            });
          }
        }

        if (action.type === 'CREATE_EVENT') {
          try {
            const event = await registry.calendar.createEvent({
              title:       String(action.summary     ?? ''),
              description: String(action.description ?? ''),
              startISO:    String(action.start       ?? ''),
              endISO:      String(action.end         ?? ''),
              attendees:   Array.isArray(action.attendees)
                ? action.attendees.map(e => ({ name: '', email: String(e) }))
                : [],
              recurrence:  Array.isArray(action.recurrence)
                ? action.recurrence.map(String)
                : undefined,
            });
            turnEvents.push({ summary: event.title, htmlLink: event.htmlLink });
          } catch (err) {
            console.error('[Orchestrator] CREATE_EVENT failed:', err);
          }
        }

        if (action.type === 'FETCH_TRAVEL_TIME') {
          const destination   = String(action.destination   ?? '').trim();
          const eventStartISO = String(action.eventStartISO ?? '').trim();
          const departureISO  = String(action.departureISO  ?? '').trim();
          if (destination) {
            try {
              const result = await registry.maps.fetchTravelTime(destination, eventStartISO, avoidHighways, departureISO);
              if (result) turnNav.push(result);
            } catch (err) {
              console.error('[Orchestrator] FETCH_TRAVEL_TIME failed:', err);
            }
          }
        }

        if (action.type === 'DRIVE_SEARCH') {
          const query = String(action.query ?? '').trim();
          if (query) {
            const files = await registry.storage.search(query, '');
            turnDrive.push(...files);
          }
        }

        if (action.type === 'GLOBAL_SEARCH') {
          // Cross-source search: calls global-search Edge Function, which
          // fans out to knowledge, rules, sent_messages, contacts, lists,
          // calendar, and gmail adapters and returns a ranked list.
          const query = String(action.query ?? '').trim();
          if (query && supabase) {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user) {
                const { data, error } = await supabase.functions.invoke('global-search', {
                  body: { query, user_id: session.user.id, limit: 8 },
                });
                if (error) {
                  console.error('[Orchestrator] GLOBAL_SEARCH failed:', error.message);
                } else if (data?.ranked) {
                  const results = (data.ranked as GlobalSearchResult[]).slice(0, 8);
                  turnGlobalSearch = { query, results, origin: 'claude-action' };
                }
              }
            } catch (err) {
              console.error('[Orchestrator] GLOBAL_SEARCH error:', err);
            }
          }
        }

        if (action.type === 'DELETE_EVENT') {
          const query = String(action.query ?? '').trim();
          if (query) {
            try {
              const result = await registry.calendar.deleteEvent(query);
              if (result.deleted > 0) turnDeleted.push({ count: result.deleted, titles: result.titles });
            } catch (err) {
              console.error('[Orchestrator] DELETE_EVENT failed:', err);
            }
          }
        }

        if (action.type === 'SCHEDULE_MEDICATION') {
          const medName       = String(action.name ?? 'Medication');
          const doseNote      = String(action.dose_instruction ?? '');
          const times         = Array.isArray(action.times) ? action.times as string[] : ['08:00', '20:00'];
          const onDays        = Number(action.on_days  ?? 5);
          const offDays       = Number(action.off_days ?? 3);
          const durationDays  = Number(action.duration_days ?? 30);
          const startDate     = String(action.start_date ?? new Date().toISOString().split('T')[0]);

          // Calculate all active dose dates
          const events: { title: string; start: string; end: string }[] = [];
          let dayOffset = 0;
          let cycleDay  = 0; // position within the current on+off cycle

          while (dayOffset < durationDays) {
            const isOnDay = cycleDay < onDays;
            if (isOnDay) {
              const base = new Date(`${startDate}T00:00:00`);
              base.setDate(base.getDate() + dayOffset);
              const dateStr = base.toISOString().split('T')[0];

              for (const time of times) {
                const [h, m] = time.split(':').map(Number);
                const start = new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
                const end   = new Date(start.getTime() + 30 * 60 * 1000); // 30 min block
                events.push({
                  title: `💊 ${medName}`,
                  start: start.toISOString(),
                  end:   end.toISOString(),
                });
              }
            }
            cycleDay = (cycleDay + 1) % (onDays + offDays);
            dayOffset++;
          }

          console.log(`[Orchestrator] SCHEDULE_MEDICATION: creating ${events.length} events for ${medName}`);

          // Create all events (batched sequentially to avoid rate limits)
          let created = 0;
          for (const ev of events) {
            try {
              const result = await registry.calendar.createEvent({
                title:       ev.title,
                description: doseNote,
                startISO:    ev.start,
                endISO:      ev.end,
                attendees:   [],
              });
              turnEvents.push({ summary: result.title, htmlLink: result.htmlLink });
              created++;
            } catch (err) {
              console.error('[Orchestrator] SCHEDULE_MEDICATION event failed:', err);
            }
          }
          console.log(`[Orchestrator] SCHEDULE_MEDICATION: created ${created}/${events.length} events`);
        }

        if (action.type === 'LIST_CREATE') {
          const name = String(action.name ?? 'My List');
          const category = String(action.category ?? 'other');
          try {
            const result = await createList(name, category);
            if (result.success && result.list) {
              turnLists.push({ action: 'created', listName: name, webViewLink: result.list.web_view_link ?? undefined });
            } else {
              console.error('[Orchestrator] LIST_CREATE failed:', result.error);
            }
          } catch (err) {
            console.error('[Orchestrator] LIST_CREATE failed:', err);
          }
        }

        if (action.type === 'LIST_ADD') {
          const listName = String(action.listName ?? '');
          const items = Array.isArray(action.items) ? action.items.map(String) : [];
          if (listName && items.length > 0) {
            try {
              const result = await addToList(listName, items);
              if (result.success) {
                turnLists.push({ action: 'added', listName, items, webViewLink: result.list?.web_view_link ?? undefined });
              } else {
                console.error('[Orchestrator] LIST_ADD failed:', result.error);
              }
            } catch (err) {
              console.error('[Orchestrator] LIST_ADD failed:', err);
            }
          }
        }

        if (action.type === 'LIST_REMOVE') {
          const listName = String(action.listName ?? '');
          const items = Array.isArray(action.items) ? action.items.map(String) : [];
          if (listName && items.length > 0) {
            try {
              const result = await removeFromList(listName, items);
              if (result.success) {
                turnLists.push({ action: 'removed', listName, items, webViewLink: result.list?.web_view_link ?? undefined });
              } else {
                console.error('[Orchestrator] LIST_REMOVE failed:', result.error);
              }
            } catch (err) {
              console.error('[Orchestrator] LIST_REMOVE failed:', err);
            }
          }
        }

        if (action.type === 'LIST_READ') {
          const listName = String(action.listName ?? '');
          if (listName) {
            try {
              const result = await readList(listName);
              if (result.success) {
                turnLists.push({ action: 'read', listName, items: result.items, webViewLink: result.list?.web_view_link ?? undefined });
              } else {
                console.error('[Orchestrator] LIST_READ failed:', result.error);
              }
            } catch (err) {
              console.error('[Orchestrator] LIST_READ failed:', err);
            }
          }
        }

        if (action.type === 'DELETE_MEMORY') {
          const keyword = String(action.keyword ?? action.query ?? '');
          if (keyword) {
            const deleted = await deleteKnowledge(keyword);
            console.log(`[Orchestrator] DELETE_MEMORY: removed ${deleted} fragments matching "${keyword}"`);
          }
        }

        if (action.type === 'DRAFT_MESSAGE' || action.type === 'ADD_CONTACT') {
          turnDrafts.push(action);
        }

        if (action.type === 'ADD_CONTACT') {
          const name = String(action.name ?? '');
          await saveContact({ name, email: String(action.email ?? ''), phone: String(action.phone ?? ''), relationship: String(action.relationship ?? '') });
          await savePerson({ name, email: String(action.email ?? ''), phone: String(action.phone ?? ''), relationship: String(action.relationship ?? '') });
        } else if (action.type === 'SET_REMINDER') {
          const reminderTitle = String(action.title ?? '');
          const reminderDatetime = String(action.datetime ?? '');
          const reminderPhone = String(action.phoneNumber ?? '');
          await saveReminder({ title: reminderTitle, datetime: reminderDatetime, source: String(action.source ?? ''), phone_number: reminderPhone || undefined });
          // Create a Google Calendar event so Robert gets a native notification
          if (reminderDatetime) {
            try {
              const start = reminderDatetime;
              const end = new Date(new Date(start).getTime() + 15 * 60000).toISOString();
              const event = await registry.calendar.createEvent({
                title:       reminderTitle || 'Reminder',
                description: reminderTitle,
                startISO:    start,
                endISO:      end,
                attendees:   [],
              });
              turnEvents.push({ summary: event.title, htmlLink: event.htmlLink });
            } catch (err) {
              console.error('[Orchestrator] SET_REMINDER calendar event failed:', err);
            }
            // Schedule a Web Push notification at the reminder time
            const delayMs = new Date(reminderDatetime).getTime() - Date.now();
            if (delayMs > 0 && delayMs < 24 * 60 * 60 * 1000) {
              // Only schedule if within 24 hours
              setTimeout(() => {
                sendPushNotification(reminderTitle, 'Time for your reminder', '/').catch(() => {});
              }, delayMs);
            }
          }
        } else if (action.type === 'LOG_CONCERN') {
          await saveTopic({ subject: String(action.category ?? 'general'), note: String(action.note ?? ''), category: String(action.severity ?? 'low') });
        } else if (action.type === 'UPDATE_PROFILE') {
          await saveTopic({ subject: String(action.key ?? 'preference'), note: String(action.value ?? ''), category: 'preference' });
        } else if (action.type === 'SET_EMAIL_ALERT') {
          // Writes go to action_rules (unified trigger/action framework).
          // email_watch_rules has been retired; evaluate-rules reads action_rules.
          if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              const triggerConfig: Record<string, string> = {};
              if (action.fromName)       triggerConfig.from_name = String(action.fromName);
              if (action.fromEmail)      triggerConfig.from_email = String(action.fromEmail);
              if (action.subjectKeyword) triggerConfig.subject_keyword = String(action.subjectKeyword);

              // Resolve phone dynamically from user_settings — never hardcode.
              let toPhone = action.phoneNumber ? String(action.phoneNumber) : '';
              if (!toPhone) {
                const { data: settings } = await supabase
                  .from('user_settings')
                  .select('phone')
                  .eq('user_id', session.user.id)
                  .single();
                toPhone = settings?.phone ?? '';
              }

              const label = String(action.label ?? 'Email alert');
              const { error } = await supabase.from('action_rules').insert({
                user_id:        session.user.id,
                trigger_type:   'email',
                trigger_config: triggerConfig,
                action_type:    'sms',
                action_config:  { to_phone: toPhone, body: `New email alert: ${label}` },
                label,
                one_shot:       false,
                enabled:        true,
              });
              if (error) console.error('[Orchestrator] SET_EMAIL_ALERT failed:', error.message);
              else console.log('[Orchestrator] SET_EMAIL_ALERT saved to action_rules:', label);
            }
          }
        } else if (action.type === 'SET_ACTION_RULE') {
          if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              // Resolve contact for the action target
              const actionConfig = (action.action_config ?? {}) as Record<string, any>;
              const toName = String(actionConfig.to ?? '');
              const actionType = String(action.action_type ?? 'sms');

              if (toName && !actionConfig.to_phone && !actionConfig.to_email) {
                const contact = await lookupContact(toName);
                if (contact) {
                  if ((actionType === 'sms' || actionType === 'whatsapp') && contact.phone) {
                    actionConfig.to_phone = contact.phone;
                    actionConfig.to_name = toName;
                  } else if (actionType === 'email' && contact.email) {
                    actionConfig.to_email = contact.email;
                    actionConfig.to_name = toName;
                  }
                }
              }

              const triggerType = String(action.trigger_type ?? 'email');

              // ── LOCATION RULE: verified-address-only flow ─────────────────
              // Intercept the insert. Call resolve-place; branch on outcome.
              // See project_naavi_location_verified_address.md.
              if (triggerType === 'location') {
                const placeName = String((action.trigger_config ?? {}).place_name ?? '').trim();
                if (!placeName) {
                  locationIntercepted = true;
                  turnSpeechOverride = "I didn't catch the place for that alert. Can you say it again?";
                  continue;
                }
                try {
                  const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
                    body: JSON.stringify({
                      user_id: session.user.id,
                      place_name: placeName,
                      save_to_cache: false,
                    }),
                  });
                  const data = await res.json();

                  // 1. Memory / Settings hit → insert immediately with resolved coords.
                  if (data?.status === 'ok' && (data.source === 'memory' || data.source === 'settings_home' || data.source === 'settings_work')) {
                    const triggerConfig = {
                      ...(action.trigger_config ?? {}),
                      place_name: data.place_name,
                      resolved_lat: data.lat,
                      resolved_lng: data.lng,
                    };
                    const { error: insertErr } = await supabase.from('action_rules').insert({
                      user_id:        session.user.id,
                      trigger_type:   'location',
                      trigger_config: triggerConfig,
                      action_type:    actionType,
                      action_config:  actionConfig,
                      label:          String(action.label ?? 'Location alert'),
                      one_shot:       action.one_shot ?? false,
                    });
                    if (insertErr) {
                      console.error('[Orchestrator] memory-hit insert failed:', insertErr.message);
                    } else {
                      try {
                        const { syncGeofencesForUser } = await import('@/hooks/useGeofencing');
                        await syncGeofencesForUser(session.user.id);
                      } catch (err) {
                        console.error('[Orchestrator] geofence sync after memory-hit insert:', err);
                      }
                    }
                    locationIntercepted = true;
                    const sourceText = data.source === 'memory'
                      ? 'from your saved locations'
                      : data.source === 'settings_home' ? 'from Settings (home)' : 'from Settings (work)';
                    turnSpeechOverride = `${data.place_name} ${sourceText} — I'll alert you when you arrive.`;
                    continue;
                  }

                  // 2. Fresh resolve → defer to next turn for user confirmation.
                  if (data?.status === 'ok' && data.source === 'fresh') {
                    pendingLocationRef.current = {
                      originalAction: action,
                      placeName,
                      resolved: {
                        place_name:      data.place_name,
                        address:         data.address,
                        lat:             data.lat,
                        lng:             data.lng,
                        canonical_alias: data.canonical_alias,
                        radius_meters:   data.radius_meters,
                      },
                      attempts: 1,
                    };
                    locationIntercepted = true;
                    turnSpeechOverride = `Found ${data.place_name}${data.address ? ' at ' + data.address : ''}. Shall I set the alert?`;
                    continue;
                  }

                  // 3. Personal address unset (home/office without address saved).
                  if (data?.status === 'personal_unset') {
                    const which = data.personal === 'work' ? 'work' : 'home';
                    locationIntercepted = true;
                    turnSpeechOverride = `Please add your ${which} address in Settings first, then try again.`;
                    continue;
                  }

                  // 4. Not found → enter the 3-attempt clarification loop.
                  if (data?.status === 'not_found') {
                    pendingLocationRef.current = {
                      originalAction: action,
                      placeName,
                      resolved: null,
                      attempts: 1,
                    };
                    locationIntercepted = true;
                    turnSpeechOverride = `I couldn't find "${placeName}" near you. Can you try a different street or neighborhood?`;
                    continue;
                  }

                  // 5. Unknown error — fall through with a neutral reply.
                  console.error('[Orchestrator] resolve-place returned unexpected status:', data);
                  locationIntercepted = true;
                  turnSpeechOverride = "Something went wrong finding that place. Try again with a street address.";
                  continue;
                } catch (err) {
                  console.error('[Orchestrator] resolve-place fetch failed:', err);
                  locationIntercepted = true;
                  turnSpeechOverride = "Couldn't reach the location service. Try again in a moment.";
                  continue;
                }
              }

              // ── Non-location triggers: original insert path ──────────────
              const { error } = await supabase.from('action_rules').insert({
                user_id:        session.user.id,
                trigger_type:   triggerType,
                trigger_config: action.trigger_config ?? {},
                action_type:    actionType,
                action_config:  actionConfig,
                label:          String(action.label ?? 'Action rule'),
                one_shot:       action.one_shot ?? false,
              });
              if (error) console.error('[Orchestrator] SET_ACTION_RULE failed:', error.message);
              else console.log('[Orchestrator] SET_ACTION_RULE saved:', action.label);
            }
          }
        }
      }

      // ── Append turn with all its cards ────────────────────────────────────────
      // Strip "Say yes to send" from displayed text when not in hands-free
      let displaySpeech = response.speech;
      if (!handsfreeRef.current && turnDrafts.some(d => isConfirmable(d))) {
        displaySpeech = displaySpeech.replace(/\.?\s*Say yes to send,? or tell me what to change\.?/gi, '.').trim();
      }
      // Location rule intercept — always wins over Claude's speech.
      if (turnSpeechOverride !== null) {
        displaySpeech = turnSpeechOverride;
      }
      console.log('[Orchestrator] response.speech:', response.speech);
      console.log('[Orchestrator] displaySpeech (for bubble):', displaySpeech);
      const newTurn: ConversationTurn = {
        userMessage,
        assistantSpeech: displaySpeech,
        drafts:           turnDrafts,
        createdEvents:    turnEvents,
        deletedEvents:    turnDeleted,
        savedDocs:        turnDocs,
        rememberedItems:  turnMemory,
        driveFiles:       turnDrive,
        navigationResults: turnNav,
        listResults:      turnLists,
        globalSearch:     turnGlobalSearch,
        timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
      setTurns(prev => [...prev, newTurn]);
      saveConversationTurn(newTurn).catch(() => {});

      // Build final speech — append list items for LIST_READ so Naavi reads them aloud
      // Location intercept takes precedence over Claude's speech (no list-append).
      let finalSpeech = turnSpeechOverride !== null ? turnSpeechOverride : response.speech;
      if (turnSpeechOverride === null) {
        for (const lr of turnLists) {
          if (lr.action === 'read' && lr.items && lr.items.length > 0) {
            const itemsText = lr.items.map((item: string, i: number) => `${i + 1}. ${item}`).join('. ');
            finalSpeech += ` Here are the items: ${itemsText}.`;
          }
        }
      }
      // Append top GLOBAL_SEARCH hits so they are spoken, with a source
      // label. ONLY when Claude emitted a GLOBAL_SEARCH action — in that
      // case its own speech is a filler ("Let me check…") and this
      // tail-append is the actual answer.
      //
      // When turnGlobalSearch.origin === 'pre-search', the orchestrator
      // already injected results into Claude's prompt and Claude's reply
      // incorporates them. Appending again makes Robert hear the same
      // data twice. Skip.
      const appendTail =
        turnGlobalSearch &&
        turnGlobalSearch.origin === 'claude-action';
      if (appendTail && turnGlobalSearch!.results.length > 0) {
        const labelFor = (src: string) => {
          if (src === 'calendar') return 'calendar';
          if (src === 'contacts') return 'contacts';
          if (src === 'lists') return 'lists';
          if (src === 'gmail') return 'email';
          if (src === 'sent_messages') return 'sent messages';
          if (src === 'rules') return 'automations';
          if (src === 'knowledge') return 'memory';
          return src;
        };
        const top = turnGlobalSearch!.results.slice(0, 3);
        const phrases = top.map(r => {
          const text = (r.snippet && r.snippet.trim()) || r.title;
          return `In ${labelFor(r.source)}: ${text}`;
        });
        finalSpeech += ` ${phrases.join('. ')}.`;
        if (turnGlobalSearch!.results.length > top.length) {
          finalSpeech += ` Plus ${turnGlobalSearch!.results.length - top.length} more.`;
        }
      } else if (appendTail) {
        finalSpeech += ` I didn't find anything for ${turnGlobalSearch!.query}.`;
      }

      // Strip "Say yes to send" prompt when not in hands-free (Robert uses the Send button)
      if (!handsfreeRef.current && turnDrafts.some(d => isConfirmable(d))) {
        finalSpeech = finalSpeech.replace(/\.?\s*Say yes to send,? or tell me what to change\.?/gi, '.').trim();
      }
      console.log('[Orchestrator] finalSpeech (for TTS):', finalSpeech);

      // Check if this turn has a confirmable action (Phase A: DRAFT_MESSAGE)
      const confirmableDraft = turnDrafts.find(d => isConfirmable(d));
      const turnIndex = turns.length; // index of the turn being added

      if (confirmableDraft && handsfreeRef.current) {
        // Pre-resolve contact info so we can verify before asking Robert to confirm
        const action = confirmableDraft;
        const channel = String(action.channel ?? 'email').toLowerCase() as 'email' | 'sms' | 'whatsapp';
        const to = String(action.to ?? '').trim();
        const isMsg = channel === 'sms' || channel === 'whatsapp';

        let resolvedPhone: string | null = null;
        let resolvedEmail: string | null = null;

        if (isMsg) {
          const stripped = to.replace(/[^+\d]/g, '');
          resolvedPhone = stripped.startsWith('+') ? stripped
                        : /^\d{10}$/.test(stripped) ? `+1${stripped}`
                        : /^\d{7,15}$/.test(stripped) ? `+${stripped}`
                        : null;
          if (!resolvedPhone) {
            const contact = await lookupContact(to);
            resolvedPhone = contact?.phone ?? null;
          }
        } else {
          resolvedEmail = to.includes('@') ? to : null;
          if (!resolvedEmail) {
            const contact = await lookupContact(to);
            resolvedEmail = contact?.email ?? null;
          }
        }

        // If we can't resolve the recipient, don't enter confirm flow — tell Robert
        if (isMsg && !resolvedPhone) {
          console.log(`[VoiceConfirm] No phone found for "${to}" — skipping confirm`);
          finalSpeech += ` But I don't have a phone number for ${to}. Try saying "Remember ${to}'s phone is plus followed by the number" first.`;
          // Don't create pending action — fall through to idle
        } else if (!isMsg && !resolvedEmail) {
          console.log(`[VoiceConfirm] No email found for "${to}" — skipping confirm`);
          finalSpeech += ` But I don't have an email address for ${to}.`;
        } else {
          // Build execute function with pre-resolved contact
          const pending: PendingAction = {
            id: `pending-${Date.now()}`,
            action: confirmableDraft,
            summary: buildActionSummary(confirmableDraft),
            turnIndex,
            execute: async () => {
              try {
                if (isMsg) {
                  console.log(`[VoiceConfirm] Sending ${channel} to ${resolvedPhone}, body: "${String(action.body ?? '').slice(0, 30)}"`);
                  const { data, error: fnErr } = await supabase.functions.invoke('send-sms', {
                    body: { to: resolvedPhone, body: String(action.body ?? ''), channel },
                  });
                  console.log(`[VoiceConfirm] send-sms result:`, JSON.stringify({ data, error: fnErr?.message }));
                  if (fnErr || !data?.success) return { ok: false, speech: SPEECH.GENERIC_ERROR };
                  return { ok: true, speech: SPEECH.SENT };
                } else {
                  console.log(`[VoiceConfirm] Sending email to ${resolvedEmail}`);
                  const result = await registry.email.send({
                    to:      [{ name: resolvedEmail !== to ? to : '', email: resolvedEmail! }],
                    subject: String(action.subject ?? ''),
                    body:    String(action.body    ?? ''),
                  });
                  console.log(`[VoiceConfirm] email result:`, JSON.stringify(result));
                  return result.success
                    ? { ok: true, speech: SPEECH.SENT }
                    : { ok: false, speech: SPEECH.GENERIC_ERROR };
                }
              } catch (execErr) {
                console.error(`[VoiceConfirm] execute error:`, execErr);
                return { ok: false, speech: SPEECH.GENERIC_ERROR };
              }
            },
          };

          pendingActionRef.current = pending;
          setPendingAction(pending);
        }
      }

      // Speak concurrently — text appears and voice starts at the same time
      setStatus('speaking');
      speakResponse(finalSpeech, language).then(() => {
        // Only enter voice-confirm flow if hands-free is active
        // In tap-to-talk mode, Robert uses the Send button on the DraftCard
        if (pendingActionRef.current && handsfreeRef.current) {
          setStatus('pending_confirm');
        } else {
          // Clear pending action if not in hands-free — DraftCard handles sending
          if (pendingActionRef.current && !handsfreeRef.current) {
            pendingActionRef.current = null;
            setPendingAction(null);
          }
          setStatus('idle');
        }
      }).catch(() => setStatus('idle'));

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStatus('error');
    }
  }, [status, language]);

  // ── Voice-confirm actions ──────────────────────────────────────────────────

  const confirmPending = useCallback(async () => {
    const pending = pendingActionRef.current;
    if (!pending) return;

    pendingActionRef.current = null;
    setPendingAction(null);
    setStatus('speaking');

    const result = await pending.execute();

    // Mark the DraftCard as sent in the turn (update the turn's draft)
    if (result.ok) {
      setTurns(prev => {
        const updated = [...prev];
        const turn = updated[pending.turnIndex];
        if (turn) {
          // Mark draft as voice-confirmed so DraftCard shows "sent" state
          const draftIndex = turn.drafts.indexOf(pending.action);
          if (draftIndex >= 0) {
            const updatedDraft = { ...turn.drafts[draftIndex], _voiceConfirmed: true };
            const updatedDrafts = [...turn.drafts];
            updatedDrafts[draftIndex] = updatedDraft;
            updated[pending.turnIndex] = { ...turn, drafts: updatedDrafts };
          }
        }
        return updated;
      });
    }

    // Speak the outcome
    await speakResponse(result.speech, language);
    setStatus('idle');
  }, [language]);

  const cancelPending = useCallback(async (speechOverride?: string) => {
    pendingActionRef.current = null;
    setPendingAction(null);
    const speech = speechOverride ?? SPEECH.CANCELLED;
    if (speech) {
      setStatus('speaking');
      await speakResponse(speech, language);
    }
    setStatus('idle');
  }, [language]);

  const editPending = useCallback(async (editText: string) => {
    pendingActionRef.current = null;
    setPendingAction(null);
    // Re-send to Claude as a follow-up message — Claude will re-draft
    await send(editText);
  }, [send]);

  const clearHistory = useCallback(() => {
    stopSpeaking();
    pendingActionRef.current = null;
    setPendingAction(null);
    setTurns([]);
    setError(null);
    setStatus('idle');
  }, []);

  const loadHistory = useCallback((savedTurns: ConversationTurn[]) => {
    setTurns(savedTurns);
  }, []);

  const stopAndReset = useCallback(() => {
    stopSpeaking();
    pendingActionRef.current = null;
    setPendingAction(null);
    setStatus('idle');
  }, []);

  return {
    status, turns, error, send, clearHistory, loadHistory,
    stopSpeaking: stopAndReset,
    // Voice-confirm
    pendingAction, confirmPending, cancelPending, editPending,
  };
}

// ─── Speech sanitiser ─────────────────────────────────────────────────────────
// Prevents TTS from reading mixed alphanumeric strings as large numbers.
// "aggan2207" → "aggan 2 2 0 7"   |   "test123" → "test 1 2 3"

function sanitiseForSpeech(text: string): string {
  return text
    // Strip markdown bold/italic (**text**, *text*, __text__, _text_)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Strip markdown headings (# ## ###)
    .replace(/^#{1,6}\s+/gm, '')
    // Strip inline code (`code`)
    .replace(/`(.+?)`/g, '$1')
    // Remove any remaining stray asterisks or underscores not caught above
    .replace(/\*+/g, '')
    .replace(/_{2,}/g, '')
    // Spell out mixed letter+digit tokens character by character
    // so usernames like "aggan2207" are read as "a g g a n 2 2 0 7"
    .replace(/\b([A-Za-z]+\d+[A-Za-z0-9]*|[A-Za-z0-9]*\d+[A-Za-z]+[A-Za-z0-9]*)\b/g,
      match => match.split('').join(' ')
    );
}

// ─── Stop speaking ───────────────────────────────────────────────────────────
let _speechStopped = false;
let _currentAudio: HTMLAudioElement | null = null;
let _currentSound: any = null;

export function stopSpeaking(): void {
  _speechStopped = true;
  // Web
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  // Native
  if (_currentSound) {
    try { _currentSound.stopAsync().catch(() => {}); } catch {}
    _currentSound = null;
  }
  Speech.stop().catch(() => {});
}

// ─── Speech helper ────────────────────────────────────────────────────────────

// Fetch TTS audio as base64 from OpenAI sage voice
async function fetchTTSBase64(chunk: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('text-to-speech', {
      body: { text: chunk, voice: 'shimmer' },
    });
    if (error || !data?.audio) return null;
    return data.audio as string;
  } catch {
    return null;
  }
}

// ── Web playback ──────────────────────────────────────────────────────────────
function playAudioUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (_speechStopped) { resolve(); return; }
    const audio = new (window as any).Audio(url);
    _currentAudio = audio;
    audio.onended = () => { _currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { _currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => resolve());
  });
}

async function speakCloud(text: string): Promise<void> {
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .reduce<string[]>((acc, s) => {
      if (acc.length > 0 && acc[acc.length - 1].length < 20) {
        acc[acc.length - 1] += ' ' + s;
      } else {
        acc.push(s);
      }
      return acc;
    }, []);
  if (chunks.length === 0) return;
  try {
    const audioPromises = chunks.map(chunk => fetchTTSBase64(chunk));
    for (const promise of audioPromises) {
      if (_speechStopped) break;
      const base64 = await promise;
      if (!base64 || _speechStopped) continue;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      await playAudioUrl(url);
    }
  } catch {
    // Browser TTS fallback
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.88;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }
}

// ── Native playback ───────────────────────────────────────────────────────────
async function playBase64AudioNative(base64: string): Promise<void> {
  const tempUri = (FileSystem.cacheDirectory ?? '') + `tts_${Date.now()}.mp3`;
  try {
    await FileSystem.writeAsStringAsync(tempUri, base64, {
      encoding: 'base64' as any,
    });
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    const sound = new Audio.Sound();
    _currentSound = sound;
    await new Promise<void>((resolve, reject) => {
      // Safety timeout — if playback never completes, resolve after 30s
      const safetyTimer = setTimeout(() => { _currentSound = null; resolve(); }, 30000);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          clearTimeout(safetyTimer);
          _currentSound = null;
          sound.unloadAsync().then(() => {
            FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
            resolve();
          });
        }
        // If loading failed, reject so the caller can fall back to expo-speech
        if (!status.isLoaded && (status as any).error) {
          clearTimeout(safetyTimer);
          _currentSound = null;
          reject(new Error((status as any).error));
        }
      });
      sound.loadAsync({ uri: tempUri })
        .then(() => sound.playAsync())
        .catch((err) => { clearTimeout(safetyTimer); _currentSound = null; reject(err); });
    });
  } catch (err) {
    console.error('[TTS Native] playback error:', err);
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    throw err; // Re-throw so speakCloudNative falls back to expo-speech
  }
}

async function speakCloudNative(text: string, language: 'en' | 'fr'): Promise<void> {
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .reduce<string[]>((acc, s) => {
      if (acc.length > 0 && acc[acc.length - 1].length < 20) {
        acc[acc.length - 1] += ' ' + s;
      } else {
        acc.push(s);
      }
      return acc;
    }, []);
  if (chunks.length === 0) return;
  try {
    const audioPromises = chunks.map(chunk => fetchTTSBase64(chunk));
    let playedAny = false;
    for (const promise of audioPromises) {
      if (_speechStopped) break;
      const base64 = await promise;
      if (base64 && !_speechStopped) {
        await playBase64AudioNative(base64);
        playedAny = true;
      }
    }
    // If no cloud TTS chunks played (all returned null), fall back to expo-speech
    if (!playedAny && !_speechStopped) {
      console.log('[TTS Native] No cloud TTS chunks played, falling back to expo-speech');
      throw new Error('No TTS audio available');
    }
  } catch (err) {
    if (_speechStopped) return;
    // Fall back to expo-speech if cloud TTS fails
    console.error('[TTS Native] cloud TTS failed, using expo-speech:', err);
    await Speech.stop();
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: language === 'fr' ? 'fr-CA' : 'en-CA',
        rate: 0.85,
        onDone: resolve,
        onError: () => resolve(),
      });
    });
  }
}

async function speakResponse(text: string, language: 'en' | 'fr'): Promise<void> {
  text = sanitiseForSpeech(text);
  if (Platform.OS === 'web') {
    return speakCloud(text);
  }
  return speakCloudNative(text, language);
}
