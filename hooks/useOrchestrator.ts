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
import { isVoiceEnabledSync } from '@/lib/voicePref';
import { saveContact, saveReminder, saveDriveNote, saveConversationTurn, supabase } from '@/lib/supabase';
import { invokeWithTimeout, queryWithTimeout } from '@/lib/invokeWithTimeout';
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

// Fresh-command pattern — detects when the user has clearly started a NEW
// rule-creation command rather than clarifying the pending one. Prevents
// the "home + Alert me when I arrive to my office" concatenation bug.
const FRESH_COMMAND_RE = /^\s*(alert|text|notify|remind|tell)\s+(me|my|the|him|her|us|them)\b/i;

/**
 * fetchWithTimeout — wraps fetch with an AbortController so a hung Edge Function
 * (Google Places API stall, network blip, etc.) can't lock the UI for minutes.
 *
 * V57.4 fix: a 3-4 minute hang on the location-rule path was traced to bare
 * fetch() calls to resolve-place with no timeout. All resolve-place calls in
 * this file now go through this helper. Default timeout 30s — Google Places
 * usually responds in <2s; anything past 30s is a stall and we surface it as
 * a friendly error instead of leaving the user stuck.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Status state machine — see docs/AAB_BUNDLE_NEXT_RELEASE.md "Session 26 design lock".
//   idle            — no active turn. All inputs unlocked.
//   thinking        — send() called, awaiting Naavi's response. Voice channels +
//                     Send + Visits LOCKED. Orange ⏹ Stop visible — taps cancel
//                     the in-flight request and return to idle (no buffer since
//                     there's no answer to consume yet).
//   speaking        — Naavi's TTS is playing OR text is rendering. Voice
//                     channels + Send + Visits LOCKED. Orange ⏹ Stop visible
//                     ONLY while audio is actually emitting (see _isAudioPlaying).
//                     Taps silence voice and transition to answer_active.
//   answer_active   — voice was manually silenced via orange Stop. The answer
//                     keeps working silently (text continues filling). NO timer
//                     yet. Voice channels + Send + Visits LOCKED. Orange shows
//                     ✕ Cancel. Robert taps Cancel OR the answer finishes
//                     silently — either trigger transitions to cooldown.
//   cooldown        — 10-second buffer that runs AFTER Cancel tap or AFTER the
//                     silent answer completes. Voice channels + Send + Visits
//                     stay LOCKED. Orange button hidden. When the timer
//                     expires, status flips to idle.
//   pending_confirm — hands-free draft yes/no/edit listening (the only exception
//                     to the lock — directed listening for a specific answer).
//   error           — terminal failure state. Released same as idle.
export type OrchestratorStatus =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'answer_active'
  | 'cooldown'
  | 'pending_confirm'
  | 'error';

// Lock predicates — UI uses these to decide button states.
//
// Voice channels (mic, hands-free, Visits) and the Send button are locked in
// every state except idle and error. pending_confirm counts as "locked" for
// these — Robert resolves the draft via the DraftCard buttons, not via the
// chat input row. Cooldown also counts as locked — buttons unlock only after
// the 10-second buffer ends.
export function isInputLocked(s: OrchestratorStatus): boolean {
  return s === 'thinking'
      || s === 'speaking'
      || s === 'answer_active'
      || s === 'cooldown'
      || s === 'pending_confirm';
}

// TextInput is NEVER locked — typing has no audio-pickup risk and pre-composing
// while reading is a feature. Helper kept for symmetry / future-proofing.
export function isTextInputLocked(_s: OrchestratorStatus): boolean {
  return false;
}

// Orange ⏹ Stop / ✕ Cancel button visibility.
//   thinking          → ⏹ Stop (cancel in-flight request)
//   speaking + audio  → ⏹ Stop (silence voice)
//   speaking + silent → hidden  (nothing audible to stop)
//   answer_active     → ✕ Cancel (release the lock)
//   cooldown          → hidden  (lock is auto-releasing)
//   idle/pending/err  → hidden
export function isOrangeButtonVisible(s: OrchestratorStatus, isAudioPlaying: boolean): boolean {
  if (s === 'thinking') return true;
  if (s === 'speaking') return isAudioPlaying;
  if (s === 'answer_active') return true;
  return false;
}

// Orange button label morphs based on state.
export function orangeButtonLabel(s: OrchestratorStatus): '⏹ Stop' | '✕ Cancel' | null {
  if (s === 'thinking' || s === 'speaking') return '⏹ Stop';
  if (s === 'answer_active') return '✕ Cancel';
  return null;
}

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
  // V57.4 — location rules created in this turn. Renders an inline card
  // showing the alert + a "Make it recurring / Make it one-time" toggle so
  // Robert can flip the mode with a tap instead of having to re-issue a
  // verbal command. Empty array on every other turn type.
  locationRules: { ruleId: string; placeName: string; oneShot: boolean }[];
  timestamp?: string;
}

export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = [], avoidHighways = false, isHandsfree = false) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);

  // Always-current status ref — callbacks (like onOrangeButtonPressed) need
  // to read the current status without being recreated on every status change.
  const statusRef = useRef<OrchestratorStatus>('idle');
  useEffect(() => { statusRef.current = status; }, [status]);

  // True ONLY while TTS is actively emitting audio. Drives the orange Stop
  // button visibility — the button hides when nothing is being spoken, even
  // if status is still 'speaking' (e.g., text rendering after audio finished,
  // or Voice Playback OFF in Settings). Set true at the top of speakCloud /
  // speakCloudNative, false when those resolve. UI re-renders via setIsAudioPlaying.
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const isAudioPlayingRef = useRef(false);
  // Always reflects the latest value. Used by speakResponse paths to update
  // synchronously before re-render.
  const setAudioPlaying = useCallback((v: boolean) => {
    isAudioPlayingRef.current = v;
    setIsAudioPlaying(v);
  }, []);

  // 10-second cooldown timer. Started when Robert taps ✕ Cancel during
  // answer_active OR when the silent answer finishes processing. Releases the
  // lock to idle when it expires. Cleared if a new turn starts.
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);
  // Start the 10-second cooldown. Status flips to 'cooldown' immediately;
  // when the timer fires, it flips to 'idle' (only if still in cooldown — a
  // new turn that already moved status forward wins).
  const startCooldown = useCallback(() => {
    clearCooldownTimer();
    setStatus('cooldown');
    cooldownTimerRef.current = setTimeout(() => {
      if (statusRef.current === 'cooldown') {
        setStatus('idle');
      }
      cooldownTimerRef.current = null;
    }, 10_000);
  }, [clearCooldownTimer]);

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

  // Cross-turn state for DELETE_RULE disambiguation. When a delete matched
  // multiple rules and all=false, Naavi asks "which one?" Next turn the user
  // may reply "all" / "all of them" / a specific hint — without this state
  // the reply just triggers another fresh DELETE_RULE and loops. Pre-send()
  // intercepts "all"/"every" here and deletes the previously-matched set.
  const pendingDeleteRef = useRef<{
    match: string;
    matchIds: string[]; // rule ids shown in the disambiguation
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

  // Turn id counter — every call to send() captures the next id and uses it
  // to detect cancel-during-thinking. If Robert taps orange ⏹ Stop while
  // status is 'thinking', we increment this counter to invalidate the in-flight
  // turn; when the response arrives, send() sees the mismatch and discards it.
  // This is NOT kill-and-replace — under the lock model, send() can never run
  // while a previous reply is still active. The UI guarantees that.
  const currentTurnIdRef = useRef(0);

  const send = useCallback(async (userMessage: string) => {
    // Pending_confirm is the directed yes/no/edit listening state — it has its
    // own resolution paths (confirmPending, cancelPending, editPending). Don't
    // start a new turn from here; the lock UI shouldn't allow it anyway.
    if (status === 'pending_confirm') return;

    // Capture this turn's id. If Robert taps orange Stop during thinking,
    // currentTurnIdRef will be bumped, and isCancelled() will return true at
    // each await checkpoint so we discard the stale response.
    const turnId = ++currentTurnIdRef.current;
    const isCancelled = () => currentTurnIdRef.current !== turnId;

    // Cancel any pending cooldown timer — we're starting a fresh turn, the
    // previous cooldown is officially obsolete.
    clearCooldownTimer();

    // Clear any pending confirm when a new message comes in (edit flow)
    if (pendingActionRef.current) {
      pendingActionRef.current = null;
      setPendingAction(null);
    }

    // Lock model: enter Thinking. UI shows orange ⏹ Stop, voice/Send buttons
    // grey out. send() does NOT call stopSpeaking() — under the lock the UI
    // prevents this code path from running while a previous reply is active.
    setStatus('thinking');
    setError(null);

    // ── DETERMINISTIC "delete all X" INTERCEPT ─────────────────────────────
    // Claude isn't reliably setting all=true from natural phrasing, so this
    // regex runs FIRST and handles the explicit "delete all [keyword]" and
    // "remove every [keyword]" cases without a round-trip to Claude. Covers
    // "delete all", "delete every", "remove all", "cancel all", "stop all",
    // optionally "my/the", and strips trailing " alerts"/"rules"/"of them".
    {
      const t = userMessage.trim();
      const delAllRe = /^(?:please\s+)?(?:delete|remove|cancel|stop|clear)\s+(?:all|every)(?:\s+of)?(?:\s+(?:my|the))?\s*(.*?)(?:\s+alerts?|\s+rules?)?\s*[.!?]*$/i;
      const m = t.match(delAllRe);
      if (m && supabase) {
        const keywordRaw = (m[1] || '').trim().toLowerCase();
        const keyword = keywordRaw.replace(/\s+(of\s+them|of\s+it|of\s+mine)$/i, '').trim();
        try {
          const { data } = await invokeWithTimeout('manage-rules', { body: { op: 'list' } }, 15_000);
          const rules: Array<Record<string, any>> = Array.isArray((data as any)?.rules) ? (data as any).rules : [];
          const needles = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
          const haystackFor = (r: Record<string, any>) => {
            const parts: string[] = [String(r.trigger_type ?? ''), String(r.label ?? '')];
            for (const v of Object.values(r.trigger_config ?? {})) if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
            for (const v of Object.values(r.action_config  ?? {})) if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
            return parts.join(' ').toLowerCase();
          };
          const matches = needles.length === 0
            ? rules
            : rules.filter(r => { const hay = haystackFor(r); return needles.every(n => hay.includes(n)); });
          let speech: string;
          if (matches.length === 0) {
            speech = keyword ? `I couldn't find an alert matching "${keyword}".` : 'You have no alerts to delete.';
          } else {
            const results = await Promise.allSettled(matches.map(r => invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: r.id } }, 15_000)));
            const okCount = results.filter(r => r.status === 'fulfilled' && !(r as any).value?.error).length;
            const label = keyword ? `${keyword} ` : '';
            speech = okCount === matches.length
              ? `Done — deleted all ${okCount} ${label}alerts.`
              : `Deleted ${okCount} of ${matches.length} ${label}alerts.`;
          }
          pendingDeleteRef.current = null;
          // If Robert tapped orange Stop during the supabase round-trip, abort
          // — don't add the turn (he asked for cancel, not for the deletion to
          // be rendered) and don't override his cancel-set idle status.
          if (isCancelled()) return;
          setTurns(prev => [...prev, {
            userMessage,
            assistantSpeech: speech,
            drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
            rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [], locationRules: [],
            globalSearch: undefined,
            timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                     + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
          }]);
          setStatus('idle');
          return;
        } catch (err) {
          console.error('[Orchestrator] delete-all intercept failed:', err);
          // Fall through to normal Claude path on error
        }
      }
    }

    // ── PENDING DELETE — "all" / "every" / "cancel" on a multi-match ───────
    // When a previous DELETE_RULE found multiple matches, we stored the IDs.
    // If the user now says "all" / "every one" / "all of them", delete them
    // inline without going back to Claude (who often just re-emits the same
    // disambiguating DELETE_RULE and loops).
    if (pendingDeleteRef.current && supabase) {
      const msg = userMessage.trim().toLowerCase();
      const isBulk   = /\b(all|everyone|every one|every|all of them|both)\b/i.test(msg);
      const isCancel = NEGATIVE_RE.test(msg);
      if (isCancel) {
        pendingDeleteRef.current = null;
        // Fall through to normal Claude send (user may want to cancel ONLY
        // the delete, then ask something unrelated). The cancel itself is
        // implicit — no override speech.
      } else if (isBulk) {
        const ids = pendingDeleteRef.current.matchIds;
        const label = pendingDeleteRef.current.match;
        pendingDeleteRef.current = null;
        try {
          const results = await Promise.allSettled(ids.map(id =>
            invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: id } }, 15_000),
          ));
          const okCount = results.filter(r => r.status === 'fulfilled' && !(r as any).value?.error).length;
          const speech  = okCount === ids.length
            ? `Done — deleted all ${ids.length} ${label ? label + ' ' : ''}alerts.`
            : `Deleted ${okCount} of ${ids.length}. ${ids.length - okCount} couldn't be removed.`;
          // Cancel-during-thinking guard — see delete-all intercept comment.
          if (isCancelled()) return;
          setTurns(prev => [...prev, {
            userMessage,
            assistantSpeech: speech,
            drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
            rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [], locationRules: [],
            globalSearch: undefined,
            timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                     + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
          }]);
          setStatus('idle');
        } catch (err) {
          if (isCancelled()) return;
          console.error('[Orchestrator] pendingDelete bulk failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
        return;
      } else {
        // Any other reply — user is trying to narrow to a specific alert, or
        // moved on. Clear the pending state and fall through to Claude so
        // the new turn is interpreted fresh.
        pendingDeleteRef.current = null;
      }
    }

    // ── PENDING LOCATION CONFIRMATION (M1 verified-address flow) ──────────────
    // If there's a pending location rule from the previous turn, handle this
    // user message as either a confirmation, a cancel, or a clarification.
    // Skips the Claude round-trip entirely.
    if (pendingLocationRef.current && supabase) {
      const pending = pendingLocationRef.current;
      const msg = userMessage.trim();
      const isYes = AFFIRMATIVE_RE.test(msg);
      const isNo  = NEGATIVE_RE.test(msg);

      // Helper — emit a text-only turn and reset status. Optionally accepts
      // a location-rule card to attach (V57.4 Part B).
      const emitPendingTurn = (
        speech: string,
        locationRules: { ruleId: string; placeName: string; oneShot: boolean }[] = [],
      ) => {
        setTurns(prev => [...prev, {
          userMessage,
          assistantSpeech: speech,
          drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
          rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [],
          locationRules,
          globalSearch: undefined,
          timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                   + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
        }]);
        setStatus('idle');
      };

      // Helper — commit the pending rule (used by yes-path AND clarification-memory-hit-path).
      // V57.4 Part B — returns the inserted rule id so callers can render the
      // toggle card.
      const commitPending = async (
        sessionUserId: string,
        sourceLabel: 'confirmed' | 'memory',
      ): Promise<{ ok: boolean; ruleId: string | null }> => {
        if (!pending.resolved) return { ok: false, ruleId: null };
        const triggerConfig = {
          ...(pending.originalAction?.trigger_config ?? {}),
          place_name: pending.resolved.place_name,
          resolved_lat: pending.resolved.lat,
          resolved_lng: pending.resolved.lng,
        };
        // V57.4 — location alerts default to ONE-TIME (one_shot=true). See
        // matching note in the SET_ACTION_RULE intercept below.
        const oneShot = pending.originalAction?.one_shot ?? true;
        const { data: insertedRule, error } = await queryWithTimeout(
          supabase
            .from('action_rules')
            .insert({
              user_id:        sessionUserId,
              trigger_type:   'location',
              trigger_config: triggerConfig,
              action_type:    String(pending.originalAction?.action_type ?? 'sms'),
              action_config:  pending.originalAction?.action_config ?? {},
              label:          String(pending.originalAction?.label ?? 'Location alert'),
              one_shot:       oneShot,
            })
            .select('id')
            .single(),
          15_000,
          'insert-location-rule',
        );
        // V57.6 — strict success requires BOTH no error AND a real row id.
        // queryWithTimeout returns { data: null, error: TimeoutError } on
        // timeout, so the !error guard catches that. But we also defend
        // against the rare case where Postgrest returns { data: null,
        // error: null } (older supabase-js versions did this on RLS
        // rejection silently).
        if (error || !insertedRule?.id) {
          console.error('[Orchestrator] pending location insert failed:', error?.message ?? 'no row returned');
          return { ok: false, ruleId: null };
        }
        // Only write to cache on explicit user confirmation (not on memory-hit during clarification).
        if (sourceLabel === 'confirmed') {
          await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
            body: JSON.stringify({
              user_id: sessionUserId,
              place_name: pending.placeName,
              save_to_cache: true,
              canonical_alias: pending.resolved.canonical_alias,
            }),
          }, 30000).catch((err) => console.error('[Orchestrator] save-to-cache failed:', err));
        }
        try {
          const { syncGeofencesForUser } = await import('@/hooks/useGeofencing');
          await syncGeofencesForUser(sessionUserId);
        } catch (err) {
          console.error('[Orchestrator] geofence sync after confirmed location rule:', err);
        }
        return { ok: true, ruleId: insertedRule?.id ? String(insertedRule.id) : null };
      };

      // ── CASE: yes + we have a resolved place → commit
      if (isYes && pending.resolved) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          pendingLocationRef.current = null;
          emitPendingTurn("I'm not signed in. Please sign in and try again.");
          return;
        }
        const { ok, ruleId } = await commitPending(session.user.id, 'confirmed');
        // V57.4 — speech now states one-time vs every-time so Robert always
        // knows which mode the rule is in.
        const oneShot = pending.originalAction?.one_shot ?? true;
        const modeText = oneShot ? 'one time' : 'every time';
        const speech = ok
          ? `Alert set — ${modeText} you arrive at ${pending.resolved.place_name}.`
          : `Couldn't save the rule — something went wrong. Try again?`;
        // V57.4 Part B — attach the toggle card when the rule was saved.
        const cards = ok && ruleId
          ? [{ ruleId, placeName: pending.resolved.place_name, oneShot }]
          : [];
        pendingLocationRef.current = null;
        emitPendingTurn(speech, cards);
        return;
      }

      // ── CASE: no / cancel → drop and move on
      if (isNo) {
        pendingLocationRef.current = null;
        emitPendingTurn('Cancelled.');
        return;
      }

      // ── CASE: fresh command — user has started a NEW rule creation rather
      // than clarifying the pending one. Drop pending so the normal flow can
      // handle it. The concatenation bug ("home Alert me when I arrive to my
      // office") came from treating this as a clarification.
      if (FRESH_COMMAND_RE.test(msg)) {
        console.log('[Orchestrator] pending location dropped — user sent a fresh command');
        pendingLocationRef.current = null;
        // Fall through to the normal send() flow (no return).
      } else {
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
          const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
            body: JSON.stringify({ user_id: session.user.id, place_name: combinedQuery, save_to_cache: false }),
          }, 30000);
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
              const { ok, ruleId } = await commitPending(session.user.id, 'memory');
              const oneShot = pending.originalAction?.one_shot ?? true;
              pendingLocationRef.current = null;
              const sourceText = data.source === 'memory' ? 'from your saved locations' :
                                 data.source === 'settings_home' ? 'from Settings (home)' :
                                 'from Settings (work)';
              const modeText = oneShot ? 'one time' : 'every time';
              const speech = ok
                ? `${data.place_name} ${sourceText} — alert set ${modeText} you arrive.`
                : `Couldn't save the rule — something went wrong.`;
              const cards = ok && ruleId
                ? [{ ruleId, placeName: data.place_name, oneShot }]
                : [];
              emitPendingTurn(speech, cards);
              return;
            }

            // Fresh — ask for confirmation.
            emitPendingTurn(`Found ${data.place_name}${data.address ? ' at ' + data.address : ''}. Say yes to set the alert, cancel to skip, or give me a different area.`);
            return;
          }

          if (data?.status === 'personal_unset') {
            pendingLocationRef.current = null;
            const which = data.personal === 'work' ? 'work' : 'home';
            emitPendingTurn(`Please add your ${which} address in Settings first, then try again.`);
            return;
          }

          // not_found or error — ask for different input, include tries-left + escape.
          const triesLeft = 3 - pending.attempts;
          const escape = triesLeft > 0
            ? ` Tell me a different street or neighborhood, or say cancel to stop. (${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.)`
            : '';
          emitPendingTurn(`I couldn't find "${combinedQuery}" near you.${escape}`);
          return;
        } catch (err) {
          console.error('[Orchestrator] pending location clarification failed:', err);
          pendingLocationRef.current = null;
          emitPendingTurn('Could not reach the location service. Try again later.');
          return;
        }
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
    // V57.4 Part B — location rules created in this turn. Filled by the
    // SET_ACTION_RULE intercept after a successful insert; rendered as an
    // inline card with a "Make it recurring / Make it one-time" toggle.
    const turnLocationRules: { ruleId: string; placeName: string; oneShot: boolean }[] = [];
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

    // V57.6 — diagnostic timing for the turn-2-slowness bug. Tag each step
    // with a turn-local label so we can read the timeline from logs:
    //   [orch:T#1] step-1-person-ctx 23ms
    //   [orch:T#1] step-4-naavi-chat 1245ms
    //   [orch:T#2] step-1-person-ctx 156ms   ← slow on turn 2
    //   [orch:T#2] step-4-naavi-chat 88321ms ← very slow
    // We piggyback on currentTurnIdRef which was already bumped above.
    const turnNumber = currentTurnIdRef.current;
    const t0 = Date.now();
    const stepLog = (step: string) => {
      const ms = Date.now() - t0;
      console.log(`[orch:T#${turnNumber}] ${step} ${ms}ms`);
    };
    console.log(`[orch:T#${turnNumber}] start userMessage=${JSON.stringify(userMessage).slice(0, 80)}`);

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
            // 8-second hard cap on pre-search. V57.2 — if global-search hangs
            // we proceed without pre-search results rather than freezing the
            // whole send pipeline.
            const searchPromise = supabase.functions.invoke('global-search', {
              body: { query: searchQuery, user_id: session.user.id, limit: 8 },
            });
            const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) => {
              setTimeout(() => {
                console.warn('[Orchestrator] pre-search timed out after 8s — proceeding without results');
                resolve({ data: null, error: 'timeout' });
              }, 8_000);
            });
            const { data, error } = await Promise.race([searchPromise, timeoutPromise]);
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

      stepLog('pre-naavi-chat done');
      const [response, knowledgeResult] = await Promise.all([
        sendToNaavi(enrichedMessage, historyRef.current, briefRef.current, language),
        isBroadQuery ? fetchAllKnowledge(100) : Promise.resolve([]),
      ]);
      stepLog('naavi-chat returned');
      // Cancel-during-thinking guard — if Robert tapped orange Stop while we
      // were waiting on Claude, abandon the response. Status is already idle
      // (set by the orange-button handler); rendering would re-add cards and
      // start TTS the user explicitly cancelled.
      if (isCancelled()) return;
      console.log('[Orchestrator] actions:', JSON.stringify(response.actions));
      console.log('[Orchestrator] knowledgeItems from direct fetch:', knowledgeResult.length);

      // ── Execute actions ────────────────────────────────────────────────────────

      // Dedupe REMEMBER actions on identical text — Haiku occasionally emits
      // the same REMEMBER twice in one response (possibly conflating the
      // user's request with the date-fact fanout instruction). Without this
      // guard the user sees two "SAVED TO MEMORY" cards for one fact.
      const dedupedActions = (() => {
        const seenRemember = new Set<string>();
        // V57.8 — also dedupe SET_ACTION_RULE on (trigger_type, place_name |
        // from_name | etc.). Wael's office-alert speech-vs-card mismatch
        // (2026-04-29) was caused by Claude emitting two SET_ACTION_RULE
        // actions for the same alert with different one_shot values. The
        // first inserted (one_shot=true), the second tried to insert AND
        // overrode the speech ("every time"). The card showed the first,
        // the speech showed the second. Same place + trigger = drop the
        // duplicate.
        const seenActionRule = new Set<string>();
        const actionRuleKey = (a: any): string => {
          const tt = String(a?.trigger_type ?? '');
          const tc = a?.trigger_config ?? {};
          // Use the most specific identifier per trigger type.
          const ident =
            tc.place_name ?? tc.from_name ?? tc.from_email ??
            tc.subject_keyword ?? tc.event_match ?? tc.condition ?? '';
          return `${tt}::${String(ident).trim().toLowerCase()}`;
        };
        const out: NaaviAction[] = [];
        for (const a of response.actions) {
          if (a.type === 'REMEMBER') {
            const key = String(a.text ?? '').trim().toLowerCase();
            if (key && seenRemember.has(key)) continue;
            if (key) seenRemember.add(key);
          }
          if (a.type === 'SET_ACTION_RULE') {
            const key = actionRuleKey(a);
            if (key && seenActionRule.has(key)) {
              console.warn(`[Orchestrator] dropping duplicate SET_ACTION_RULE: ${key}`);
              continue;
            }
            if (key) seenActionRule.add(key);
          }
          out.push(a);
        }
        return out;
      })();

      for (const action of dedupedActions) {
        if (action.type === 'SAVE_TO_DRIVE') {
          const title = String(action.title ?? 'Naavi Note');
          try {
            // Route SAVE_TO_DRIVE actions into MyNaavi/Notes/ — they're text
            // notes the user asked to save. Without the category they'd land
            // in MyNaavi/ root.
            const file = await registry.storage.save(title, String(action.content ?? ''), '', 'note');
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
                const { data, error } = await invokeWithTimeout('global-search', {
                  body: { query, user_id: session.user.id, limit: 8 },
                }, 15_000);
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

        if (action.type === 'LIST_RULES') {
          // Navigate to the Alerts screen instead of summarising inline.
          // If Claude attached a "match" filter (e.g. "Costco"), forward it
          // as a route param so the screen auto-expands the matching row.
          const match = String((action as any).match ?? '').trim();
          try {
            if (match) {
              router.push({ pathname: '/alerts', params: { highlight: match } });
              turnSpeechOverride = `Opening your ${match} alert.`;
            } else {
              router.push('/alerts');
              turnSpeechOverride = 'Opening your alerts.';
            }
          } catch (err) {
            console.error('[Orchestrator] LIST_RULES nav failed:', err);
            turnSpeechOverride = "Tap the three-dot menu and then Alerts to see them.";
          }
          continue;
        }

        if (action.type === 'DELETE_RULE') {
          // Match string comes from Claude. Strategy:
          //   1. Fetch every rule.
          //   2. Flatten trigger_type + trigger_config values + action_config
          //      values + label into a lowercase haystack per rule.
          //   3. Score match. Single → delete. None → tell user. Multiple →
          //      disambiguate UNLESS action.all === true (then delete all).
          const match = String((action as any).match ?? '').trim().toLowerCase();
          const deleteAll = (action as any).all === true;
          if (!match && !deleteAll) {
            turnSpeechOverride = "Tell me which alert to delete — give me a place, a contact, or the trigger word.";
            continue;
          }
          try {
            if (!supabase) { turnSpeechOverride = "I'm not signed in right now."; continue; }
            const { data } = await invokeWithTimeout('manage-rules', { body: { op: 'list' } }, 15_000);
            const all: Array<Record<string, any>> = Array.isArray((data as any)?.rules) ? (data as any).rules : [];
            const needles = match ? match.split(/\s+/).filter(Boolean) : [];
            const haystackFor = (r: Record<string, any>) => {
              const parts: string[] = [];
              parts.push(String(r.trigger_type ?? ''));
              parts.push(String(r.label ?? ''));
              for (const v of Object.values(r.trigger_config ?? {})) {
                if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
              }
              for (const v of Object.values(r.action_config ?? {})) {
                if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
              }
              return parts.join(' ').toLowerCase();
            };
            const matches = needles.length === 0
              ? all
              : all.filter(r => { const hay = haystackFor(r); return needles.every(n => hay.includes(n)); });

            if (matches.length === 0) {
              turnSpeechOverride = match ? `I couldn't find an alert matching "${match}".` : "You have no alerts to delete.";
              pendingDeleteRef.current = null;
            } else if (matches.length > 1 && !deleteAll) {
              const hints = matches.slice(0, 3).map(r => String(r.trigger_type) + (r.trigger_config?.place_name ? ` ${r.trigger_config.place_name}` : r.trigger_config?.from_name ? ` ${r.trigger_config.from_name}` : ''));
              turnSpeechOverride = `I found ${matches.length} alerts matching. Which one — ${hints.join(', or ')}? Or say "all" to delete every match.`;
              // Stash the matched IDs so a "all" / "every" reply on the next
              // turn can delete them without going back to Claude.
              pendingDeleteRef.current = {
                match,
                matchIds: matches.map(r => String(r.id)),
              };
            } else {
              // Delete one or many in parallel
              const results = await Promise.allSettled(
                matches.map(t => invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: t.id } }, 15_000)),
              );
              const okCount   = results.filter(r => r.status === 'fulfilled' && !(r as any).value?.error).length;
              const failCount = matches.length - okCount;
              if (okCount === 0) {
                turnSpeechOverride = "I couldn't delete those alerts — something went wrong.";
              } else if (matches.length === 1) {
                const target = matches[0];
                const summary = target.trigger_type === 'location' && target.trigger_config?.place_name
                  ? `the ${target.trigger_config.place_name} alert`
                  : target.trigger_type === 'weather' && target.trigger_config?.condition
                    ? `the ${target.trigger_config.condition} alert`
                    : target.trigger_type === 'contact_silence' && target.trigger_config?.from_name
                      ? `the ${target.trigger_config.from_name} silence alert`
                      : `the ${target.trigger_type} alert`;
                turnSpeechOverride = `Done — deleted ${summary}.`;
              } else {
                const label = match ? `${match} ` : '';
                turnSpeechOverride = failCount === 0
                  ? `Done — deleted all ${okCount} ${label}alerts.`
                  : `Deleted ${okCount} ${label}alerts. ${failCount} couldn't be removed.`;
              }
              pendingDeleteRef.current = null;
            }
          } catch (err) {
            console.error('[Orchestrator] DELETE_RULE failed:', err);
            turnSpeechOverride = "I couldn't reach your alerts right now.";
          }
          continue;
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
                const { data: settings } = await queryWithTimeout(
                  supabase
                    .from('user_settings')
                    .select('phone')
                    .eq('user_id', session.user.id)
                    .single(),
                  15_000,
                  'select-user-phone',
                );
                toPhone = settings?.phone ?? '';
              }

              const label = String(action.label ?? 'Email alert');
              const { error } = await queryWithTimeout(
                supabase.from('action_rules').insert({
                  user_id:        session.user.id,
                  trigger_type:   'email',
                  trigger_config: triggerConfig,
                  action_type:    'sms',
                  action_config:  { to_phone: toPhone, body: `New email alert: ${label}` },
                  label,
                  one_shot:       false,
                  enabled:        true,
                }),
                15_000,
                'insert-email-alert-rule',
              );
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
                console.log(`[orch:loc] entering intercept | place="${placeName}" | one_shot=${action.one_shot} | label="${action.label}"`);
                if (!placeName) {
                  locationIntercepted = true;
                  turnSpeechOverride = "I didn't catch the place for that alert. Can you say it again?";
                  console.log('[orch:loc] empty placeName — skipping');
                  continue;
                }
                try {
                  const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
                    body: JSON.stringify({
                      user_id: session.user.id,
                      place_name: placeName,
                      save_to_cache: false,
                    }),
                  }, 30000);
                  const data = await res.json();

                  // 1. Memory / Settings hit → insert immediately with resolved coords.
                  if (data?.status === 'ok' && (data.source === 'memory' || data.source === 'settings_home' || data.source === 'settings_work')) {
                    const triggerConfig = {
                      ...(action.trigger_config ?? {}),
                      place_name: data.place_name,
                      resolved_lat: data.lat,
                      resolved_lng: data.lng,
                    };
                    // V57.4 — location alerts default to ONE-TIME (one_shot=true).
                    // Naavi only flips this to recurring if Robert says
                    // "every time" / "always" / similar. The server prompt v41
                    // is supposed to emit one_shot=true on default location
                    // requests, but we also default to true here as a safety
                    // net so a forgotten field can't silently downgrade the
                    // rule to recurring.
                    const oneShot = action.one_shot ?? true;
                    // V57.4 Part B — capture the inserted rule's id so the
                    // turn can render a "Make it recurring / one-time" toggle.
                    const { data: insertedRule, error: insertErr } = await queryWithTimeout(
                      supabase
                        .from('action_rules')
                        .insert({
                          user_id:        session.user.id,
                          trigger_type:   'location',
                          trigger_config: triggerConfig,
                          action_type:    actionType,
                          action_config:  actionConfig,
                          label:          String(action.label ?? 'Location alert'),
                          one_shot:       oneShot,
                        })
                        .select('id')
                        .single(),
                      15_000,
                      'insert-location-rule-memory-hit',
                    );
                    // V57.6 — only confirm the alert was set if the insert
                    // actually returned a row. Previously we set "Alert set"
                    // speech unconditionally, which lied to Robert when the
                    // insert timed out or RLS-failed silently.
                    const insertSucceeded = !insertErr && !!insertedRule?.id;
                    console.log(`[orch:loc] memory-hit insert | succeeded=${insertSucceeded} | id=${insertedRule?.id ?? 'null'} | one_shot=${oneShot} | err=${insertErr?.message ?? insertErr ?? 'null'}`);
                    if (insertErr) {
                      console.error('[Orchestrator] memory-hit insert failed:', insertErr.message ?? insertErr);
                    }
                    if (insertSucceeded) {
                      turnLocationRules.push({
                        ruleId: String(insertedRule!.id),
                        placeName: data.place_name,
                        oneShot,
                      });
                      try {
                        const { syncGeofencesForUser } = await import('@/hooks/useGeofencing');
                        await syncGeofencesForUser(session.user.id);
                      } catch (err) {
                        console.error('[Orchestrator] geofence sync after memory-hit insert:', err);
                      }
                    }
                    locationIntercepted = true;
                    // V57.4 — speech now states one-time vs every-time so
                    // Robert always knows which mode the rule is in.
                    // V57.6 — fall back to a candid error if the insert
                    // didn't land. Speech-truthfulness rule.
                    const modeText = oneShot ? 'one time' : 'every time';
                    turnSpeechOverride = insertSucceeded
                      ? `Alert set — ${modeText} you arrive at ${data.place_name}.`
                      : `I couldn't save the alert — please try again in a moment.`;
                    console.log(`[orch:loc] turnSpeechOverride set | "${turnSpeechOverride}"`);
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
                    turnSpeechOverride = `Found ${data.place_name}${data.address ? ' at ' + data.address : ''}. Say yes to set the alert, cancel to skip, or give me a different area.`;
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
                    turnSpeechOverride = `I couldn't find "${placeName}" near you. Tell me a different street or neighborhood, or say cancel to stop.`;
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
              const { error } = await queryWithTimeout(
                supabase.from('action_rules').insert({
                  user_id:        session.user.id,
                  trigger_type:   triggerType,
                  trigger_config: action.trigger_config ?? {},
                  action_type:    actionType,
                  action_config:  actionConfig,
                  label:          String(action.label ?? 'Action rule'),
                  one_shot:       action.one_shot ?? false,
                }),
                15_000,
                'insert-action-rule',
              );
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
        rememberedItems:  [...turnMemory],
        driveFiles:       turnDrive,
        navigationResults: turnNav,
        listResults:      turnLists,
        locationRules:    turnLocationRules,
        globalSearch:     turnGlobalSearch,
        timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
      setTurns(prev => [...prev, newTurn]);
      saveConversationTurn(newTurn).catch(() => {});
      stepLog('actions done, turn rendered');

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
                  const { data, error: fnErr } = await invokeWithTimeout('send-sms', {
                    body: { to: resolvedPhone, body: String(action.body ?? ''), channel },
                  }, 30_000);
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

      // Speak concurrently — text appears and voice starts at the same time.
      // If Robert tapped orange Stop during thinking, isCancelled() is true and
      // we abandon this turn (the response is already discarded above; here
      // we'd otherwise stomp the post-cancel idle state).
      if (isCancelled()) return;
      setStatus('speaking');
      setAudioPlaying(true);
      speakResponse(finalSpeech, language).then(() => {
        // Audio finished (or never started in voice-off mode). Either way the
        // playback path is done.
        setAudioPlaying(false);
        if (isCancelled()) return;
        // If user tapped orange Stop during speaking, status is 'answer_active'.
        // The silent answer just finished — kick off the 10s cooldown so the
        // lock auto-releases. (Session 26 design lock — Robert's correction:
        // timer fires from end-of-silent-answer, NOT from Stop tap.)
        if (statusRef.current === 'answer_active') {
          startCooldown();
          return;
        }
        // If user tapped Cancel earlier, status is 'cooldown' — don't override.
        if (statusRef.current === 'cooldown') return;
        // Only enter voice-confirm flow if hands-free is active.
        // In tap-to-talk mode, Robert uses the Send button on the DraftCard.
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
      }).catch(() => {
        setAudioPlaying(false);
        if (isCancelled()) return;
        if (statusRef.current === 'answer_active') {
          startCooldown();
          return;
        }
        if (statusRef.current === 'cooldown') return;
        setStatus('idle');
      });

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
    setAudioPlaying(false);
    clearCooldownTimer();
    pendingActionRef.current = null;
    setPendingAction(null);
    setStatus('idle');
  }, [clearCooldownTimer, setAudioPlaying]);

  // ── Lock-model orange button dispatcher ────────────────────────────────────
  // The UI's orange ⏹ Stop / ✕ Cancel button calls this. Behavior depends on
  // current status (Session 26 design lock — Robert's correction):
  //   thinking      → cancel in-flight turn, return to idle. No buffer because
  //                   there's no answer to consume yet.
  //   speaking      → silence voice, enter answer_active. NO timer yet — the
  //                   silent answer keeps working in the background. The timer
  //                   only starts when (a) Robert taps ✕ Cancel or (b) the
  //                   answer finishes silent processing.
  //   answer_active → tap interpreted as ✕ Cancel. Start the 10-second
  //                   cooldown timer; status flips to 'cooldown'.
  //   cooldown      → no-op (orange should be hidden — defensive).
  //   other         → no-op (defensive — UI shouldn't render the button).
  const onOrangeButtonPressed = useCallback(() => {
    const s = statusRef.current;
    if (s === 'thinking') {
      currentTurnIdRef.current++;
      stopSpeaking();
      setAudioPlaying(false);
      clearCooldownTimer();
      pendingActionRef.current = null;
      setPendingAction(null);
      setStatus('idle');
    } else if (s === 'speaking') {
      // Silence voice. Status → answer_active with NO timer. The timer starts
      // only when Cancel is tapped OR when the silent answer finishes (the
      // speakResponse .then() / .catch() handlers detect the end-of-answer
      // and call startCooldown()).
      stopSpeaking();
      setAudioPlaying(false);
      setStatus('answer_active');
    } else if (s === 'answer_active') {
      // Tap = ✕ Cancel. Start the 10-second cooldown buffer.
      startCooldown();
    }
    // cooldown / idle / pending_confirm / error: no-op.
  }, [clearCooldownTimer, setAudioPlaying, startCooldown]);

  // Cleanup on unmount — make sure no stray timer fires after the hook unmounts.
  useEffect(() => {
    return () => clearCooldownTimer();
  }, [clearCooldownTimer]);

  return {
    status, turns, error, send, clearHistory, loadHistory,
    stopSpeaking: stopAndReset,
    // Lock-model orange button — UI calls this when Robert taps ⏹ Stop / ✕ Cancel.
    onOrangeButtonPressed,
    // True only while TTS is actively emitting audio. UI uses this to hide
    // the orange Stop button when Voice Playback is off or audio has stopped
    // even though status is still 'speaking'.
    isAudioPlaying,
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
    // so usernames like "aggan2207" are read as "a g g a n 2 2 0 7".
    // Excluded via negative lookahead: ordinal dates ("15th", "21st"),
    // time-of-day ("5pm", "10am"). Without this exclusion the splitter
    // turned "October 15th" into "October 1 5 t h" — TTS then read each
    // character. Server-side `rejoinBrokenOrdinalsForTTS` is the safety
    // net for older builds that still ship the over-broad pattern.
    .replace(
      /\b(?!\d+(?:st|nd|rd|th|am|pm)\b)([A-Za-z]+\d+[A-Za-z0-9]*|[A-Za-z0-9]*\d+[A-Za-z]+[A-Za-z0-9]*)\b/g,
      match => match.split('').join(' ')
    );
}

// ─── Stop speaking ───────────────────────────────────────────────────────────
// _speechGen — module-level loop-bail counter for in-flight TTS. Every call to
// stopSpeaking() bumps it, which makes any in-flight speakCloud{,Native} loop
// bail at its next check. Each speak invocation captures its own myGen on
// entry (also bumping the counter) so concurrent calls can't share a gen.
//
// Under the lock model (Session 26 design lock) send() never starts while a
// previous reply is still active — the UI gate prevents that. So the counter
// is mainly a safety net for stopSpeaking + a defense against future code
// paths that might inadvertently overlap. Not a kill-and-replace mechanism.
let _speechGen = 0;
let _currentAudio: HTMLAudioElement | null = null;
let _currentSound: any = null;

export function stopSpeaking(): void {
  _speechGen++;  // invalidate any in-flight speakResponse
  // Web
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  // Native — stop AND unload. Without unloadAsync the native decoder leaks;
  // every "Naavi stop" mid-reply accumulates one leaked Sound object until
  // Android throttles the JS thread and the UI freezes.
  if (_currentSound) {
    const s = _currentSound;
    _currentSound = null;
    try {
      s.stopAsync()
        .then(() => s.unloadAsync().catch(() => {}))
        .catch(() => s.unloadAsync().catch(() => {}));
    } catch {
      try { s.unloadAsync().catch(() => {}); } catch {}
    }
  }
  Speech.stop().catch(() => {});
}

// ─── Speech helper ────────────────────────────────────────────────────────────

// Fetch TTS audio as base64 from OpenAI sage voice
async function fetchTTSBase64(chunk: string): Promise<string | null> {
  try {
    const { data, error } = await invokeWithTimeout('text-to-speech', {
      body: { text: chunk, voice: 'shimmer' },
    }, 30_000);
    if (error) {
      console.error(`[TTS fetch] Edge Function error for chunk "${chunk.slice(0, 40)}...":`, error?.message ?? error);
      return null;
    }
    if (!data?.audio) {
      console.warn(`[TTS fetch] Edge Function returned no audio for chunk "${chunk.slice(0, 40)}...":`, JSON.stringify(data).slice(0, 200));
      return null;
    }
    return data.audio as string;
  } catch (err) {
    console.error(`[TTS fetch] Exception for chunk "${chunk.slice(0, 40)}...":`, err);
    return null;
  }
}

// ── Web playback ──────────────────────────────────────────────────────────────
function playAudioUrl(url: string, isStale: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (isStale()) { resolve(); return; }
    const audio = new (window as any).Audio(url);
    _currentAudio = audio;
    audio.onended = () => { _currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { _currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => resolve());
  });
}

async function speakCloud(text: string): Promise<void> {
  // Honor global voice-playback toggle.
  if (!isVoiceEnabledSync()) return;
  const myGen = ++_speechGen;
  const isStale = () => _speechGen !== myGen;
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
      if (isStale()) break;
      const base64 = await promise;
      if (!base64 || isStale()) continue;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      await playAudioUrl(url, isStale);
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
//
// V57.2 rewrite — V57.1 testing surfaced multi-minute gaps between TTS chunks
// because the previous implementation relied on a 30-second flat safety timer
// PLUS the unreliable `didJustFinish` callback. On Android, `didJustFinish`
// often doesn't fire even when playback ends cleanly, so each chunk waited
// the full 30s before resolving. With 4 chunks that's 2 minutes of silence.
//
// New approach:
//   - Resolve via THREE signals, whichever fires first:
//       (a) status.didJustFinish — when Android cooperates
//       (b) positionMillis >= durationMillis (with small tolerance)
//       (c) dynamic safety timer = audio duration + 2s padding (clamped 4-15s)
//   - Always clean up the Sound object and temp file before resolving.
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
      let resolved = false;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanupAndResolve = (reason: string) => {
        if (resolved) return;
        resolved = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (_currentSound === sound) _currentSound = null;
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        console.log(`[TTS Native] chunk done — ${reason}`);
        resolve();
      };

      const cleanupAndReject = (err: any) => {
        if (resolved) return;
        resolved = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (_currentSound === sound) _currentSound = null;
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        reject(err);
      };

      // Initial safety timer — fires before we know the audio duration. Once
      // the audio loads we replace this with a duration-based timer.
      safetyTimer = setTimeout(() => cleanupAndResolve('initial-safety-15s'), 15_000);

      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (resolved) return;

        // Loaded successfully — replace the initial 15s safety timer with one
        // calibrated to actual audio duration. Avoids both the V57.1 hang
        // (didJustFinish never fires → 30s flat wait) and cutting off long
        // chunks (a 5s flat timer would).
        if (status.isLoaded && status.durationMillis && safetyTimer) {
          const duration = status.durationMillis;
          // duration + 2s padding, clamped to a sensible range. A 60-character
          // sentence is roughly 4-6 seconds of audio; clamp lower bound at 4s
          // to give every chunk room. Upper bound 15s catches even long
          // sentences without hanging too long if didJustFinish never fires.
          const clamped = Math.min(15_000, Math.max(4_000, duration + 2_000));
          clearTimeout(safetyTimer);
          safetyTimer = setTimeout(() => cleanupAndResolve(`safety-${clamped}ms`), clamped);
        }

        // Cleanest end-of-playback signal when Android cooperates.
        if (status.isLoaded && status.didJustFinish) {
          cleanupAndResolve('didJustFinish');
          return;
        }

        // Position-based end detection — works even when didJustFinish doesn't
        // fire. When position is within 100ms of duration, we're effectively done.
        if (
          status.isLoaded
          && typeof status.positionMillis === 'number'
          && typeof status.durationMillis === 'number'
          && status.durationMillis > 0
          && status.positionMillis >= status.durationMillis - 100
        ) {
          cleanupAndResolve('position-reached-duration');
          return;
        }

        // Loading failed — reject so the caller can fall back to expo-speech
        if (!status.isLoaded && status.error) {
          cleanupAndReject(new Error(String(status.error)));
        }
      });

      sound.loadAsync({ uri: tempUri })
        .then(() => sound.playAsync())
        .catch((err) => cleanupAndReject(err));
    });
  } catch (err) {
    console.error('[TTS Native] playback error:', err);
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    throw err; // Re-throw so speakCloudNative falls back to expo-speech
  }
}

async function speakCloudNative(text: string, language: 'en' | 'fr'): Promise<void> {
  // Diagnostic logging — Bug 4 (V57.1): Robert observed Voice Playback ON in
  // Settings but no TTS audible during a DraftCard turn. These logs help
  // pinpoint whether the toggle, the TTS fetch, the audio playback, or the
  // staleness check is the culprit.
  const voiceEnabled = isVoiceEnabledSync();
  console.log(`[TTS Native] speakCloudNative entry — voiceEnabled=${voiceEnabled}, textLen=${text?.length ?? 0}, textPreview="${(text ?? '').slice(0, 60)}"`);
  // Honor global voice-playback toggle.
  if (!voiceEnabled) {
    console.log('[TTS Native] Skipped — voice playback disabled in Settings');
    return;
  }
  if (!text || text.trim().length === 0) {
    console.warn('[TTS Native] Skipped — empty text');
    return;
  }
  // Capture our generation. stopSpeaking() and any newer speakCloud{,Native}
  // call will increment _speechGen, making this loop bail at the next check.
  const myGen = ++_speechGen;
  const isStale = () => _speechGen !== myGen;
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
  console.log(`[TTS Native] chunked into ${chunks.length} pieces`);
  if (chunks.length === 0) {
    console.warn('[TTS Native] Skipped — text produced 0 chunks after split');
    return;
  }
  try {
    const audioPromises = chunks.map(chunk => fetchTTSBase64(chunk));
    let playedAny = false;
    let chunkIdx = 0;
    for (const promise of audioPromises) {
      chunkIdx++;
      if (isStale()) {
        console.log(`[TTS Native] chunk ${chunkIdx}/${chunks.length} skipped — stale (gen mismatch)`);
        break;
      }
      const base64 = await promise;
      if (!base64) {
        console.warn(`[TTS Native] chunk ${chunkIdx}/${chunks.length} fetch returned null — text-to-speech Edge Function may be failing`);
        continue;
      }
      if (isStale()) {
        console.log(`[TTS Native] chunk ${chunkIdx}/${chunks.length} stale after fetch, skipping playback`);
        continue;
      }
      console.log(`[TTS Native] playing chunk ${chunkIdx}/${chunks.length} (${base64.length} bytes base64)`);
      await playBase64AudioNative(base64);
      playedAny = true;
    }
    // If no cloud TTS chunks played (all returned null), fall back to expo-speech
    if (!playedAny && !isStale()) {
      console.warn(`[TTS Native] All ${chunks.length} chunks returned null — falling back to expo-speech`);
      throw new Error('No TTS audio available');
    }
    if (playedAny) console.log(`[TTS Native] Done — played ${chunks.length} chunks successfully`);
  } catch (err) {
    if (isStale()) return;
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
