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
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { sendToNaavi, type NaaviMessage, type NaaviAction, type BriefItem, type GlobalSearchResult } from '@/lib/naavi-client';
import { isVoiceEnabledSync } from '@/lib/voicePref';
import { saveContact, saveDriveNote, saveConversationTurn, supabase } from '@/lib/supabase';
import { invokeWithTimeout, queryWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
import { remoteLog, newDiagSession, endDiagSession } from '@/lib/remoteLog';
import { maybePromptBatteryExemption } from '@/lib/batteryExemptionPrompt';
import { sendPushNotification } from '@/lib/push';
import { extractPersonQuery, getPersonContext, formatPersonContext, savePerson, saveTopic } from '@/lib/memory';
import { lookupContact, lookupContactByPhone } from '@/lib/contacts';
import { ingestNote, deleteKnowledge, fetchAllKnowledge, searchKnowledge } from '@/lib/knowledge';
import { registry } from '@/lib/adapters/registry';
import { createList, addToList, removeFromList, readList } from '@/lib/lists';
import {
  connectList,
  disconnectEntity,
  queryListConnections,
  deleteListWithConnections,
  formatConnectionQueryResult,
  ensureListAttachedToRule,
  type ConnectionRow,
} from '@/lib/list_connections';
import type { StorageFile, NavigationResult } from '@/lib/types';

import { isConfirmable, buildActionSummary, SPEECH, type PendingAction } from '@/lib/voice-confirm';
import { normalizePlaceName } from '@/lib/normalizePlaceName';

// Endpoints for direct Edge Function calls from the orchestrator (location-rule
// confirmation flow and resolve-place cache writes).
const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// F5c — parse task strings into structured task_actions that evaluate-rules
// can auto-execute (send SMS/email) when a location alert fires.
// Only "text/message/sms [name] [message]" and "email [name] [message]" patterns
// are auto-executable. Other task strings remain as plain reminder notes.
interface TaskAction {
  type: 'send_sms' | 'send_email';
  to_name: string;
  to_phone?: string;
  to_email?: string;
  body: string;
}
const TASK_SMS_RE   = /^(?:text|message|sms)\s+(\w+)\s+(?:that\s+|to\s+say\s+)?(.+)$/i;
const TASK_EMAIL_RE = /^(?:email|send\s+(?:an?\s+)?email\s+(?:to\s+)?)\s*(\w+)\s+(?:about\s+|that\s+|to\s+say\s+)?(.+)$/i;

async function resolveTaskActions(tasks: string[]): Promise<TaskAction[]> {
  const results: TaskAction[] = [];
  for (const task of tasks) {
    const smsMatch   = TASK_SMS_RE.exec(task.trim());
    const emailMatch = !smsMatch && TASK_EMAIL_RE.exec(task.trim());
    const match = smsMatch || emailMatch;
    if (!match) continue;

    const toName = match[1];
    const body   = match[2].trim();
    try {
      const contact = await lookupContact(toName);
      if (smsMatch && contact?.phone) {
        results.push({ type: 'send_sms', to_name: toName, to_phone: contact.phone, body });
      } else if (emailMatch && contact?.email) {
        results.push({ type: 'send_email', to_name: toName, to_email: contact.email, body });
      } else {
        console.log(`[F5c] resolveTaskActions: no phone/email for "${toName}" — task stays as reminder note`);
      }
    } catch (err) {
      console.error('[F5c] resolveTaskActions contact lookup failed for:', toName, err);
    }
  }
  return results;
}

// Affirmative / negative patterns for the pending-location confirmation turn.
// Kept tight so ambiguous replies fall through to the clarification branch.
const AFFIRMATIVE_RE = /^(yes|yeah|yep|yup|sure|confirm|confirmed|correct|ok|okay|alright|do it|go ahead|set it|please|please do|send)[.!?]*$/i;
// V57.12.1 Bug D fix — relaxed from strict-anchor to leading-word match
// with optional "please" prefix. Previous regex required the message to be
// EXACTLY one of the negative words (or that word + punctuation). That
// rejected natural phrasings like "cancel that", "please cancel", "stop
// this", as well as auto-correct / voice transcription artifacts. Wael
// 2026-05-06 — pending-location state survived 31 min because his "cancel"
// input variants kept missing the regex.
const NEGATIVE_RE    = /^\s*(?:please\s+)?(no|nope|cancel|never ?mind|stop|forget it|don[']?t)\b/i;
const POSITIVE_RE    = /^\s*(?:please\s+)?(yes|yeah|yep|yup|confirm|approved|go ahead|do it|ok|okay|sure|correct|right|that[''s]? right)\b/i;

// Correction pattern — fired when the user wants to fix a mishear:
//   "I meant Fatma", "I said Ahmed", "No, I meant Fatma", "Actually Costco",
//   "Correction: Lila", "I mean Leila".
// MUST be tested BEFORE NEGATIVE_RE so "No, I meant X" isn't swallowed as a
// bare cancel when a pending action is active. When matched with a pending
// action, we clear the action and pass the full message through to Claude
// for re-processing with the corrected text.
const CORRECTION_RE = /^\s*(?:no[,.]?\s+)?(?:i\s+(?:meant|said|mean)|actually[,.]?\s+\S|correction[:.]\s*\S)/i;

// Fresh-command pattern — detects when the user has clearly started a NEW
// rule-creation command rather than clarifying the pending one. Prevents
// the "home + Alert me when I arrive to my office" concatenation bug.
const FRESH_COMMAND_RE = /^\s*(alert|text|notify|remind|tell)\s+(me|my|the|him|her|us|them)\b/i;

// V57.11.3 — escape pattern for the multi-candidate picker. If the user
// asks a question instead of picking ("List me all Movati", "Where is
// Costco", "How far is Bank Street"), drop the pending picker so Claude
// can answer the new query — don't trap them in pick-mode.
const QUESTION_ESCAPE_RE = /^\s*(list|show|find|tell|where|what|how|which|search|look up)\b/i;

// V57.11.3 — number words 1-5 → digit. The picker tops out at 5 candidates
// so spelled-out numbers beyond five aren't recognised.
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  '#1': 1, '#2': 2, '#3': 3, '#4': 4, '#5': 5,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};

/**
 * Pull the distinguishing street name from a full formatted address. Used
 * when reading candidates aloud ("the one on Bank Street") and when fuzzy-
 * matching the user's spoken pick.
 *
 * Examples:
 *   "1280 Merivale Rd, Ottawa, ON K2C 0L4, Canada" → "Merivale"
 *   "1900 Innes Rd, Gloucester, ON K1B 3K6, Canada" → "Innes"
 *   "200 Bank St, Ottawa, ON K1P 5N6, Canada" → "Bank"
 */
export function pickShortAddress(address?: string | null): string | null {
  if (!address) return null;
  const firstSegment = address.split(',')[0]?.trim() ?? '';
  // Drop the leading civic number (and optional unit letter glued to it like
  // "12A"). Mandatory whitespace AFTER the unit letter — V57.11.3 fix:
  // without that, the optional [a-z] was eating the first letter of the
  // street ("8 St. Joseph" → "t. Joseph"; "8501 Place d'Orléans" → "lace
  // d'Orléans"). Wael 2026-05-05 caught this on Tim Hortons.
  const noCivic = firstSegment.replace(/^\s*\d+[a-z]?\s+/i, '');
  // Drop the trailing street-type abbreviation so we keep only the name token.
  const streetTypeRe = /\s+(rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|cres|crescent|hwy|highway|pkwy|parkway|pl|place|terr|terrace|sq|square)\.?$/i;
  const trimmed = noCivic.replace(streetTypeRe, '').trim();
  return trimmed.length > 0 ? trimmed : (noCivic.length > 0 ? noCivic : null);
}

/**
 * Parse a user reply against an array of location candidates and return
 * the matching index, or -1 if no clear match. Supports:
 *   - digit / spelled number ("1", "two", "third", "#3")
 *   - street-name fuzzy match ("Bank", "Bank Street", "the one on Innes")
 * Ambiguous matches return -1 so the caller can re-prompt.
 */
export function parseLocationPick(
  reply: string,
  candidates: Array<{ address?: string | null; place_name: string }>,
): number {
  const lower = reply.toLowerCase().trim();
  if (!lower) return -1;

  // Number-first parse.
  for (const token of lower.split(/[^a-z0-9#]+/i)) {
    if (NUMBER_WORDS[token] !== undefined) {
      const n = NUMBER_WORDS[token];
      if (n >= 1 && n <= candidates.length) return n - 1;
    }
  }

  // Street-name fuzzy parse — match candidate's distinguishing street token.
  const matches: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const street = (pickShortAddress(candidates[i].address ?? null) ?? '').toLowerCase();
    if (street && lower.includes(street)) matches.push(i);
  }
  if (matches.length === 1) return matches[0];

  // Last fallback — match candidate's full place_name word.
  const nameMatches: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const name = candidates[i].place_name.toLowerCase();
    // Skip the brand prefix (everything before the first space) — it's
    // common to all candidates so it can't disambiguate.
    const distinctive = name.split(/\s+/).slice(1).join(' ');
    if (distinctive && lower.includes(distinctive)) nameMatches.push(i);
  }
  if (nameMatches.length === 1) return nameMatches[0];

  return -1;
}

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

// V57.11 — text-Send is locked LESS strictly than the mic. Sending typed
// text while Naavi is speaking has no audio-pickup risk (the user isn't
// holding a mic open), and forcing them to wait for a clarification
// question's TTS to finish before they can reply is bad UX. send()
// silences the current TTS at the start of the new turn so audio doesn't
// collide. Mic / hands-free / Visits stay gated by isInputLocked.
export function isSendLocked(s: OrchestratorStatus): boolean {
  return s === 'thinking'
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
//   speaking          → ⏹ Stop (silence voice — visible whether audio is
//                       playing right now or not, because TTS playback
//                       has natural silent gaps between chunks and Wael
//                        must be able to tap Stop reliably during the
//                       whole speaking phase, not just on the audible
//                       beats. V57.12.2 — replaced the prior
//                       `isAudioPlaying`-gated visibility that flickered
//                       the button off mid-speech and left users without
//                       a way to interrupt.)
//   answer_active     → ✕ Cancel (release the lock)
//   cooldown          → hidden  (lock is auto-releasing)
//   idle/pending/err  → hidden
export function isOrangeButtonVisible(s: OrchestratorStatus, _isAudioPlaying: boolean): boolean {
  if (s === 'thinking') return true;
  if (s === 'speaking') return true;
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
  enrichedUserMessage?: string;
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
  locationRules: { ruleId: string; placeName: string; address?: string | null; oneShot: boolean }[];
  timestamp?: string;
}

/** Format a cents amount + currency code into a spoken-friendly string. */
function formatMoney(cents: number, currency: string | null): string {
  const dollars = (cents / 100).toFixed(2);
  if (currency === 'USD' || currency === 'CAD') return `$${dollars}`;
  if (currency === 'EUR') return `€${dollars}`;
  if (currency === 'GBP') return `£${dollars}`;
  return currency ? `${dollars} ${currency}` : `$${dollars}`;
}

/**
 * Convert a spoken place name to a readable alert title.
 * "james's home" → "James's Home", "my office" → "My Office"
 * Only capitalizes after spaces (not after apostrophes), so "James's" stays correct.
 */
function formatLocationLabel(spokenName: string): string {
  const s = (spokenName ?? '').trim();
  if (!s) return 'Location alert';
  return s.replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/** Render a SPEND_SUMMARY period_label as a natural English phrase. */
function formatPeriodPhrase(label: string): string {
  const k = (label || '').trim().toLowerCase();
  if (k === 'last month' || k === 'this month' || k === 'last year' || k === 'this year' || k === 'today' || k === 'yesterday') return k;
  if (k === 'this week') return 'this week';
  if (k === 'past week' || k === 'last week' || k === 'past 7 days') return 'in the past week';
  if (k === 'past 30 days') return 'in the past 30 days';
  if (k === 'all time' || k === 'ever' || k === 'all') return 'in total';
  return k || 'recently';
}

// ── B6a helpers — one row per place ─────────────────────────────────────────
// 2026-05-26 (Wael, B6a) — Replace the "Open Alerts and tap Reactivate"
// bail-out with in-chat re-arm of the existing disabled rule. The DB-side
// pair is migration 20260526_action_rules_one_row_per_place.sql, which
// broadens the partial UNIQUE index to apply regardless of enabled state —
// so the same physical place can have at most one row, active or expired.
// See CLAUDE.md FOUNDATIONAL PRINCIPLE: "alerts ARE the saved-place memory".

/**
 * Re-arm an existing disabled action_rules location row.
 *   - Sets enabled=true and clears last_fired_at (so the Alerts UI no longer
 *     shows "Fired DATE" greyed out).
 *   - Optionally merges new place_name / address / radius_meters / one_shot
 *     from a freshly resolved request — falls back to the row's existing
 *     values otherwise, so user-set recipient / action_config is NEVER
 *     silently changed by re-arm (Wael 2026-05-26: "never surprises").
 *   - Returns a readback speech that names the place + mode for Rule 12.
 */
async function reArmLocationRule(
  client: any,
  existingRule: any,
  updates?: {
    place_name?: string;
    address?: string | null;
    radius_meters?: number;
    one_shot?: boolean;
    action_config?: Record<string, any>;
  },
): Promise<{ success: boolean; speech: string; ruleId: string | null }> {
  const baseTriggerConfig = existingRule?.trigger_config ?? {};
  const mergedTriggerConfig = {
    ...baseTriggerConfig,
    ...(updates?.place_name ? { place_name: updates.place_name } : {}),
    ...(updates?.address !== undefined ? { address: updates.address } : {}),
    ...(updates?.radius_meters !== undefined ? { radius_meters: updates.radius_meters } : {}),
  };
  // Merge new action_config over existing — preserves to_phone/to_email from
  // the original rule while applying any new body/note from this request.
  const mergedActionConfig = updates?.action_config
    ? { ...(existingRule?.action_config ?? {}), ...updates.action_config }
    : undefined;
  const newOneShot = updates?.one_shot ?? (existingRule?.one_shot === true);
  const placeName = String(mergedTriggerConfig.place_name ?? 'that place');
  const addrSuffix = mergedTriggerConfig.address
    ? ` at ${String(mergedTriggerConfig.address).split(',')[0]?.trim()}`
    : '';
  const modeText = newOneShot ? 'one time' : 'every time';
  try {
    const { error } = await queryWithTimeout(
      client
        .from('action_rules')
        .update({
          enabled:          true,
          last_fired_at:    null,
          last_entered_at:  null,
          last_exited_at:   null,
          one_shot:         newOneShot,
          trigger_config:   mergedTriggerConfig,
          ...(mergedActionConfig ? { action_config: mergedActionConfig } : {}),
        })
        .eq('id', existingRule.id),
      10_000,
      're-arm-existing-location-rule',
    );
    if (error) {
      console.error('[orch:loc:re-arm] update failed:', (error as any)?.message ?? error);
      return {
        success: false,
        speech:  `I couldn't re-arm your alert for ${placeName} — please try again.`,
        ruleId:  null,
      };
    }
    return {
      success: true,
      speech:  `Re-armed your alert — ${modeText} you arrive at ${placeName}${addrSuffix}.`,
      ruleId:  String(existingRule.id),
    };
  } catch (err: any) {
    console.error('[orch:loc:re-arm] threw:', err?.message ?? err);
    return {
      success: false,
      speech:  `I couldn't re-arm your alert for ${placeName} — please try again.`,
      ruleId:  null,
    };
  }
}

// Detect bullet-point or numbered compound requests in the USER's own message.
// Returns individual items, or null if not compound.
function splitUserCompound(message: string): string[] | null {
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean);
  const bulletItems = lines
    .filter(l => /^[•\-\*]\s+/.test(l))
    .map(l => l.replace(/^[•\-\*]\s+/, '').trim())
    .filter(Boolean);
  if (bulletItems.length >= 2) return bulletItems;
  const numberedItems = lines
    .filter(l => /^[1-9]\d*[.)]\s+/.test(l))
    .map(l => l.replace(/^[1-9]\d*[.)]\s+/, '').trim())
    .filter(Boolean);
  if (numberedItems.length >= 2) return numberedItems;
  return null;
}

// Extract numbered list items from Claude's pre-confirm text.
// Used by the compound pre-confirm intercept to process items one at a time.
function parseCompoundItems(text: string): string[] {
  const items: string[] = [];
  const regex = /(?:^|\n)\s*[1-9]\d*[.)]\s+([^\n]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const item = match[1].trim();
    if (item && !/^say\s+yes/i.test(item)) items.push(item);
  }
  return items;
}

// V57.11.3 — `isHandsfree` parameter retained for call-site compatibility
// but always false. Hands-free mode was removed; the phone is the always-
// listening surface. Tap-to-talk + press-and-hold-anywhere are the only
// mobile voice paths. The parameter and any handsfree branching below are
// kept temporarily to avoid a noisy file-wide refactor and will be removed
// in a follow-up cleanup. Today the value is hard-wired false.
export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = [], avoidHighways = false, _isHandsfree = false) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);

  // Compound queue — stores actions 2-N when a compound question arrives (N > 1 actions).
  // Drained one-by-one after each user "yes" or "skip".
  const compoundQueueRef = useRef<NaaviAction[]>([]);
  const compoundTotalRef = useRef<number>(0);
  // Compound pre-confirm item queue — when Claude lists N items and asks
  // "say yes to go ahead", we parse the list and send items to Claude
  // one at a time instead of asking Claude to emit all N tool calls at once.
  const pendingCompoundItemsRef = useRef<string[]>([]);

  // Word-reveal: number of words revealed so far for the latest turn while TTS
  // is playing, or null when not revealing (show full text).
  const [revealWordCount, setRevealWordCount] = useState<number | null>(null);
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Chunk-scroll sync — which TTS chunk is currently playing.
  const [currentChunk, setCurrentChunk] = useState<{ idx: number; total: number; charOffset: number; totalChars: number } | null>(null);
  useEffect(() => {
    _revealCallbacks = {
      start: (_text: string) => {
        // Show full text immediately — word-reveal was tried and removed.
        // Scroll sync is handled per-chunk via chunkStart below.
        setRevealWordCount(null);
      },
      stop: () => {
        if (revealIntervalRef.current) {
          clearInterval(revealIntervalRef.current);
          revealIntervalRef.current = null;
        }
        setRevealWordCount(null);
        setCurrentChunk(null);
      },
      chunkStart: (chunkIdx, totalChunks, charOffset, totalChars) => {
        setCurrentChunk({ idx: chunkIdx, total: totalChunks, charOffset, totalChars });
      },
    };
    return () => {
      _revealCallbacks = null;
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
    };
  }, []);

  // Always-current status ref — callbacks (like onOrangeButtonPressed) need
  // to read the current status without being recreated on every status change.
  const statusRef = useRef<OrchestratorStatus>('idle');
  // V57.12.4 Bug H instrumentation — log every status transition with a
  // wall-clock timestamp so the next reproduction shows the exact state-
  // machine path between SET_REMINDER and the crash. Use a single
  // long-lived diag session keyed off mount so transitions correlate
  // across turns. Cheap to log (one row per transition).
  const statusDiagRef = useRef<string>(newDiagSession());
  useEffect(() => {
    statusRef.current = status;
    remoteLog(statusDiagRef.current, 'status-transition', { status });
  }, [status]);

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
    // V57.11.3 — multi-result picker. When resolve-place returns
    // status='multiple', store the candidates here and let the user pick by
    // number ("two", "2") or by fuzzy match against the address ("Bank
    // Street", "the one on Innes"). Mutually exclusive with `resolved` —
    // only one is ever populated at a time.
    candidates?: Array<{
      place_name: string;
      address?: string;
      lat: number;
      lng: number;
      radius_meters: number;
      alias?: string;
      canonical_alias?: string;
    }>;
    candidatesSource?: 'fresh';
    // V57.12.1 Bug B fix — timestamp at initial creation. Pending state
    // older than 5 minutes is treated as abandoned and cleared on next
    // intercept entry, so an abandoned picker can't hijack future
    // unrelated questions (Wael 2026-05-06: 31 min old picker hijacked
    // his calendar query).
    createdAt: number;
  } | null>(null);

  // Cross-turn state for DELETE_RULE disambiguation. When a delete matched
  // multiple rules and all=false, Naavi asks "which one?" Next turn the user
  // may reply "all" / "all of them" / a specific hint — without this state
  // the reply just triggers another fresh DELETE_RULE and loops. Pre-send()
  // intercepts "all"/"every" here and deletes the previously-matched set.
  const pendingDeleteRef = useRef<{
    match: string;
    matchIds: string[]; // rule ids shown in the disambiguation
    // B2l (2026-05-19) — set when ANY of the matched rules is a location
    // rule, so the bulk-delete branch below knows whether to re-sync the
    // Transistorsoft SDK after the deletes land. Without the sync the SDK
    // keeps the geofence registered and fires orphan ENTER events.
    hasLocation: boolean;
  } | null>(null);

  // B6h (2026-06-10) — single-match confirm-before-delete state. When the
  // pre-Claude delete-intent intercept finds exactly 1 matching rule, it
  // stashes it here and asks the user to confirm. On "yes" the deletion runs
  // deterministically without going back to Claude (who confabulated "Done"
  // without emitting DELETE_RULE — the demonstrated bug class).
  const pendingConfirmDeleteRef = useRef<{
    ruleId: string;
    label: string;    // human-readable summary shown in the confirm prompt
    isLocation: boolean;
  } | null>(null);

  // B2l (2026-05-19) — re-sync geofences with the SDK after a delete so
  // the deleted rule's geofence is removed from the device. Otherwise the
  // SDK keeps firing orphan ENTERs that the server rejects silently at
  // T1 (geofence-T1-rule-lookup-null). Fire-and-forget; never blocks the
  // chat turn.
  const syncGeofencesAfterDelete = (userId: string) => {
    import('@/hooks/useGeofencing')
      .then(({ syncGeofencesForUser }) => syncGeofencesForUser(userId))
      .catch(err => console.error('[Orchestrator] sync after delete failed:', err));
  };

  // Always-current ref — send() reads this so it never uses a stale brief
  const briefRef = useRef(briefItems);
  useEffect(() => { briefRef.current = briefItems; }, [briefItems]);

  // V57.11.3 — handsfreeRef removed. Hands-free mode is gone; this is
  // kept as a const-false sentinel so the few remaining branch checks
  // below (to be cleaned up later) compile and short-circuit correctly.
  const handsfreeRef = { current: false } as const;

  // Derive history for Claude context from turns
  const historyRef = useRef<NaaviMessage[]>([]);
  useEffect(() => {
    historyRef.current = turns.flatMap(t => [
      { role: 'user' as const,      content: t.enrichedUserMessage ?? t.userMessage },
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

  // ── Compound queue helpers ──────────────────────────────────────────────────
  // Build the description + execute closure for one queued action.
  // Returns null if the action type is unsupported (caller skips and advances).
  const buildQueueStep = async (
    action: NaaviAction,
  ): Promise<{ description: string; execute: () => Promise<{ ok: boolean; speech: string }> } | null> => {
    if (action.type === 'DRAFT_MESSAGE') {
      const to      = String((action as any).to      ?? '').trim();
      const subject = String((action as any).subject ?? '');
      const body    = String((action as any).body    ?? '');
      let resolvedEmail: string | null = to.includes('@') ? to : null;
      if (!resolvedEmail) { const c = await lookupContact(to); resolvedEmail = c?.email ?? null; }
      if (!resolvedEmail) return null;
      return {
        description: `email ${to}${subject ? ` — "${subject}"` : ''}`,
        execute: async () => {
          try {
            const result = await registry.email.send({
              to: [{ name: resolvedEmail !== to ? to : '', email: resolvedEmail! }],
              subject, body,
            });
            return result.success ? { ok: true, speech: SPEECH.SENT } : { ok: false, speech: SPEECH.GENERIC_ERROR };
          } catch { return { ok: false, speech: SPEECH.GENERIC_ERROR }; }
        },
      };
    }

    if (action.type === 'CREATE_EVENT') {
      const summary = String((action as any).summary ?? 'event');
      const start   = String((action as any).start   ?? '');
      let dateSpeech = '';
      try {
        dateSpeech = new Date(start).toLocaleString('en-CA', {
          timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        });
      } catch { /* ignore */ }
      return {
        description: `add "${summary}" to your calendar${dateSpeech ? ` — ${dateSpeech}` : ''}`,
        execute: async () => {
          try {
            const event = await registry.calendar.createEvent({
              title:       summary,
              description: String((action as any).description ?? ''),
              startISO:    start,
              endISO:      String((action as any).end ?? ''),
              attendees:   Array.isArray((action as any).attendees)
                ? (action as any).attendees.map((e: any) => ({ name: '', email: String(e) }))
                : [],
            });
            setTurns(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) updated[updated.length - 1] = { ...last, createdEvents: [...(last.createdEvents ?? []), { summary: event.title, htmlLink: event.htmlLink }] };
              return updated;
            });
            return { ok: true, speech: 'Done.' };
          } catch { return { ok: false, speech: SPEECH.GENERIC_ERROR }; }
        },
      };
    }

    if (action.type === 'REMEMBER') {
      const text = String((action as any).text ?? '').trim();
      if (!text) return null;
      return {
        description: `remember: ${text.slice(0, 80)}`,
        execute: async () => {
          try {
            const fragments = await ingestNote(text, 'stated');
            setTurns(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) updated[updated.length - 1] = { ...last, rememberedItems: [...(last.rememberedItems ?? []), { text, count: fragments.length }] };
              return updated;
            });
            return { ok: true, speech: 'Saved.' };
          } catch { return { ok: false, speech: SPEECH.GENERIC_ERROR }; }
        },
      };
    }

    if (action.type === 'SET_ACTION_RULE') {
      const triggerType = String((action as any).trigger_type ?? '');
      const tc    = (action as any).trigger_config  ?? {};
      const ac    = (action as any).action_config   ?? {};
      const label = String((action as any).label    ?? '');

      if (triggerType === 'time') {
        const datetime  = String(tc.datetime ?? '');
        let timeSpeech  = '';
        try { timeSpeech = new Date(datetime).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', hour: 'numeric', minute: '2-digit' }); } catch { /* ignore */ }
        const taskStr = Array.isArray(ac.tasks) && ac.tasks.length > 0 ? `: ${(ac.tasks as string[]).join(', ')}` : '';
        const desc    = label || `reminder ${timeSpeech ? `on ${timeSpeech}` : ''}${taskStr}`;
        return {
          description: desc,
          execute: async () => {
            try {
              const session = await getSessionWithTimeout();
              if (!session?.user?.id) return { ok: false, speech: SPEECH.GENERIC_ERROR };
              const { data: inserted, error: insErr } = await queryWithTimeout(
                supabase.from('action_rules').insert({
                  user_id:        session.user.id,
                  trigger_type:   'time',
                  trigger_config: tc,
                  action_type:    String((action as any).action_type ?? 'sms'),
                  action_config:  ac,
                  label:          label || desc,
                  one_shot:       (action as any).one_shot !== false,
                  enabled:        true,
                }).select('id').single(),
                15_000,
                'cq-insert-time-rule',
              );
              if (insErr) {
                // 23505 = unique_violation — a rule already exists at this datetime.
                // Merge tasks/list_name into the existing rule instead of failing.
                if ((insErr as any).code === '23505') {
                  const newTasks: string[] = Array.isArray(ac.tasks) ? (ac.tasks as string[])
                    : (typeof ac.body === 'string' && ac.body ? [ac.body] : []);
                  const newListName = String(ac.list_name ?? '').trim();
                  const dtVal = String((tc as any).datetime ?? '');
                  const { data: existing } = await queryWithTimeout(
                    (supabase.from('action_rules').select('id, action_config')
                      .eq('user_id', session.user.id).eq('trigger_type', 'time').eq('enabled', true)
                      .filter('trigger_config->>datetime', 'eq', dtVal) as any).maybeSingle(),
                    10_000, 'cq-find-time-rule',
                  );
                  if (existing) {
                    const ec = (existing as any).action_config ?? {};
                    const merged: Record<string, any> = { ...ec };
                    if (newTasks.length > 0) {
                      const et: string[] = Array.isArray(ec.tasks) ? ec.tasks : [];
                      merged.tasks = [...new Set([...et, ...newTasks])];
                    }
                    if (newListName) merged.list_name = newListName;
                    await supabase.from('action_rules').update({ action_config: merged }).eq('id', (existing as any).id);
                    if (newListName) ensureListAttachedToRule(String((existing as any).id), newListName).catch(() => {});
                    return { ok: true, speech: 'Done. Added to your existing reminder at that time.' };
                  }
                }
                return { ok: false, speech: SPEECH.GENERIC_ERROR };
              }
              if (!(inserted as any)?.id) return { ok: false, speech: SPEECH.GENERIC_ERROR };
              const listRef = String(ac.list_name ?? '').trim();
              if (listRef) ensureListAttachedToRule(String((inserted as any).id), listRef).catch(() => {});
              return { ok: true, speech: 'Done.' };
            } catch { return { ok: false, speech: SPEECH.GENERIC_ERROR }; }
          },
        };
      }

      if (triggerType === 'location') {
        const placeName  = String(tc.place_name ?? '');
        const listRef    = String(ac.list_name  ?? '').trim();
        const tasks      = Array.isArray(ac.tasks) ? (ac.tasks as string[]) : [];
        const listStr    = listRef  ? ` with your ${listRef} list`       : '';
        const taskStr    = tasks.length > 0 ? ` with: ${tasks.join(', ')}` : '';
        return {
          description: `alert when you arrive at ${placeName}${listStr}${taskStr}`,
          execute: async () => {
            try {
              const session = await getSessionWithTimeout();
              if (!session?.user?.id) return { ok: false, speech: SPEECH.GENERIC_ERROR };
              const accessToken = (await supabase.auth.getSession())?.data?.session?.access_token ?? '';
              const resolveRes = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
                body:    JSON.stringify({ query: placeName, user_id: session.user.id }),
              }, 15_000);
              const resolveData = resolveRes.ok ? await resolveRes.json() : null;
              if (!resolveData || (resolveData.status !== 'ok' && resolveData.status !== 'memory')) {
                return { ok: false, speech: `I couldn't verify that location. Please set this alert separately.` };
              }
              const { data: inserted, error: insErr } = await queryWithTimeout(
                supabase.from('action_rules').insert({
                  user_id:        session.user.id,
                  trigger_type:   'location',
                  trigger_config: {
                    place_name:    resolveData.place_name || placeName,
                    address:       resolveData.address ?? null,
                    resolved_lat:  resolveData.lat,
                    resolved_lng:  resolveData.lng,
                    radius_meters: resolveData.radius_meters ?? 300,
                    direction:     tc.direction ?? 'arrive',
                  },
                  action_type:    String((action as any).action_type ?? 'sms'),
                  action_config:  ac,
                  label:          label || `${placeName} arrival`,
                  one_shot:       (action as any).one_shot !== false,
                  enabled:        true,
                }).select('id').single(),
                15_000,
                'cq-insert-location-rule',
              );
              const isDup = (insErr as any)?.code === '23505' || /duplicate|already exists/i.test(insErr?.message ?? '');
              if (insErr) return { ok: isDup, speech: isDup ? `You already have an alert for ${placeName}.` : SPEECH.GENERIC_ERROR };
              if (!(inserted as any)?.id) return { ok: false, speech: SPEECH.GENERIC_ERROR };
              if (listRef) ensureListAttachedToRule(String((inserted as any).id), listRef).catch(() => {});
              import('@/hooks/useGeofencing')
                .then(({ syncGeofencesForUser }) => syncGeofencesForUser(session.user.id))
                .catch(() => {});
              return { ok: true, speech: 'Done.' };
            } catch { return { ok: false, speech: SPEECH.GENERIC_ERROR }; }
          },
        };
      }
    }

    return null; // unsupported type — caller skips and advances
  };

  // Advance the compound queue: pop the next action, speak its description,
  // and set pendingAction so the user can say "yes" or "skip".
  const advanceCompoundQueue = async (lang: 'en' | 'fr'): Promise<void> => {
    const queue = compoundQueueRef.current;
    if (queue.length === 0) {
      const total = compoundTotalRef.current;
      if (total > 1) await speakResponse(`All done — ${total} of ${total}.`, lang);
      setStatus('idle');
      return;
    }

    // Auto-discard any unconfirmed DRAFT_MESSAGE cards in prior turns before
    // advancing — they would otherwise stay visible with live Send/Discard buttons
    // while Naavi has already moved to the next compound item.
    setTurns(prev => prev.map(t => ({
      ...t,
      drafts: (t.drafts ?? []).map((d: any) =>
        d.type === 'DRAFT_MESSAGE' && !d._voiceConfirmed ? { ...d, _discarded: true } : d
      ),
    })));

    const action = queue[0];
    compoundQueueRef.current = queue.slice(1);
    const isLast   = compoundQueueRef.current.length === 0;
    const stepNum  = compoundTotalRef.current - queue.length + 1;
    const prefix   = isLast ? 'Last one —' : 'Next —';

    setStatus('speaking');

    const step = await buildQueueStep(action);
    if (!step) {
      // Unsupported type — skip silently and advance
      await advanceCompoundQueue(lang);
      return;
    }

    const { description, execute } = step;
    const pending: PendingAction = {
      id:         `cq-${Date.now()}-${stepNum}`,
      action,
      summary:    description,
      turnIndex:  -1, // queue actions attach to the last turn at execution time
      execute,
    };
    pendingActionRef.current = pending;
    setPendingAction(pending);

    await speakResponse(`${prefix} ${description}. Say yes to confirm, or skip.`, lang);
    setStatus('idle');
  };
  // ── end compound queue helpers ──────────────────────────────────────────────

  const send = useCallback(async (userMessage: string) => {
    // V57.11.6 — instrumentation for the bubble-truncation bug. Wael
    // 2026-05-05: typed "What is my next meeting?" but bubble shows
    // "What is my next". Voice path same. Logging every step of the
    // userMessage path so we can pinpoint where "meeting?" disappears.
    const bubbleDiag = newDiagSession();
    remoteLog(bubbleDiag, 'send-entry', {
      len: userMessage.length,
      head: userMessage.slice(0, 60),
      tail: userMessage.slice(-30),
    });
    // Pending_confirm is the directed yes/no/edit listening state — it has its
    // own resolution paths (confirmPending, cancelPending, editPending). Don't
    // start a new turn from here; the lock UI shouldn't allow it anyway.
    if (status === 'pending_confirm') return;

    // V57.11 — send() may be called while Naavi is still speaking the
    // previous reply (e.g. user types a clarification answer while
    // Naavi's "Is that in Ottawa?" TTS is still playing). Silence the
    // ongoing audio so it doesn't collide with the new turn's response.
    if (status === 'speaking' || status === 'answer_active') {
      stopSpeaking();
      setAudioPlaying(false);
    }

    // V57.11.6 — clear any leftover pending action from a prior turn so
    // each new send() starts fresh. Avoids stale pendingActionRef
    // accumulating across turns now that the speak-phase no longer
    // auto-clears (DraftCard Send fix). Cancel teardown is handled by
    // the user via the DraftCard's Discard button.
    //
    // 2026-05-25 BUG FIX: before clearing, intercept yes/no/send so the
    // user can confirm or cancel a pending draft by typing rather than
    // only by tapping the DraftCard buttons. Previously "Send." was
    // cleared here then sent to Claude, which did nothing with it.
    if (pendingActionRef.current) {
      const trimmedMsg = userMessage.trim();
      if (AFFIRMATIVE_RE.test(trimmedMsg)) {
        // Inline confirm: execute the pending action without routing to Claude.
        const pending = pendingActionRef.current;
        pendingActionRef.current = null;
        setPendingAction(null);
        setStatus('speaking');
        try {
          const result = await pending.execute();
          if (result.ok) {
            setTurns(prev => {
              const updated = [...prev];
              const turn = updated[pending.turnIndex];
              if (turn) {
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
          await speakResponse(result.speech, language);
        } catch (e) {
          console.error('[send] inline confirmPending error:', e);
          await speakResponse(SPEECH.GENERIC_ERROR, language);
        }
        // Advance compound queue if more actions are waiting
        if (compoundQueueRef.current.length > 0) {
          await advanceCompoundQueue(language);
        } else {
          setStatus('idle');
        }
        return;
      }
      if (CORRECTION_RE.test(trimmedMsg)) {
        // Correction ("I meant X", "No, I meant X"): clear the pending
        // action and fall through to Claude with the full message so Claude
        // can re-process using the corrected text. Must be tested BEFORE
        // NEGATIVE_RE to prevent "No, I meant X" from being swallowed as
        // a bare cancel.
        pendingActionRef.current = null;
        setPendingAction(null);
        // fall through to Claude round-trip
      } else if (NEGATIVE_RE.test(trimmedMsg)) {
        // Inline cancel / skip for compound queue.
        pendingActionRef.current = null;
        setPendingAction(null);
        setStatus('speaking');
        const skipSpeech = compoundQueueRef.current.length > 0 ? 'Skipped.' : SPEECH.CANCELLED;
        await speakResponse(skipSpeech, language);
        if (compoundQueueRef.current.length > 0) {
          await advanceCompoundQueue(language);
        } else {
          setStatus('idle');
        }
        return;
      } else {
        // Fresh command (edit / new question) — clear the pending action and
        // let Claude handle the message normally (edit flow).
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    } else if (compoundQueueRef.current.length > 0 && AFFIRMATIVE_RE.test(userMessage.trim())) {
      // Compound queue is mid-flight but pendingActionRef is momentarily null
      // (race: confirmPending/inline-confirm cleared it before advanceCompoundQueue
      // set it for the next item). Block this "Yes" from reaching Claude — the
      // queue will continue on its own once the current step resolves.
      console.log('[send] compound queue active + affirmative during null-pending window — suppressing Claude round-trip');
      return;
    } else if (AFFIRMATIVE_RE.test(userMessage.trim())) {
      // Fallback: pendingActionRef is null but user typed Yes.
      // Check if the last turn has an unsent confirmable draft.
      const lastTurn = turns[turns.length - 1];
      const lastDraft = lastTurn?.drafts?.find(d => isConfirmable(d) && !(d as any)._voiceConfirmed);
      if (lastDraft) {
        const dChannel = String((lastDraft as any).channel ?? 'email').toLowerCase();
        const dTo = String((lastDraft as any).to ?? '').trim();
        const dIsMsg = dChannel === 'sms' || dChannel === 'whatsapp';
        let dPhone: string | null = null;
        let dEmail: string | null = null;
        if (dIsMsg) {
          const s = dTo.replace(/[^+\d]/g, '');
          dPhone = s.startsWith('+') ? s : /^\d{10}$/.test(s) ? `+1${s}` : /^\d{7,15}$/.test(s) ? `+${s}` : null;
          if (!dPhone) { const c = await lookupContact(dTo); if (c?.phone) { const s2 = c.phone.replace(/[^+\d]/g, ''); dPhone = s2.startsWith('+') ? s2 : s2.length === 10 ? `+1${s2}` : s2.length >= 7 ? `+${s2}` : null; } }
        } else {
          dEmail = dTo.includes('@') ? dTo : null;
          if (!dEmail) { const c = await lookupContact(dTo); dEmail = c?.email ?? null; }
        }
        if ((dIsMsg && dPhone) || (!dIsMsg && dEmail)) {
          setStatus('speaking');
          try {
            let dResult: { ok: boolean; speech: string };
            if (dIsMsg) {
              const { data: dData, error: dErr } = await invokeWithTimeout('send-sms', { body: { to: dPhone, body: String((lastDraft as any).body ?? ''), channel: dChannel } }, 30_000);
              dResult = { ok: !dErr && !!dData?.success, speech: !dErr && dData?.success ? SPEECH.SENT : SPEECH.GENERIC_ERROR };
            } else {
              const dR = await registry.email.send({ to: [{ name: dEmail !== dTo ? dTo : '', email: dEmail! }], subject: String((lastDraft as any).subject ?? ''), body: String((lastDraft as any).body ?? '') });
              dResult = { ok: dR.success, speech: dR.success ? SPEECH.SENT : SPEECH.GENERIC_ERROR };
            }
            if (dResult.ok) {
              setTurns(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0) {
                  const di = updated[lastIdx].drafts.findIndex(d => d === lastDraft);
                  if (di >= 0) {
                    const ud = [...updated[lastIdx].drafts];
                    ud[di] = { ...ud[di], _voiceConfirmed: true };
                    updated[lastIdx] = { ...updated[lastIdx], drafts: ud };
                  }
                }
                return updated;
              });
            }
            await speakResponse(dResult.speech, language);
          } catch (e) {
            console.error('[send] draft-fallback error:', e);
            await speakResponse(SPEECH.GENERIC_ERROR, language);
          }
          setStatus('idle');
          return;
        }
      }
    }

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
    // grey out (mic/Voice still does — Send remains usable for the next
    // typed reply during the speaking phase, see isSendLocked).
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
            // B2l — re-sync if any deleted rule was a location rule.
            if (okCount > 0 && matches.some(r => r.trigger_type === 'location')) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.id) syncGeofencesAfterDelete(session.user.id);
            }
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

    // ── B6h: PENDING CONFIRM-DELETE — "yes" / "no" on a single-match ────────
    // When the delete-intent intercept found exactly 1 matching rule, it asked
    // the user to confirm. This intercept catches the response and either runs
    // the deletion or cancels, without involving Claude at all.
    if (pendingConfirmDeleteRef.current && supabase) {
      const msg = userMessage.trim().toLowerCase();
      const isYes    = POSITIVE_RE.test(msg);
      const isCancel = NEGATIVE_RE.test(msg);
      if (isYes) {
        const { ruleId, label, isLocation } = pendingConfirmDeleteRef.current;
        pendingConfirmDeleteRef.current = null;
        try {
          const res = await invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: ruleId } }, 15_000);
          const ok = !(res as any)?.error && (res as any)?.data?.ok === true;
          if (ok && isLocation && supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) syncGeofencesAfterDelete(session.user.id);
          }
          const speech = ok
            ? `Done — deleted ${label}.`
            : `I couldn't delete that alert. Please try again.`;
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
          pendingConfirmDeleteRef.current = null;
          if (isCancelled()) return;
          console.error('[Orchestrator] B6h confirm-delete failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
        return;
      } else if (isCancel) {
        pendingConfirmDeleteRef.current = null;
        // Fall through to Claude so the user can ask something else.
      }
      // Any other reply — treat as cancel + fall through.
      else {
        pendingConfirmDeleteRef.current = null;
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
        const hadLocation = pendingDeleteRef.current.hasLocation;
        pendingDeleteRef.current = null;
        try {
          const results = await Promise.allSettled(ids.map(id =>
            invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: id } }, 15_000),
          ));
          const okCount = results.filter(r => r.status === 'fulfilled' && !(r as any).value?.error).length;
          const speech  = okCount === ids.length
            ? `Done — deleted all ${ids.length} ${label ? label + ' ' : ''}alerts.`
            : `Deleted ${okCount} of ${ids.length}. ${ids.length - okCount} couldn't be removed.`;
          // B2l — re-sync if any deleted rule was a location rule.
          if (okCount > 0 && hadLocation) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) syncGeofencesAfterDelete(session.user.id);
          }
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

      // V57.12.1 Bugs A, B, C fix — escape + timeout check at intercept entry.
      // Bug B: pending-location state with no timeout would survive across
      //   many minutes / many turns, hijacking unrelated questions into
      //   the clarification path. 5-minute auto-expire prevents that.
      // Bugs A + C: when user types a question / fresh command, drop pending
      //   and let Claude answer normally — instead of falling into the
      //   clarification path that re-resolved with a polluted query and
      //   silently re-established pending. This check now applies BEFORE
      //   any of the picker / resolved / clarification sub-states.
      const ageMs = Date.now() - (pending.createdAt ?? 0);
      const isStale  = ageMs > 5 * 60 * 1000;
      const isEscape = QUESTION_ESCAPE_RE.test(msg) || FRESH_COMMAND_RE.test(msg);
      if (isStale || isEscape) {
        if (isStale)  console.log(`[Orchestrator] pending location expired (${Math.round(ageMs/1000)}s old) — dropping`);
        if (isEscape) console.log('[Orchestrator] pending location dropped — escape pattern at intercept entry');
        pendingLocationRef.current = null;
        // Fall through to normal Claude flow (skip the entire intercept body
        // below). Use a labeled block to avoid re-indenting ~360 lines.
      } else {
      const isYes = AFFIRMATIVE_RE.test(msg);
      const isNo  = NEGATIVE_RE.test(msg);

      // Helper — emit a turn AND speak the reply. Optionally accepts a
      // location-rule card to attach (V57.4 Part B). V57.13 — previously the
      // helper skipped speakResponse and went straight to 'idle', which made
      // every picker-resolution reply silent (Bug S) and also hid the Stop
      // button (visible only while convState === 'speaking', Bug T). Now we
      // route through the same speaking → idle transition the rest of the
      // orchestrator uses, so picker replies have voice AND the Stop button
      // stays visible until speech ends.
      const emitPendingTurn = (
        speech: string,
        locationRules: { ruleId: string; placeName: string; address?: string | null; oneShot: boolean }[] = [],
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
        if (speech?.trim()) {
          setStatus('speaking');
          setAudioPlaying(true);
          speakResponse(speech, language).finally(() => {
            setAudioPlaying(false);
            setStatus('idle');
          });
        } else {
          setStatus('idle');
        }
      };

      // Helper — commit the pending rule (used by yes-path AND clarification-memory-hit-path).
      // V57.4 Part B — returns the inserted rule id so callers can render the
      // toggle card.
      const commitPending = async (
        sessionUserId: string,
        _sourceLabel: 'confirmed' | 'memory',
      ): Promise<{
        ok: boolean;
        ruleId: string | null;
        reactivated?: boolean;
        merged?: boolean;
        alreadyExists?: { ruleId: string; placeName: string; address: string | null; oneShot: boolean; enabled: boolean };
      }> => {
        if (!pending.resolved) return { ok: false, ruleId: null };
        // V57.13.3 — pre-INSERT duplicate check. Before creating the action_rule,
        // query for any existing location rule at the same rounded coordinates
        // for this user. If found:
        //   ENABLED dupe  → return alreadyExists so consumer says "you already have this"
        //   DISABLED dupe → re-enable it in-place (2026-05-25 B4z+ fix).
        //     Previous behavior: told user to "tap Reactivate in the Alerts screen."
        //     New behavior: UPDATE enabled=true directly in chat when user says
        //     "alert me at X" and X matches a fired/expired one-shot rule.
        //     The user's intent is clear — they want an active alert. Re-enable it.
        const epsilon = 0.00001; // 5-decimal rounding tolerance
        const lat = pending.resolved.lat;
        const lng = pending.resolved.lng;
        const { data: existingRules } = await queryWithTimeout(
          supabase
            .from('action_rules')
            .select('id, trigger_config, one_shot, enabled')
            .eq('user_id', sessionUserId)
            .eq('trigger_type', 'location'),
          10_000,
          'check-duplicate-location-rule',
        );
        if (Array.isArray(existingRules)) {
          const dupe = existingRules.find((r: any) => {
            const rLat = r?.trigger_config?.resolved_lat;
            const rLng = r?.trigger_config?.resolved_lng;
            if (typeof rLat !== 'number' || typeof rLng !== 'number') return false;
            return Math.abs(rLat - lat) < epsilon && Math.abs(rLng - lng) < epsilon;
          });
          if (dupe) {
            if (dupe.enabled === false) {
              // 2026-05-26 (Wael, B6a) — re-arm via shared helper. Clears
              // last_fired_at (the prior inline implementation omitted that,
              // leaving the Alerts UI showing "Fired DATE" on a freshly
              // re-armed row). All three location re-arm sites now share
              // the same behavior. Existing action_config preserved.
              const armResult = await reArmLocationRule(supabase, dupe, {
                place_name:    pending.resolved.place_name,
                address:       pending.resolved.address ?? null,
                radius_meters: pending.resolved.radius_meters
                  ?? (pending.originalAction?.trigger_config as any)?.radius_meters
                  ?? 300,
                one_shot:      pending.originalAction?.one_shot ?? (dupe.one_shot === true),
                action_config: pending.originalAction?.action_config as Record<string, any> | undefined,
              });
              if (!armResult.success) {
                return { ok: false, ruleId: null };
              }
              return { ok: true, ruleId: armResult.ruleId, reactivated: true };
            }
            // Enabled dupe — merge tasks/list if new content, otherwise inform user.
            const newTasks    = Array.isArray(pending.originalAction?.action_config?.tasks) ? (pending.originalAction!.action_config as any).tasks as string[] : [];
            const newListName = String((pending.originalAction?.action_config as any)?.list_name ?? '').trim();
            if (newTasks.length > 0 || newListName) {
              const { data: mergeData, error: mergeErr } = await invokeWithTimeout<any>(
                'manage-rules',
                { body: { op: 'merge_tasks', rule_id: dupe.id, tasks: newTasks.length > 0 ? newTasks : undefined, list_name: newListName || undefined } },
                10_000,
              );
              if (!mergeErr && mergeData?.ok) {
                return { ok: true, ruleId: String(dupe.id), reactivated: false, merged: true };
              }
            }
            return {
              ok: false,
              ruleId: null,
              alreadyExists: {
                ruleId: String(dupe.id),
                placeName: String(dupe.trigger_config?.place_name ?? pending.resolved.place_name),
                address: (dupe.trigger_config?.address as string | undefined) ?? null,
                oneShot: !!dupe.one_shot,
                enabled: true,
              },
            };
          }
        }
        // V57.11 — explicitly carry radius_meters into trigger_config.
        // V57.13.3 — also carry `address` so the UI can render the street
        // when this rule is fetched later (e.g. in the duplicate-detection
        // prompt).
        const triggerConfig = {
          ...(pending.originalAction?.trigger_config ?? {}),
          place_name: pending.resolved.place_name,
          address: pending.resolved.address ?? null,
          resolved_lat: pending.resolved.lat,
          resolved_lng: pending.resolved.lng,
          radius_meters: pending.resolved.radius_meters
            ?? (pending.originalAction?.trigger_config as any)?.radius_meters
            ?? 300,
        };
        // V57.18 — location alerts default to RECURRING (one_shot=false). See
        // matching note in the SET_ACTION_RULE intercept below.
        // V57.19 — reverted from V57.18 default flip after the 2026-05-17
// stationary-re-fire bug. Wael received a phantom "you arrived home" alert
// while sitting at home (never moved). Root cause: SDK re-fires ENTER
// opportunistically on a stationary device, and the V57.18 recurring-by-
// default meant each re-fire fanouts. one_shot=true (one-time) default
// auto-disables the rule after first fire — re-fires fanout nothing.
// User says "every time" / "always" / "whenever" → one_shot:false (recurring,
// guarded by the V57.17/V57.18 state machine).
const oneShot = pending.originalAction?.one_shot ?? true;
        // F5c — resolve task strings into structured task_actions at set-time
        // so evaluate-rules can auto-execute them (send SMS/email) when the
        // alert fires, rather than just surfacing them as reminder notes.
        const rawTasks = Array.isArray((pending.originalAction?.action_config as any)?.tasks)
          ? (pending.originalAction!.action_config as any).tasks as string[]
          : [];
        const resolvedTaskActions = await resolveTaskActions(rawTasks);
        const baseActionConfig = pending.originalAction?.action_config ?? {};
        const actionConfigWithTasks = resolvedTaskActions.length > 0
          ? { ...baseActionConfig, task_actions: resolvedTaskActions }
          : baseActionConfig;
        const { data: insertedRule, error } = await queryWithTimeout(
          supabase
            .from('action_rules')
            .insert({
              user_id:        sessionUserId,
              trigger_type:   'location',
              trigger_config: triggerConfig,
              action_type:    String(pending.originalAction?.action_type ?? 'sms'),
              action_config:  actionConfigWithTasks,
              label:          formatLocationLabel(pending.placeName) || String(pending.originalAction?.label ?? 'Location alert'),
              one_shot:       oneShot,
            })
            .select('id')
            .single(),
          15_000,
          'insert-location-rule',
        );
        // V57.6 — strict success requires BOTH no error AND a real row id.
        if (error || !insertedRule?.id) {
          console.error('[Orchestrator] pending location insert failed:', error?.message ?? 'no row returned');
          return { ok: false, ruleId: null };
        }
        // V57.13.3 — save-to-cache call removed. user_places no longer exists;
        // action_rules carries the resolved coordinates the geofence registry
        // needs.
        // 2026-05-20 (Wael, B4j) — eager-create list + connection when the
        // rule's action_config carries a list_name reference. Same pattern
        // as the memory-hit + non-location SET_ACTION_RULE paths.
        const _ac = pending.originalAction?.action_config as any;
        const listNameRef = String(_ac?.list_name ?? '').trim();
        if (listNameRef) {
          ensureListAttachedToRule(String(insertedRule.id), listNameRef)
            .then(r => {
              if (r.success) console.log(`[Orchestrator] B4j ensureList commit-pending: listLabel="${r.listLabel}" created=${r.created}`);
              else console.error('[Orchestrator] B4j ensureList commit-pending failed:', r.error);
            })
            .catch(err => console.error('[Orchestrator] B4j ensureList commit-pending threw:', err));
        }
        // V57.13 — fire-and-forget. Awaiting syncGeofencesForUser added ~7-8s
        // between user "yes" and the chat turn rendering (Bug U). Geofence
        // wiring runs in the background; the rule is already in the DB by
        // the time we get here.
        import('@/hooks/useGeofencing')
          .then(({ syncGeofencesForUser }) => syncGeofencesForUser(sessionUserId))
          .catch((err) => console.error('[Orchestrator] geofence sync after confirmed location rule:', err));
        // V57.9.7 — first-time battery-exemption nudge so Robert's
        // arrival alerts actually fire on time (Wael 2026-05-01: 28-min
        // delay due to Android Doze).
        maybePromptBatteryExemption().catch(() => {});
        return { ok: true, ruleId: insertedRule?.id ? String(insertedRule.id) : null };
      };

      // ── CASE: V57.11.3 — multi-candidate picker turn ─────────────────────
      // Pending has 2+ candidates from a bare-brand resolve. User picks by
      // number ("two") or street name ("Bank"). Memory picks commit
      // immediately (already saved); fresh picks defer for "yes" confirm.
      // Mutually exclusive with the resolved/yes path below.
      if (pending.candidates && pending.candidates.length >= 2) {
        if (isNo) {
          pendingLocationRef.current = null;
          emitPendingTurn('Cancelled.');
          return;
        }
        if (QUESTION_ESCAPE_RE.test(msg) || FRESH_COMMAND_RE.test(msg)) {
          console.log('[Orchestrator] candidate picker dropped — user asked a question / fresh command');
          pendingLocationRef.current = null;
          // Fall through to normal Claude flow.
        } else {
          const idx = parseLocationPick(msg, pending.candidates);
          if (idx >= 0) {
            const sel = pending.candidates[idx];
            pending.resolved = {
              place_name: sel.place_name,
              address: sel.address,
              lat: sel.lat,
              lng: sel.lng,
              canonical_alias: sel.canonical_alias,
              radius_meters: sel.radius_meters,
            };
            pending.candidates = undefined;
            pending.candidatesSource = undefined;
            // V57.13.3 — picker candidates are always fresh Google results now
            // (memory cache removed). Defer for explicit yes confirmation.
            pendingLocationRef.current = pending;
            emitPendingTurn(`Found ${sel.place_name}${sel.address ? ' at ' + sel.address : ''}. Say yes to set the alert, cancel to skip, or give me a different area.`);
            return;
          }

          // No clear pick match — re-prompt with the same list.
          pending.attempts += 1;
          if (pending.attempts > 3) {
            pendingLocationRef.current = null;
            emitPendingTurn(`I couldn't tell which '${pending.placeName}' you meant. Please call me back with the street name.`);
            return;
          }
          const lines = pending.candidates.map((c, i) => {
            const seg = String(c.address || '').split(',')[0]?.trim() || c.place_name;
            return `${i + 1}. ${seg}`;
          });
          pendingLocationRef.current = pending;
          emitPendingTurn(`I'm not sure which one.\n${lines.join('\n')}\nSay a number or the street name. Or say cancel to stop.`);
          return;
        }
      }

      // ── CASE: yes + we have a resolved place → commit
      if (isYes && pending.resolved) {
        const session = await getSessionWithTimeout();
        if (!session?.user) {
          pendingLocationRef.current = null;
          emitPendingTurn("I'm not signed in. Please sign in and try again.");
          return;
        }
        // V57.10.2 — gap-fix: V57.10.1's permission check lived only in the
        // SET_ACTION_RULE intercept (memory-hit path). Rules that take the
        // pending-confirmation path (resolve-place hit / user said "yes")
        // bypassed it and could be saved without "Allow all the time"
        // permission, leaving the user with a silent rule that never fires.
        // Mirror the same check here.
        try {
          const bgInitial = await Location.getBackgroundPermissionsAsync();
          if (bgInitial.status !== 'granted') {
            const fgReq = await Location.requestForegroundPermissionsAsync();
            if (fgReq.status === 'granted') {
              await Location.requestBackgroundPermissionsAsync();
            }
            const bgFinal = await Location.getBackgroundPermissionsAsync();
            if (bgFinal.status !== 'granted') {
              pendingLocationRef.current = null;
              emitPendingTurn(`Please pick 'Allow all the time' so I can alert you at ${pending.resolved.place_name}.`);
              return;
            }
          }
        } catch (err) {
          console.error('[orch:loc:pending] permission check threw:', err);
        }
        const { ok, ruleId, reactivated, merged, alreadyExists } = await commitPending(session.user.id, 'confirmed');
        // Enabled dupe — user already has an active alert here.
        if (alreadyExists) {
          const existingMode = alreadyExists.oneShot ? 'one-time' : 'recurring';
          const addrSuffix = alreadyExists.address
            ? ` at ${String(alreadyExists.address).split(',')[0]?.trim()}`
            : '';
          pendingLocationRef.current = null;
          emitPendingTurn(`You already have a ${existingMode} alert for ${alreadyExists.placeName}${addrSuffix}. Say "list my alerts" if you want to change or remove it.`);
          return;
        }
const oneShot = pending.originalAction?.one_shot ?? true;
        const modeText = oneShot ? 'one time' : 'every time';
        const newTasks = Array.isArray((pending.originalAction?.action_config as any)?.tasks) ? (pending.originalAction!.action_config as any).tasks as string[] : [];
        const newListName = String((pending.originalAction?.action_config as any)?.list_name ?? '').trim();
        const speech = ok
          ? merged
            ? `Got it — I've added ${newListName ? `your ${newListName} list` : newTasks.join(', ') || 'the reminder'} to your existing alert for ${pending.resolved.place_name}.`
            : reactivated
              ? `Your previous alert for ${pending.resolved.place_name} was re-enabled — ${modeText} you arrive.`
              : `Alert set — ${modeText} you arrive at ${pending.resolved.place_name}.`
          : `Couldn't save the rule — something went wrong. Try again?`;
        // V57.4 Part B — attach the toggle card when the rule was saved.
        // V57.13.4 — also pass address so the card shows the street segment.
        const cards = ok && ruleId
          ? [{ ruleId, placeName: pending.resolved.place_name, address: pending.resolved.address ?? null, oneShot }]
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
          emitPendingTurn(`I couldn't find '${pending.placeName}'. Please check the exact location and call me back.`);
          return;
        }

        const session = await getSessionWithTimeout();
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
              // V57.10.3 — mirror the V57.10.2 permission check that lives in
              // the yes-confirm branch (line ~543). Without this, rules
              // committed via the clarification-memory-hit path could be
              // saved silently without "Allow all the time" granted, leaving
              // the user with a rule that never fires.
              try {
                const bgInitial = await Location.getBackgroundPermissionsAsync();
                if (bgInitial.status !== 'granted') {
                  const fgReq = await Location.requestForegroundPermissionsAsync();
                  if (fgReq.status === 'granted') {
                    await Location.requestBackgroundPermissionsAsync();
                  }
                  const bgFinal = await Location.getBackgroundPermissionsAsync();
                  if (bgFinal.status !== 'granted') {
                    pendingLocationRef.current = null;
                    emitPendingTurn(`Please pick 'Allow all the time' so I can alert you at ${data.place_name}.`);
                    return;
                  }
                }
              } catch (err) {
                console.error('[orch:loc:clarif-memory] permission check threw:', err);
              }
              const { ok, ruleId, reactivated, alreadyExists } = await commitPending(session.user.id, 'confirmed');
              // V57.19 — reverted from V57.18 default flip after the 2026-05-17
// stationary-re-fire bug. Wael received a phantom "you arrived home" alert
// while sitting at home (never moved). Root cause: SDK re-fires ENTER
// opportunistically on a stationary device, and the V57.18 recurring-by-
// default meant each re-fire fanouts. one_shot=true (one-time) default
// auto-disables the rule after first fire — re-fires fanout nothing.
// User says "every time" / "always" / "whenever" → one_shot:false (recurring,
// guarded by the V57.17/V57.18 state machine).
const oneShot = pending.originalAction?.one_shot ?? true;
              pendingLocationRef.current = null;
              if (alreadyExists) {
                // Only enabled dupes reach here — disabled ones are re-enabled
                // in commitPending and return { ok: true, reactivated: true }.
                const existingMode = alreadyExists.oneShot ? 'one-time' : 'recurring';
                const addrSuffix = alreadyExists.address
                  ? ` at ${String(alreadyExists.address).split(',')[0]?.trim()}`
                  : '';
                emitPendingTurn(`You already have a ${existingMode} alert for ${alreadyExists.placeName}${addrSuffix}. Say "list my alerts" if you want to change or remove it.`);
                return;
              }
              // V57.13.3 — sourceText simplified. memory cache removed; only
              // settings_home / settings_work remain as fast-path sources.
              const sourceText = data.source === 'settings_home' ? 'from Settings (home)' :
                                 data.source === 'settings_work' ? 'from Settings (work)' :
                                 '';
              const modeText = oneShot ? 'one time' : 'every time';
              const speech = ok
                ? reactivated
                  ? `Your previous alert for ${data.place_name} was re-enabled — ${modeText} you arrive.`
                  : `${data.place_name}${sourceText ? ' ' + sourceText : ''} — alert set ${modeText} you arrive.`
                : `Couldn't save the rule — something went wrong.`;
              const cards = ok && ruleId
                ? [{ ruleId, placeName: data.place_name, address: data.address ?? null, oneShot }]
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

          // not_found or error — ask for different input. 2026-05-23 (Wael):
          // remove the "(N tries left)" counter — the count felt like a
          // test/punishment to the user. The 3-attempt cap is still enforced
          // silently by the caller of this branch; on the 3rd failed attempt
          // surface the CLAUDE.md LOCATION TRIGGER spec fallback ("please
          // check the exact location and call me back") instead of leaving
          // the message bare with no guidance.
          const remaining = 3 - pending.attempts;
          const escape = remaining > 0
            ? ' Tell me a different street or neighborhood, or say cancel to stop.'
            : ' Please check the exact location and try again later.';
          emitPendingTurn(`I couldn't find "${combinedQuery}" near you.${escape}`);
          return;
        } catch (err) {
          console.error('[Orchestrator] pending location clarification failed:', err);
          pendingLocationRef.current = null;
          emitPendingTurn('Could not reach the location service. Try again later.');
          return;
        }
      }
      } // V57.12.1 — close the escape-or-process else wrapper
    }
    // ── end pending location handler ──────────────────────────────────────────

    // ── B6h: DELETE-INTENT INTERCEPT ─────────────────────────────────────────
    // Claude confabulated "Done — that alert was already deleted" without
    // emitting DELETE_RULE (2026-06-10 live evidence). Fix: detect delete-alert
    // intent here, fetch rules server-side, handle deterministically.
    //   0 matches → tell user, no Claude round-trip.
    //   1 match  → stash in pendingConfirmDeleteRef, ask for confirmation.
    //   2+ matches → stash in pendingDeleteRef (existing disambiguation path).
    const DELETE_ALERT_RE = /\b(delete|remove|cancel|clear)\b.{0,40}\b(alert|reminder|rule|notification)\b/i;
    if (DELETE_ALERT_RE.test(userMessage) && supabase &&
        !pendingConfirmDeleteRef.current && !pendingDeleteRef.current) {
      try {
        const { data: listData } = await invokeWithTimeout('manage-rules', { body: { op: 'list' } }, 15_000);
        const allRules: Array<Record<string, any>> = Array.isArray((listData as any)?.rules) ? (listData as any).rules : [];
        const raw = userMessage.trim().toLowerCase();
        // Strip the verb + "alert/rule/reminder" so only the location/contact
        // hint remains as the search needle.
        const needle = raw
          .replace(/\b(delete|remove|cancel|clear|my|the|an?|all|that)\b/gi, ' ')
          .replace(/\b(alert|reminder|rule|notification|alerts|rules|reminders)s?\b/gi, ' ')
          .replace(/\s+/g, ' ').trim();
        const needles = needle.split(/\s+/).filter(n => n.length > 1);
        const haystackFor = (r: Record<string, any>) => {
          const parts: string[] = [String(r.trigger_type ?? ''), String(r.label ?? '')];
          for (const v of Object.values(r.trigger_config ?? {})) {
            if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
          }
          for (const v of Object.values(r.action_config ?? {})) {
            if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
          }
          return parts.join(' ').toLowerCase();
        };
        const matches = needles.length === 0
          ? allRules
          : allRules.filter(r => { const h = haystackFor(r); return needles.every(n => h.includes(n)); });

        if (matches.length === 0) {
          const speech = needle
            ? `I couldn't find an alert matching "${needle}".`
            : "I don't see any alerts to delete.";
          if (isCancelled()) return;
          setTurns(prev => [...prev, {
            userMessage, assistantSpeech: speech,
            drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
            rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [], locationRules: [],
            globalSearch: undefined,
            timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                     + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
          }]);
          setStatus('idle');
          return;
        }

        const ruleLabel = (r: any): string => {
          const tc = r.trigger_config ?? {};
          if (tc.place_name) return `the ${tc.place_name}${tc.direction ? ` (${tc.direction})` : ''} alert`;
          if (tc.from_name) return `the ${tc.from_name} email alert`;
          if (tc.from_email) return `the alert from ${tc.from_email}`;
          if (r.trigger_type === 'time') return `the ${tc.cron || tc.datetime || 'scheduled'} alert`;
          if (r.label) return `the "${r.label}" alert`;
          return `the ${r.trigger_type} alert`;
        };

        if (matches.length === 1) {
          const rule = matches[0];
          const label = ruleLabel(rule);
          pendingConfirmDeleteRef.current = {
            ruleId: String(rule.id),
            label,
            isLocation: rule.trigger_type === 'location',
          };
          const speech = `I'll delete ${label}. Say yes to confirm, or no to cancel.`;
          if (isCancelled()) return;
          setTurns(prev => [...prev, {
            userMessage, assistantSpeech: speech,
            drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
            rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [], locationRules: [],
            globalSearch: undefined,
            timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                     + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
          }]);
          setStatus('idle');
          return;
        }

        // Multiple matches — reuse existing disambiguation path.
        const distinguishingHint = (r: any): string => {
          const tc = r.trigger_config ?? {};
          if (tc.place_name) return `${tc.place_name}${tc.direction ? ` (${tc.direction})` : ''}`;
          if (tc.from_name) return `from ${tc.from_name}`;
          if (r.label) return r.label;
          return String(r.trigger_type ?? 'alert');
        };
        const hints = matches.slice(0, 3).map(r => `"${distinguishingHint(r)}"`);
        const disambigSpeech = `I found ${matches.length} alerts matching. Which one — ${hints.join(', or ')}? Or say "all" to delete every match.`;
        pendingDeleteRef.current = {
          match: needle,
          matchIds: matches.map(r => String(r.id)),
          hasLocation: matches.some(r => r.trigger_type === 'location'),
        };
        if (isCancelled()) return;
        setTurns(prev => [...prev, {
          userMessage, assistantSpeech: disambigSpeech,
          drafts: [], createdEvents: [], deletedEvents: [], savedDocs: [],
          rememberedItems: [], driveFiles: [], navigationResults: [], listResults: [], locationRules: [],
          globalSearch: undefined,
          timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
                   + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
        }]);
        setStatus('idle');
        return;
      } catch (err) {
        console.error('[Orchestrator] B6h delete-intent intercept failed:', err);
        // Fall through to Claude on intercept error.
      }
    }
    // ── end B6h delete-intent intercept ──────────────────────────────────────

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
    // F1a Wave 2 widen — adds connection-related fields (entityLabel,
    // entityType, cascadedCount, connections) and an error variant so the
    // 4 new LIST_CONNECT / LIST_DISCONNECT / LIST_CONNECTION_QUERY /
    // LIST_DELETE handlers can record outcomes alongside the existing
    // create/add/remove/read entries.
    const turnLists: {
      action:         string;                 // 'created' | 'added' | 'removed' | 'read' | 'connected' | 'disconnected' | 'deleted' | 'query' | 'error'
      listName:       string;
      items?:         string[];
      webViewLink?:   string;
      entityLabel?:   string;
      entityType?:    string;
      cascadedCount?: number;
      connections?:   ConnectionRow[];
      // Wave 2.5 M:N — `lists` is the canonical array shape for
      // what_list_is_on; `list` kept as back-compat alias = lists[0].
      lists?:         Array<{ id: string; name: string; category?: string }>;
      list?:          { id: string; name: string; category?: string } | null;
      mode?:          'where_is_list' | 'what_list_is_on';
      errorKind?:     string;
    }[] = [];
    // V57.4 Part B — location rules created in this turn. Filled by the
    // SET_ACTION_RULE intercept after a successful insert; rendered as an
    // inline card with a "Make it recurring / Make it one-time" toggle.
    const turnLocationRules: { ruleId: string; placeName: string; address?: string | null; oneShot: boolean }[] = [];
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
    const diagSession = newDiagSession();
    remoteLog(diagSession, 'orch-send-start', {
      turn: turnNumber,
      msg_len: userMessage.length,
      msg_snippet: userMessage.slice(0, 80),
    });
    const stepLog = (step: string) => {
      const ms = Date.now() - t0;
      console.log(`[orch:T#${turnNumber}] ${step} ${ms}ms`);
      remoteLog(diagSession, `orch-${step}`, { turn: turnNumber });
    };
    console.log(`[orch:T#${turnNumber}] start userMessage=${JSON.stringify(userMessage).slice(0, 80)}`);

    try {
      let enrichedMessage = userMessage;

      // ── USER-COMPOUND SPLIT ────────────────────────────────────────────────────
      // Detect bullet-point or numbered compound requests in the USER's own message
      // and split BEFORE Claude sees the full list. Each item is sent to Claude
      // individually so Claude never enters a compound pre-confirmation loop.
      // Path B (isCompoundPreConfirm below) remains as fallback for natural-language
      // compound phrases not caught here.
      if (
        !pendingActionRef.current &&
        compoundQueueRef.current.length === 0 &&
        pendingCompoundItemsRef.current.length === 0
      ) {
        const splitItems = splitUserCompound(userMessage);
        if (splitItems && splitItems.length >= 2) {
          const total = splitItems.length;
          const original = userMessage.slice(0, 400);
          pendingCompoundItemsRef.current = splitItems.slice(1).map(
            (item, i) =>
              `[COMPOUND-ITEM ${i + 2} of ${total} — full request for context: ${original}]\n${item}`
          );
          enrichedMessage = `[COMPOUND-ITEM 1 of ${total} — full request for context: ${original}]\n${splitItems[0]}`;
          console.log(`[send] user-compound split: ${total} items detected — sending item 1 to Claude`);
        }
      }

      // ── COMPOUND PRE-CONFIRMATION INTERCEPT ────────────────────────────────────
      // Claude sometimes does a two-step pre-confirmation: lists all N items in
      // text (no tool calls), ends with "say yes to confirm", waits for user.
      // When "Yes" arrives in this state (no pending action, empty queue), Claude
      // re-narrates everything instead of just executing. Fix: detect this pattern
      // and inject a hard execution directive into the enriched message so Claude
      // responds with "On it." + tool calls only.
      if (
        AFFIRMATIVE_RE.test(userMessage.trim()) &&
        !pendingActionRef.current &&
        compoundQueueRef.current.length === 0
      ) {
        const lastNaaviTurn = [...turns].reverse().find(t => t.role === 'assistant');
        const lastText = lastNaaviTurn?.text ?? '';
        const isCompoundPreConfirm =
          /\n\s*[1-9]\./m.test(lastText) &&             // numbered list present
          /say\s+yes|yes\s+to\s+(go\s+ahead|confirm)/i.test(lastText); // pre-confirm phrase
        if (isCompoundPreConfirm) {
          const items = parseCompoundItems(lastText);
          if (items.length > 0) {
            const total = items.length;
            // Strip "I'll " / "I will " prefix so Claude receives a command, not a statement.
            // Add [COMPOUND-ITEM] tag so RULE 24b fires: emit tool call immediately, no re-confirmation.
            const toCommand = (text: string) => text.replace(/^I'?ll\s+/i, '').replace(/^I will\s+/i, '');
            const taggedItems = items.map((item, i) =>
              `[COMPOUND-ITEM ${i + 1} of ${total} — execute immediately, no pre-confirmation needed]\n${toCommand(item)}`
            );
            pendingCompoundItemsRef.current = taggedItems.slice(1); // queue items 2-N
            enrichedMessage = taggedItems[0]; // send item 1 to Claude as standalone request
            console.log(`[send] compound pre-confirm: parsed ${total} items — sending item 1 to Claude`);
          } else {
            // Fallback: list parse failed — use EXECUTE NOW injection
            enrichedMessage = `${userMessage}\n\n[SYSTEM — EXECUTE NOW]: The user confirmed. Emit ALL tool calls immediately. Speech must be "On it." only — no re-narration.`;
            console.log('[send] compound pre-confirm: parse failed, falling back to EXECUTE NOW injection');
          }
        }
      }

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
      // Ticket creation messages contain an @ (the reporter email) but are not
      // retrieval queries — skip pre-search so unrelated inbox results don't
      // appear alongside the confirmation bubble.
      const isTicketCreation = /\b(open|create|log|file|submit|raise)\s+(a\s+)?(support\s+)?(ticket|issue|report)\b/i.test(userMessage);
      // Email alert creation contains an @ (sender address) but is NOT a retrieval query —
      // skip pre-search so unrelated inbox results don't appear alongside the confirm bubble.
      const isEmailAlertCreation = /\b(alert|notify|tell|let\s+me\s+know|ping)\s+me\s+(when|if|whenever)\b/i.test(userMessage);
      const isRetrievalQuery = !isTicketCreation && !isEmailAlertCreation && (hasLongDigitRun || hasAtSign || retrievalRe.test(userMessage));

      // Strip question/retrieval verbs and trailing filler so the search
      // query matches real content. The raw user message "Find Gordon Doig's
      // phone number" was being sent as-is to substring search, and no
      // contact has a name literally containing that entire phrase. Extract
      // just the noun phrase at the core.
      // 2026-05-22 (Wael) \u2014 also strip a leading TYPE-NOUN after the verb
      // strip. "Find contact Bob" was passing "contact Bob" to global-search;
      // the contacts adapter then did a substring match for "contact bob"
      // against displayName "Bob" and returned 0 hits. Now strips: contact,
      // email, message, note, reminder, alert, memory, document, file (sing
      // + plural), with an optional connector word (for/of/about/named/called).
      // The (?=\S) lookahead ensures another word follows so "find email"
      // alone (with no specific target) doesn't get emptied.
      const searchQuery = userMessage
        .replace(/^\s*(can you\s+)?(please\s+)?(find|look\s*up|search\s+(for)?|show\s*me|tell\s*me\s*(about)?|what\s+do\s+(we|you|i)\s+have\s+(on|about)?|what\s+do\s+you\s+know\s+about|do\s+(we|you|i)\s+have|is\s+there|information\s+on|anything\s+(about|on))\s+/i, '')
        .replace(/^(?:my\s+)?(contact|contacts|email|emails|message|messages|note|notes|reminder|reminders|alert|alerts|memory|memories|document|documents|file|files)\s+(?:for\s+|of\s+|about\s+|named\s+|called\s+|with\s+)?(?=\S)/i, '')
        // 2026-05-22 (Wael) \u2014 punctuation strip MUST run before trailing
        // strips. Deepgram puts a period at the end of "Find Bob in my
        // contact." which blocked the trailing "in my <type>" pattern from
        // matching (it required \s*$). Live evidence on voice server (same
        // bug existed there, commit c3d154b). Mobile inherits same regex.
        .replace(/[?.!,;]+\s*$/, '')
        // 2026-05-22 (Wael) \u2014 also strip a TRAILING "in/from my <type>" or
        // "in <type>s" suffix. "find bob in my contact" was leaving
        // "bob in my" as query because the existing trailing-noun strip
        // only handled "<X> contact" not "<X> in my contact".
        .replace(/\s+(?:in|from)\s+(?:my\s+)?(contact|contacts|email|emails|message|messages|note|notes|reminder|reminders|alert|alerts|memory|memories|document|documents|file|files)s?\s*$/i, '')
        .replace(/['\u2019]s\s+(phone|email|number|address|contact|info|information|details?)\s*$/i, '')
        .replace(/\s+(phone|email|number|address|contact|info|information|details?)\s*$/i, '')
        .trim() || userMessage.trim();

      // Wael 2026-05-22 — detect source intent from the RAW user message
      // before the strip above removes the source noun ("contact", "email",
      // etc.). Pass it as source_hint so global-search restricts adapters
      // server-side (truth-at-user-layer for the visual results panel).
      //
      // Mirrors detectSourceIntent + sourceHintToAdapterNames in
      // supabase/functions/global-search/index.ts. Returns null for
      // open-ended phrasings so they keep fanning out to every adapter.
      const preSearchSourceHint: string | undefined = (() => {
        const lower = userMessage.toLowerCase();
        const OPEN_ENDED =
          /(?:what do (?:we|you) know|tell me about|anything (?:about|on)|what do you have on|do you know|stored about|find anything|search for|what(?:'s|\s+is)\s+stored)/i;
        if (OPEN_ENDED.test(lower)) return undefined;
        if (/\bcontacts?\b/.test(lower)) return 'contacts';
        if (/\b(?:emails?|inbox|gmail|mailbox|mail)\b/.test(lower)) return 'gmail';
        if (/\b(?:calendars?|meetings?|appointments?|events?)\b/.test(lower)) return 'calendar';
        if (/\b(?:notes?|memor(?:y|ies))\b/.test(lower)) return 'notes';
        if (/\b(?:drives?|documents?|files?|pdfs?|attachments?)\b/.test(lower)) return 'drive';
        // 'lists' deliberately omitted — list operations route through
        // the dedicated list_read/list_create/list_add/list_remove tools,
        // not through global_search source_hint (Wael 2026-05-22).
        if (/\b(?:reminders?|alerts?|rules?)\b/.test(lower)) return 'reminders';
        return undefined;
      })();

      let preSearchResults: GlobalSearchResult[] = [];
      if (isRetrievalQuery && supabase) {
        remoteLog(diagSession, 'pre-search-branch-start');
        try {
          remoteLog(diagSession, 'pre-search-getSession-start');
          const session = await getSessionWithTimeout();
          remoteLog(diagSession, 'pre-search-getSession-end', { hasSession: !!session, hasUser: !!session?.user });
          if (session?.user) {
            // 8-second hard cap on pre-search. V57.2 — if global-search hangs
            // we proceed without pre-search results rather than freezing the
            // whole send pipeline.
            remoteLog(diagSession, 'pre-search-invoke-start');
            const preSearchBody: Record<string, unknown> = {
              query: searchQuery,
              user_id: session.user.id,
              limit: 8,
            };
            if (preSearchSourceHint) preSearchBody.source_hint = preSearchSourceHint;
            const searchPromise = supabase.functions.invoke('global-search', {
              body: preSearchBody,
            });
            const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) => {
              setTimeout(() => {
                console.warn('[Orchestrator] pre-search timed out after 8s — proceeding without results');
                resolve({ data: null, error: 'timeout' });
              }, 8_000);
            });
            const { data, error } = await Promise.race([searchPromise, timeoutPromise]);
            remoteLog(diagSession, 'pre-search-invoke-end', { had_error: !!error, count: Array.isArray(data?.ranked) ? data.ranked.length : 0 });
            if (!error && Array.isArray(data?.ranked)) {
              preSearchResults = (data.ranked as GlobalSearchResult[]).slice(0, 8);
              console.log('[Orchestrator] pre-search query=', JSON.stringify(searchQuery), 'returned', preSearchResults.length, 'results');
            }
          }
        } catch (err) {
          remoteLog(diagSession, 'pre-search-catch', { error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
          console.error('[Orchestrator] pre-search failed:', err);
        }

        if (preSearchResults.length > 0) {
          // Map internal adapter names to readable labels so Claude doesn't echo
          // "In email_actions: …" in its spoken response (B5a fix, 2026-05-25).
          const SOURCE_LABELS: Record<string, string> = {
            email_actions: 'Email',
            gmail:         'Email',
            calendar:      'Calendar',
            knowledge:     'Notes',
            drive:         'Drive',
            contacts:      'Contacts',
            lists:         'Lists',
            rules:         'Alerts',
            reminders:     'Reminders',
            sent_messages: 'Sent Messages',
          };
          const lines = preSearchResults.map(r => {
            const label = SOURCE_LABELS[r.source] ?? r.source;
            let line = `- [${label}] ${r.title}${r.snippet ? ' — ' + r.snippet : ''}`;
            if (r.source === 'contacts') {
              const meta = r.metadata as Record<string, unknown> | undefined;
              if (meta?.resource_name) {
                line += ` [resource_name:${meta.resource_name}]`;
              }
              if (meta?.is_community === true) {
                line += ' [MyNaavi Community member]';
              } else if (meta?.is_community === false) {
                line += ' [not in MyNaavi Community]';
              }
            }
            return line;
          });
          enrichedMessage = `${enrichedMessage}\n\n## Live search results for the user's question (these are authoritative — use them to answer; do NOT say "I couldn't find" if results are listed here)\n${lines.join('\n')}`;
          turnGlobalSearch = { query: userMessage, results: preSearchResults, origin: 'pre-search' };
        } else {
          // B1d fix (Wael 2026-05-10): downgraded from a hard "Nothing matched.
          // Say that plainly — do not guess." gag to a softer "defer to system
          // prompt" instruction. The hard gag overrode the server-side live-
          // overlay (Recent emails section) and made Claude say "I don't have
          // an email" even when the system prompt clearly listed it. The
          // server-side live-overlay is authoritative for email queries; the
          // pre-search empty result just means the cron-indexed cache had
          // nothing — not that the data doesn't exist anywhere.
          enrichedMessage = `${enrichedMessage}\n\n## Live search results for the user's question\nNo cached search hits in calendar, contacts, memory, lists, email, rules, or sent messages. Defer to live data in the system prompt (Recent emails, Schedule, etc.) before saying you don't have something.`;
        }
      }

      stepLog('pre-naavi-chat done');
      const [response, knowledgeResult] = await Promise.all([
        sendToNaavi(enrichedMessage, historyRef.current, briefRef.current, language, diagSession),
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

      // B1b backstop (Wael 2026-05-10): if the user clearly asked to list /
      // show / count their alerts but Claude didn't emit a LIST_RULES action,
      // synthesize one so the orchestrator's LIST_RULES handler runs and
      // produces the canonical "You have N alerts: ..." reply. Without this
      // backstop, Claude occasionally says "you don't have any alerts" or
      // "I don't have any alerts in your records" even when alerts exist —
      // since the system prompt context doesn't include the alert list,
      // Claude can't see them. The handler queries action_rules directly,
      // so the synthesized action gets the truthful answer.
      const LIST_RULES_INTENT_RE =
        /\b(?:list|show|what(?:'s|\s+are|\s+do\s+i\s+have)|how many|tell me about|do i have)\s+(?:me\s+|my\s+|the\s+)?(?:active\s+|current\s+|all\s+)?(?:email\s+|location\s+|contact\s+|time\s+|weather\s+|calendar\s+)?(?:alerts?|rules?|reminders?|notifications?)\b/i;

      // Extract type keywords from the user message for LIST_RULES filtering.
      // Applied to both the backstop (Claude didn't emit LIST_RULES) AND to
      // Claude's own LIST_RULES action (Claude emitted it but without a match).
      const listTypeWords = (userMessage.toLowerCase().match(/\b(email|contact|location|time|weather|calendar)\b/g) ?? []);
      const listTypeMatch = [...new Set(listTypeWords)].join(' ');

      if (
        LIST_RULES_INTENT_RE.test(userMessage) &&
        !dedupedActions.some(a => a.type === 'LIST_RULES')
      ) {
        console.log(`[Orchestrator] B1b backstop — synthesizing LIST_RULES | match="${listTypeMatch}"`);
        dedupedActions.push({ type: 'LIST_RULES', match: listTypeMatch || undefined } as NaaviAction);
      } else if (listTypeMatch) {
        // Claude emitted LIST_RULES but without a match — inject the type filter
        // from the user message so "list my email alerts" doesn't return everything.
        const existing = dedupedActions.find(a => a.type === 'LIST_RULES') as any;
        if (existing && !existing.match) {
          existing.match = listTypeMatch;
          console.log(`[Orchestrator] B1b inject — LIST_RULES match injected from user message: "${listTypeMatch}"`);
        }
      }

      // Compound queue: when N > 1 actions arrive, queue actions 2-N and process
      // only action[0] in this turn. advanceCompoundQueue() drives the rest after
      // each user "yes" or "skip".
      if (dedupedActions.length > 1) {
        compoundQueueRef.current = dedupedActions.slice(1);
        compoundTotalRef.current = dedupedActions.length;
        dedupedActions.splice(1);
        console.log(`[Orchestrator] compound queue: ${compoundTotalRef.current} actions — queued ${compoundQueueRef.current.length} after processing action[0]`);
      }

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
            // V57.12.2 Bug O fix — when the Drive save throws (now possible
            // after the adapter no longer swallows failures), override the
            // turn's speech so the user is told the truth instead of a
            // false-positive "Saved." Previously a silent failure left the
            // user thinking the note landed in Drive when nothing was
            // written. Wael 2026-05-06.
            const msg = err instanceof Error ? err.message : 'unknown error';
            console.error('[Orchestrator] SAVE_TO_DRIVE failed:', msg);
            turnSpeechOverride = `I couldn't save that to Drive — ${msg}.`;
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
          // V57.8 — track CREATE_EVENT outcome so we can override Naavi's
          // speech if the create call failed (silent calendar add bug
          // surfaced 2026-04-29 by Wael testing). Without this Naavi
          // says "I've added it" even when the event never landed in
          // Google Calendar — lying to the user.
          const summary = String(action.summary ?? 'event');
          console.log(`[orch:event] CREATE_EVENT attempt | summary="${summary}" | start=${action.start}`);
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
            console.log(`[orch:event] CREATE_EVENT succeeded | id=${event.htmlLink ?? 'no-link'}`);
          } catch (err) {
            console.error('[Orchestrator] CREATE_EVENT failed:', err);
            // V57.8 — override Naavi's speech to be truthful about the
            // failure. Otherwise the speech still says "I've added it"
            // and the user thinks the event was created.
            turnSpeechOverride = `I tried to add ${summary} to your calendar but it didn't work. Please try again, or check that your Google Calendar is connected in Settings.`;
          }
        }

        if (action.type === 'FETCH_TRAVEL_TIME') {
          const destination   = String(action.destination   ?? '').trim();
          const eventStartISO = String(action.eventStartISO ?? '').trim();
          const departureISO  = String(action.departureISO  ?? '').trim();
          if (destination) {
            // V57.11.6 — verified-address gate (Wael 2026-05-05 directive).
            // Naavi must INDEPENDENTLY verify the destination via Google
            // Places SPECIFIC_TYPES check before rendering a confident
            // card. User confirmation alone (or calendar-event-typed
            // address) is not enough. If the address can't be verified,
            // skip the card and let the phantom-action backstop emit an
            // honest fallback speech.
            try {
              const session = await getSessionWithTimeout();
              const userId = session?.user?.id;
              if (userId) {
                const verifyRes = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
                  body: JSON.stringify({ user_id: userId, place_name: destination, save_to_cache: false }),
                }, 15000);
                const verifyData = await verifyRes.json();
                if (verifyData?.status === 'not_found') {
                  console.log(`[Orchestrator] FETCH_TRAVEL_TIME blocked — unverified destination "${destination}"`);
                  // Wael 2026-05-10 (B3d): name the destination in the
                  // rejection so the user knows WHICH address Naavi
                  // couldn't confirm. Generic "that address" was
                  // confusing — they can have multiple events.
                  turnSpeechOverride = `I can't confirm '${destination}' for your meeting today. Please check the exact location and call me back.`;
                  continue;
                }
              }
            } catch (verifyErr) {
              console.error('[Orchestrator] FETCH_TRAVEL_TIME verification threw:', verifyErr);
              // Verification service down — fall through to fetchTravelTime
              // anyway rather than blocking the user entirely.
            }
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
          // Skip search when a draft is already in this turn — Claude sometimes
          // emits both together using the full user message as the query, which
          // produces irrelevant contact results alongside the draft card.
          if (turnDrafts.length > 0) continue;
          // Cross-source search: calls global-search Edge Function, which
          // fans out to knowledge, rules, sent_messages, contacts, lists,
          // calendar, and gmail adapters and returns a ranked list.
          //
          // Wael 2026-05-22 — when Claude populated source_hint (because
          // the user named a source), forward it so global-search runs
          // only that adapter. Without this, the visual results panel
          // shows unrelated sources even when Naavi's spoken reply is
          // correctly scoped (truth-at-user-layer violation in the UI).
          const query = String(action.query ?? '').trim();
          const sourceHint = typeof action.source_hint === 'string'
            ? action.source_hint.trim()
            : undefined;
          if (query && supabase) {
            try {
              const session = await getSessionWithTimeout();
              if (session?.user) {
                const body: Record<string, unknown> = { query, user_id: session.user.id, limit: 8 };
                if (sourceHint) body.source_hint = sourceHint;
                const { data, error } = await invokeWithTimeout('global-search', {
                  body,
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

        if (action.type === 'SPEND_SUMMARY') {
          // Aggregate vendor's invoice amounts over a time period and
          // override Naavi's speech with one number (per RULE 19a). Naavi
          // emitted forward-looking speech ("Let me add up..."); we now
          // run the SUM and replace it with the actual total.
          const vendor = String(action.vendor ?? '').trim();
          const periodLabel = String(action.period_label ?? 'last month').trim().toLowerCase();
          const spendMode: 'charged' | 'paid' = action.mode === 'paid' ? 'paid' : 'charged';
          // V57.10.3 — diagnostic + safety net. Wael 2026-05-01 saw
          // chat stall on "Let me add up..." with no follow-up. We now
          // log both the entry and exit of this handler so the next
          // recurrence can be diagnosed from client_diagnostics, and
          // we install a default fallback override so even if every
          // path below falls through silently, the user gets a clear
          // message instead of the LLM's forward-looking placeholder.
          remoteLog(diagSession, 'orch-spend-summary-start', { vendor, periodLabel, spendMode });
          if (!turnSpeechOverride) {
            turnSpeechOverride = `I couldn't pull up your ${vendor || 'spend'} total right now. Try again in a moment.`;
          }
          if (vendor && supabase) {
            try {
              const session = await getSessionWithTimeout();
              const userIdForBody = session?.user?.id;
              const { data, error } = await invokeWithTimeout('naavi-spend-summary', {
                body: {
                  vendor,
                  period_label: periodLabel,
                  mode: spendMode,
                  ...(userIdForBody ? { user_id: userIdForBody } : {}),
                },
              }, 10_000);
              if (error || !data) {
                console.error('[Orchestrator] SPEND_SUMMARY failed:', error);
                turnSpeechOverride = `I couldn't pull up your ${vendor} total right now. Try again in a moment.`;
              } else {
                const count = Number(data.invoice_count ?? 0);
                const periodPhrase = formatPeriodPhrase(String(data.period_label ?? periodLabel));
                const verb = spendMode === 'paid' ? 'paid' : 'charged you';
                if (count === 0) {
                  const zeroPhrase = spendMode === 'paid'
                    ? `I don't see any ${vendor} receipts ${periodPhrase}.`
                    : `I don't see any ${vendor} charges ${periodPhrase}. Forward the email to yourself if I'm missing one and I'll pick it up.`;
                  turnSpeechOverride = zeroPhrase;
                } else {
                  const byCurrency = Array.isArray(data.by_currency) ? data.by_currency : [];
                  if (byCurrency.length <= 1) {
                    const amount = formatMoney(Number(data.total_cents ?? 0), data.currency ?? null);
                    turnSpeechOverride = count === 1
                      ? `${vendor} ${verb} ${amount} ${periodPhrase}.`
                      : `${vendor} ${verb} ${amount} across ${count} ${spendMode === 'paid' ? 'payments' : 'charges'} ${periodPhrase}.`;
                  } else {
                    const parts = byCurrency.map((b: any) => `${formatMoney(Number(b.total_cents ?? 0), String(b.currency ?? ''))}`);
                    turnSpeechOverride = `${vendor} ${verb} ${parts.join(' plus ')} ${periodPhrase}.`;
                  }
                }
              }
            } catch (err) {
              console.error('[Orchestrator] SPEND_SUMMARY error:', err);
              turnSpeechOverride = `I couldn't pull up your ${vendor} total right now. Try again in a moment.`;
            }
          }
          remoteLog(diagSession, 'orch-spend-summary-end', {
            vendor,
            periodLabel,
            override_set: !!turnSpeechOverride,
            override_preview: (turnSpeechOverride ?? '').slice(0, 120),
          });
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
              if (result.reactivated) {
                // Disabled list found — re-enabled in-place. Override Claude's
                // speech so the user knows what happened (same pattern as the
                // alert re-enable readback in commitPending).
                turnSpeechOverride = `Your previous ${name} list was re-enabled.`;
                turnLists.push({ action: 'reactivated', listName: name, webViewLink: result.list.web_view_link ?? undefined });
              } else {
                turnLists.push({ action: 'created', listName: name, webViewLink: result.list.web_view_link ?? undefined });
              }
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
          // V57.11.7 — read the alerts back as a numbered list. Wael
          // 2026-05-06: previous handler navigated to /alerts which often
          // failed (router.push threw → "Tap the three-dot menu" fallback,
          // unhelpful). Per Wael's UX rule (every list-style answer must
          // be a list, not a sentence), query action_rules directly and
          // read each alert.
          const match = String((action as any).match ?? '').trim().toLowerCase();
          try {
            const session = await getSessionWithTimeout();
            if (!session?.user || !supabase) {
              turnSpeechOverride = "I'm not signed in. Please sign in and try again.";
              continue;
            }
            const { data: rules, error: rulesErr } = await queryWithTimeout(
              supabase.from('action_rules')
                .select('id, trigger_type, trigger_config, action_type, action_config, label')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: false }),
              15_000,
              'list-rules-query',
            );
            if (rulesErr) {
              console.error('[Orchestrator] LIST_RULES query failed:', rulesErr);
              turnSpeechOverride = "I couldn't pull up your alerts. Try again in a moment.";
              continue;
            }
            const allRules = (rules ?? []) as any[];
            // Filter by match phrase if provided.
            const filtered = match
              ? allRules.filter(r => {
                  const hay = JSON.stringify({
                    trigger_type: r.trigger_type,
                    label: r.label,
                    trigger_config: r.trigger_config,
                    action_config: r.action_config,
                  }).toLowerCase();
                  // Support multi-word match: each word is a separate needle.
                  // "contact email" → needle "contact" OR "email" must appear.
                  const needles = match.split(/\s+/).filter(Boolean);
                  return needles.some(n => hay.includes(n));
                })
              : allRules;
            if (filtered.length === 0) {
              turnSpeechOverride = match
                ? `I don't have any alerts matching "${match}".`
                : "You don't have any alerts set up yet.";
              continue;
            }
            // Format each rule into a one-line description.
            const describe = (r: any): string => {
              const tc = r.trigger_config ?? {};
              const ac = r.action_config ?? {};
              if (r.trigger_type === 'location') {
                const place = tc.place_name ?? r.label ?? 'somewhere';
                const direction = tc.direction === 'leave' ? 'leave' : 'arrive at';
                const ch = ac.channel === 'email' ? 'email' :
                           ac.channel === 'whatsapp' ? 'WhatsApp' : 'text';
                return `${ch} when you ${direction} ${place}`;
              }
              if (r.trigger_type === 'email') {
                const from = tc.from_name || tc.from_email || tc.subject_keyword || 'matching email';
                return `notify when an email arrives from ${from}`;
              }
              if (r.trigger_type === 'time') {
                return `at ${tc.cron ?? tc.time ?? 'scheduled time'}: ${r.label ?? 'reminder'}`;
              }
              if (r.trigger_type === 'calendar') {
                return `before calendar event: ${r.label ?? 'event'}`;
              }
              return r.label ?? `${r.trigger_type} alert`;
            };
            const lines = filtered.map((r, i) => `${i + 1}. ${describe(r)}`);
            const intro = match
              ? `I found ${filtered.length} ${filtered.length === 1 ? 'alert' : 'alerts'} matching "${match}":`
              : `You have ${filtered.length} ${filtered.length === 1 ? 'alert' : 'alerts'} set up:`;
            turnSpeechOverride = `${intro}\n${lines.join('\n')}`;
          } catch (err) {
            console.error('[Orchestrator] LIST_RULES read failed:', err);
            turnSpeechOverride = "I couldn't pull up your alerts. Try again in a moment.";
          }
          continue;
        }

        // ─── F1a Wave 2 — list-connection actions ─────────────────────────
        // Mobile mirror of the voice-server's executeAction cases for
        // LIST_CONNECT / LIST_DISCONNECT / LIST_CONNECTION_QUERY /
        // LIST_DELETE. All four follow the same shape: resolve names →
        // call manage-list-connections → push outcome onto turnLists.
        //
        // No extra confirmation gate here: typing the message + send IS
        // the user confirmation (per F1a Wave 2 design — Wael 2026-05-13).
        // Claude's prompt (RULE 8b) is responsible for showing the
        // cascade-warning text BEFORE emitting LIST_DELETE. Matches the
        // existing pattern for SET_ACTION_RULE / SCHEDULE_MEDICATION /
        // DELETE_RULE / DELETE_MEMORY etc., which all fire on send.

        if (action.type === 'LIST_CONNECT') {
          const listName   = String((action as any).listName   ?? '').trim();
          const entityRef  = String((action as any).entityRef  ?? '').trim();
          const entityType = String((action as any).entityType ?? '').trim();
          try {
            const result = await connectList(listName, entityRef, entityType);
            if (result.success) {
              turnLists.push({
                action: 'connected',
                listName: result.listLabel ?? listName,
                entityLabel: result.entityLabel,
                entityType,
              });
              console.log(`[Orchestrator] LIST_CONNECT "${result.listLabel}" → ${entityType}/${result.entityLabel}: OK`);
            } else {
              turnLists.push({ action: 'error', listName, entityType, errorKind: result.error });
              console.error(`[Orchestrator] LIST_CONNECT failed: ${result.error}`);
            }
          } catch (err: any) {
            turnLists.push({ action: 'error', listName, entityType, errorKind: err?.message || 'exception' });
            console.error('[Orchestrator] LIST_CONNECT exception:', err);
          }
          continue;
        }

        if (action.type === 'LIST_DISCONNECT') {
          // Wave 2.5 M:N — listName is now part of the action (required
          // per prompt v73) so we can target the specific list to detach.
          const listName   = String((action as any).listName   ?? '').trim();
          const entityRef  = String((action as any).entityRef  ?? '').trim();
          const entityType = String((action as any).entityType ?? '').trim();
          try {
            const result = await disconnectEntity(listName, entityRef, entityType);
            if (result.success) {
              turnLists.push({
                action: 'disconnected',
                listName: result.listLabel ?? listName,
                entityLabel: result.entityLabel,
                entityType,
                cascadedCount: result.removed,
              });
              console.log(`[Orchestrator] LIST_DISCONNECT list="${result.listLabel || listName}" ${entityType}/${result.entityLabel}: removed=${result.removed}`);
            } else {
              turnLists.push({ action: 'error', listName, entityType, errorKind: result.error });
              console.error(`[Orchestrator] LIST_DISCONNECT failed: ${result.error}`);
            }
          } catch (err: any) {
            turnLists.push({ action: 'error', listName, entityType, errorKind: err?.message || 'exception' });
            console.error('[Orchestrator] LIST_DISCONNECT exception:', err);
          }
          continue;
        }

        if (action.type === 'LIST_CONNECTION_QUERY') {
          const mode       = String((action as any).mode       ?? '').trim() as 'where_is_list' | 'what_list_is_on';
          const listName   = String((action as any).listName   ?? '').trim() || undefined;
          const entityRef  = String((action as any).entityRef  ?? '').trim() || undefined;
          const entityType = String((action as any).entityType ?? '').trim() || undefined;
          try {
            const result = await queryListConnections({ mode, listName, entityRef, entityType });
            // V57.15.1 — formatConnectionQueryResult mirrors the voice
            // surface's _f1aFormatConnectionQuery and produces the
            // numbered-list answer text. Override Claude's speech so
            // the chat bubble shows the actual answer instead of just
            // "I'll check…" followed by silence.
            turnSpeechOverride = formatConnectionQueryResult(result, { listName, entityRef });

            if (result.success) {
              if (result.mode === 'where_is_list') {
                turnLists.push({
                  action: 'query',
                  listName: result.list_label,
                  mode: 'where_is_list',
                  connections: result.connections,
                });
                console.log(`[Orchestrator] LIST_CONNECTION_QUERY where_is_list "${result.list_label}": ${result.connections.length} connections`);
              } else {
                turnLists.push({
                  action: 'query',
                  listName: '',
                  mode: 'what_list_is_on',
                  entityLabel: result.entity_label,
                  lists: result.lists,
                  list:  result.list,
                });
                const summary = result.lists.length === 0
                  ? 'no lists'
                  : result.lists.length === 1
                    ? result.lists[0].name
                    : `${result.lists.length} lists`;
                console.log(`[Orchestrator] LIST_CONNECTION_QUERY what_list_is_on ${result.entity_label}: ${summary}`);
              }
            } else {
              turnLists.push({ action: 'error', listName: '', mode, errorKind: result.error });
              console.error(`[Orchestrator] LIST_CONNECTION_QUERY failed: ${result.error}`);
            }
          } catch (err: any) {
            turnLists.push({ action: 'error', listName: '', mode, errorKind: err?.message || 'exception' });
            console.error('[Orchestrator] LIST_CONNECTION_QUERY exception:', err);
          }
          continue;
        }

        if (action.type === 'LIST_DELETE') {
          const listName = String((action as any).listName ?? '').trim();
          try {
            const result = await deleteListWithConnections(listName);
            if (result.success) {
              turnLists.push({
                action: 'deleted',
                listName: result.listLabel ?? listName,
                cascadedCount: result.cascadedCount ?? 0,
              });
              console.log(`[Orchestrator] LIST_DELETE "${result.listLabel}": cascaded ${result.cascadedCount} connections`);
            } else {
              turnLists.push({ action: 'error', listName, errorKind: result.error });
              console.error(`[Orchestrator] LIST_DELETE failed: ${result.error}`);
            }
          } catch (err: any) {
            turnLists.push({ action: 'error', listName, errorKind: err?.message || 'exception' });
            console.error('[Orchestrator] LIST_DELETE exception:', err);
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
              // V57.12.2 Bug G fix — disambiguation prompt was rendering the
              // bare trigger_type as the option label. Two time-triggered
              // rules collapsed to "time, or time?" — useless. Build a
              // distinguishing hint per rule using whatever the rule
              // actually carries (label, place_name, from_name, time, etc.).
              const distinguishingHint = (r: any): string => {
                const tc = r.trigger_config ?? {};
                const labelText = String(r.label ?? '').trim();
                if (tc.place_name) return `${tc.place_name}${tc.direction ? ` (${tc.direction})` : ''}`;
                if (tc.from_name) return `from ${tc.from_name}`;
                if (tc.from_email) return `from ${tc.from_email}`;
                if (r.trigger_type === 'time') {
                  const when = tc.cron || tc.time || tc.datetime || 'scheduled';
                  return labelText ? `${when} — ${labelText}` : String(when);
                }
                if (r.trigger_type === 'weather' && tc.condition) {
                  return `${tc.condition} alert`;
                }
                if (labelText) return labelText;
                return String(r.trigger_type ?? 'alert');
              };
              const hints = matches.slice(0, 3).map(r => `"${distinguishingHint(r)}"`);
              turnSpeechOverride = `I found ${matches.length} alerts matching. Which one — ${hints.join(', or ')}? Or say "all" to delete every match.`;
              // Stash the matched IDs so a "all" / "every" reply on the next
              // turn can delete them without going back to Claude.
              pendingDeleteRef.current = {
                match,
                matchIds: matches.map(r => String(r.id)),
                // B2l — flag if any candidate is a location rule, so the
                // bulk "all" reply branch can re-sync the SDK.
                hasLocation: matches.some(r => r.trigger_type === 'location'),
              };
            } else {
              // Delete one or many in parallel
              const results = await Promise.allSettled(
                matches.map(t => invokeWithTimeout('manage-rules', { body: { op: 'delete', rule_id: t.id } }, 15_000)),
              );
              const okCount   = results.filter(r => r.status === 'fulfilled' && !(r as any).value?.error).length;
              const failCount = matches.length - okCount;
              // B2l — re-sync if any deleted rule was a location rule.
              if (okCount > 0 && matches.some(r => r.trigger_type === 'location') && supabase) {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user?.id) syncGeofencesAfterDelete(session.user.id);
              }
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
          if (reminderDatetime) {
            // Schedule a Web Push notification at the reminder time
            const delayMs = new Date(reminderDatetime).getTime() - Date.now();
            if (delayMs > 0 && delayMs < 24 * 60 * 60 * 1000) {
              // Only schedule if within 24 hours
              setTimeout(() => {
                sendPushNotification(reminderTitle, 'Time for your reminder', '/').catch(() => {});
              }, delayMs);
            }

            // V57.12.4 Bug H instrumentation v2 — finer heartbeats. V57.12.3
            // narrowed the crash to "after voice + card render". V57.12.3
            // also fixed the audio-mode constants (ttsfallback-expo no
            // longer fires) and the geofence sync now succeeds with 9
            // registered fences. The crash signature changed: V57.12.2 had
            // heartbeats 1-4 logged then silence; V57.12.3 had only
            // heartbeat-1 logged but syncGeofences-end fired at +23s
            // (proving JS thread alive past +20s), then silence until
            // cold-start at +54s. Heartbeat-2 (+20s) DID NOT log even
            // though the thread was alive — suggests remoteLog calls were
            // swallowed for that tick. v2 drops the interval to 2s so
            // partial failures of any single tick still leave neighbors
            // intact, narrowing the crash window from 10s to 2s.
            const reminderDiag = newDiagSession();
            remoteLog(reminderDiag, 'set-reminder-rendered', {
              title: reminderTitle.slice(0, 60),
              datetimeISO: reminderDatetime,
              localPushDelayMs: delayMs > 0 ? delayMs : null,
            });
            const hbStart = Date.now();
            // 60 ticks × 2s = 120s total coverage, matching v1.
            for (let tick = 1; tick <= 60; tick++) {
              setTimeout(() => {
                const heap = (globalThis as any).performance?.memory?.usedJSHeapSize;
                remoteLog(reminderDiag, `heartbeat-${tick}`, {
                  elapsedMs: Date.now() - hbStart,
                  heap: typeof heap === 'number' ? heap : null,
                });
                if (tick === 60) endDiagSession(reminderDiag);
              }, tick * 2_000);
            }
          }
        } else if (action.type === 'LOG_CONCERN') {
          await saveTopic({ subject: String(action.category ?? 'general'), note: String(action.note ?? ''), category: String(action.severity ?? 'low') });
        } else if (action.type === 'UPDATE_PROFILE') {
          await saveTopic({ subject: String(action.key ?? 'preference'), note: String(action.value ?? ''), category: 'preference' });
        } else if (action.type === 'UPDATE_MORNING_CALL') {
          if (supabase) {
            const session = await getSessionWithTimeout();
            if (session?.user) {
              const timeToWindow = (hhmm: string | undefined): 'morning' | 'midday' | 'evening' | 'night' | null => {
                if (!hhmm) return null;
                let t = String(hhmm).trim().substring(0, 5);
                // Zero-pad single-digit hours: "9:00" → "09:00"
                if (/^\d:\d\d$/.test(t)) t = '0' + t;
                if (t < '11:00') return 'morning';
                if (t < '15:00') return 'midday';
                if (t < '20:00') return 'evening';
                return 'night';
              };

              // Read current brief_windows before patching.
              const { data: currentRow } = await queryWithTimeout(
                supabase.from('user_settings').select('brief_windows').eq('user_id', session.user.id).single(),
                15_000,
                'select-brief-windows',
              );
              const currentWindows: Record<string, any> | null = (currentRow as any)?.brief_windows ?? null;

              const settingsUpdate: Record<string, any> = { updated_at: new Date().toISOString() };

              // Legacy columns for users without brief_windows.
              if (action.time) settingsUpdate.morning_call_time = String(action.time);
              if (action.enabled !== undefined) settingsUpdate.morning_call_enabled = action.enabled;

              // brief_windows patch.
              if (currentWindows) {
                const newWindows = { ...currentWindows };
                if (action.time) {
                  const win = timeToWindow(String(action.time));
                  if (win) {
                    newWindows[win] = {
                      ...(newWindows[win] ?? { channels: [] }),
                      time: String(action.time).substring(0, 5),
                      enabled: action.enabled !== false,
                    };
                  }
                } else if (action.enabled === false) {
                  for (const w of ['morning', 'midday', 'evening', 'night']) {
                    if (newWindows[w]) newWindows[w] = { ...newWindows[w], enabled: false };
                  }
                }
                settingsUpdate.brief_windows = newWindows;
              } else if (action.time) {
                const win = timeToWindow(String(action.time));
                const defaultWindows: Record<string, any> = {
                  morning: { enabled: false, time: '08:00', channels: [] },
                  midday:  { enabled: false, time: '12:00', channels: [] },
                  evening: { enabled: false, time: '17:00', channels: [] },
                  night:   { enabled: false, time: '21:00', channels: [] },
                };
                if (win) {
                  defaultWindows[win] = {
                    enabled: action.enabled !== false,
                    time: String(action.time).substring(0, 5),
                    channels: ['sms'],
                  };
                }
                settingsUpdate.brief_windows = defaultWindows;
              }

              const { error: mcErr } = await queryWithTimeout(
                supabase.from('user_settings').update(settingsUpdate).eq('user_id', session.user.id),
                15_000,
                'update-morning-call',
              );
              if (mcErr) console.error('[Orchestrator] UPDATE_MORNING_CALL failed:', mcErr.message);
            }
          }
        } else if (action.type === 'SET_EMAIL_ALERT') {
          // Writes go to action_rules (unified trigger/action framework).
          // email_watch_rules has been retired; evaluate-rules reads action_rules.
          if (supabase) {
            const session = await getSessionWithTimeout();
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
          remoteLog(`[SET_ACTION_RULE] action received | trigger=${String((action as any).trigger_type)} | label=${String((action as any).label ?? '')}`);
          if (supabase) {
            const session = await getSessionWithTimeout();
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
                // 2026-05-22 (Wael) — let, not const: the possessive contact
                // resolver below may rewrite placeName to a street address.
                let placeName = String((action.trigger_config ?? {}).place_name ?? '').trim();
                // Capture spoken name before possessive resolver may overwrite placeName
                // with a physical address. Used for trigger_config.place_name storage so
                // the UI shows "Home" / "James Home" instead of the resolved street address.
                const spokenLabel = placeName;
                console.log(`[orch:loc] entering intercept | place="${placeName}" | one_shot=${action.one_shot} | label="${action.label}"`);
                if (!placeName) {
                  locationIntercepted = true;
                  turnSpeechOverride = "I didn't catch the place for that alert. Can you say it again?";
                  console.log('[orch:loc] empty placeName — skipping');
                  continue;
                }

                // 2026-05-22 (Wael) — POSSESSIVE CONTACT RESOLUTION. Voice
                // parity with naavi-voice-server/src/index.js commit b5446d0
                // + baeac7d. "Alert me when I arrive at Bob's home" -> look
                // up Bob in Google Contacts, use the home address from
                // their contact card directly. No Places picker -- the
                // user's own contact card is authoritative (verified-address
                // rule satisfied: they put it there themselves).
                let possessiveContactSource: { name: string; kind: 'home' | 'office' } | null = null;
                // 2026-05-22 v86 — apostrophe-s is OPTIONAL (Wael feedback:
                // "people say 'Sam home' not 'Sam's home'"). Voice parity.
                const possessive = placeName.match(/^([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)?)(?:['’]s)?\s+(home|house|place|office|work)\s*$/i);
                remoteLog(diagSession, 'loc-placeName', { placeName, hasPossessive: !!possessive });
                if (possessive) {
                  const cName = possessive[1].trim();
                  const cKind = possessive[2].toLowerCase();
                  const wantedTypes = (cKind === 'office' || cKind === 'work') ? ['work'] : ['home', 'other'];
                  console.log(`[orch:loc:possessive] resolving "${placeName}" -> contact="${cName}" kind=${cKind}`);
                  try {
                    const { data: lookupData } = await invokeWithTimeout<any>('lookup-contact', { body: { name: cName } }, 15_000);
                    const all = Array.isArray(lookupData?.contacts) ? lookupData.contacts : (lookupData?.contact ? [lookupData.contact] : []);
                    const qLower = cName.toLowerCase();
                    // Same ranking as voice (commit baeac7d): exact name +
                    // has wanted-type address wins over starts-with no-addr.
                    const scoreContact = (c: any): number => {
                      const cname = String(c?.name || '').toLowerCase();
                      const isExact = cname === qLower;
                      const isStart = cname.startsWith(qLower + ' ');
                      const isWord  = cname.split(/\s+/).includes(qLower);
                      if (!isExact && !isStart && !isWord) return -1;
                      const addrs = Array.isArray(c?.addresses) ? c.addresses : [];
                      const hasWantedAddr = addrs.some((a: any) => wantedTypes.includes(String(a?.type || '').toLowerCase()));
                      const hasAnyAddr    = addrs.length > 0;
                      let s = 0;
                      if (isExact)        s += 100;
                      else if (isStart)   s += 50;
                      else if (isWord)    s += 25;
                      if (hasWantedAddr)  s += 1000;
                      else if (hasAnyAddr) s += 200;
                      return s;
                    };
                    const ranked = all
                      .map((c: any) => ({ c, s: scoreContact(c) }))
                      .filter((x: any) => x.s >= 0)
                      .sort((a: any, b: any) => b.s - a.s);
                    if (ranked.length === 0) {
                      locationIntercepted = true;
                      turnSpeechOverride = `I don't have a contact named ${cName}. Tell me the address directly, or save ${cName} to your contacts first.`;
                      console.log(`[orch:loc:possessive] no name-match contact for "${cName}"`);
                      continue;
                    }
                    const contact = ranked[0].c;
                    // Find address by wanted type first; fall back to ANY address if
                    // the contact only has one address saved without a type label.
                    let addr = (contact.addresses || []).find((a: any) => wantedTypes.includes(String(a?.type || '').toLowerCase()));
                    if (!addr && (contact.addresses || []).length === 1) {
                      addr = contact.addresses[0]; // only one address — use it regardless of type
                      console.log(`[orch:loc:possessive] no typed address, using only address on "${contact.name}"`);
                    }
                    console.log(`[orch:loc:possessive] ranked: ${ranked.map((r: any) => `${r.c.name}(addrs=${(r.c.addresses||[]).length})`).join(', ')} -> picked "${contact.name}"`);
                    if (!addr) {
                      const kindLabel = (cKind === 'office' || cKind === 'work') ? 'office' : 'home';
                      locationIntercepted = true;
                      turnSpeechOverride = `I don't have ${contact.name}'s ${kindLabel} address. Open ${contact.name}'s contact card and add it, or tell me the address now.`;
                      console.log(`[orch:loc:possessive] picked "${contact.name}" has no ${wantedTypes.join('/')} address`);
                      continue;
                    }
                    placeName = String(addr.formattedValue || addr.formatted || '').replace(/\n+/g, ', ').replace(/\s*,\s*,\s*/g, ', ').trim();
                    if (!placeName) {
                      const kindLabel = (cKind === 'office' || cKind === 'work') ? 'office' : 'home';
                      locationIntercepted = true;
                      turnSpeechOverride = `I found ${contact.name} in your contacts but the ${kindLabel} address isn't filled in. Open the contact card and add the address, then try again.`;
                      console.log(`[orch:loc:possessive] addr.formattedValue/formatted was empty for "${contact.name}"`);
                      continue;
                    }
                    possessiveContactSource = { name: contact.name, kind: (cKind === 'office' || cKind === 'work') ? 'office' : 'home' };
                    console.log(`[orch:loc:possessive] resolved to "${placeName}" from contact "${contact.name}"`);
                  } catch (err: any) {
                    console.error('[orch:loc:possessive] lookup failed:', err?.message || err);
                    remoteLog(diagSession, 'loc-possessive-catch', { err: String(err?.message || err).slice(0, 200) });
                    // Fall through; resolve-place will fail gracefully.
                  }
                }

                // 2026-05-22 (Wael) — MEMORY-HIT PRE-RESOLVE CHECK. Voice
                // parity with naavi-voice-server commit b12dbb2. When the
                // user names a place they already have an alert for, surface
                // "you already have one" BEFORE calling Google Places.
                // Skipped for possessive contact resolutions (placeName was
                // rewritten to a street address, no longer a name to match).
                // Personal-address keywords must always go to resolve-place (user_settings),
                // never match against stored alert place_names (e.g. "home" is a substring
                // of "The Home Depot" which would produce a false memory-hit).
                const PERSONAL_PLACE_KEYWORDS = new Set([
                  'home','my home','house','my house','the house','my place','home address',
                  'office','my office','work','my work','work address',
                ]);
                const isPersonalKeyword = PERSONAL_PLACE_KEYWORDS.has(placeName.toLowerCase().trim());
                if (!possessiveContactSource && !isPersonalKeyword) {
                  try {
                    const { data: existingRows } = await queryWithTimeout(
                      supabase!
                        .from('action_rules')
                        .select('id, label, trigger_config, one_shot, enabled')
                        .eq('user_id', session.user.id)
                        .eq('trigger_type', 'location'),
                      10_000,
                      'pre-resolve-memory-hit',
                    );
                    // 2026-05-26 (Wael, B6a) — normalized name match.
                    // "Movati Athletic, Orleans" matches "Movati Athletic
                    // Orleans" matches "movati athletic orleans" — strips
                    // commas/punctuation/apostrophes + collapses whitespace.
                    // Replaces the prior exact-lowercase match that missed
                    // spelling variants.
                    const spokenNormalized = normalizePlaceName(placeName);
                    const match = (Array.isArray(existingRows) ? existingRows : []).find((r: any) => {
                      const rPlace = normalizePlaceName(String(r?.trigger_config?.place_name || ''));
                      if (rPlace.length > 0 && rPlace === spokenNormalized) return true;
                      // Also match against the alert's label or place_name — user may say
                      // "my Mercedes alert" when the place_name is "Mercedes-Benz Ottawa Downtown".
                      // Strip "alert" before comparing: "mercedes alert" → "mercedes"
                      // then check if label OR place_name contains that word.
                      // Strip "alert" suffix and check if the stored place_name
                      // contains the spoken keyword — "mercedes alert" → "mercedes"
                      // matches "mercedes-benz ottawa downtown".
                      // NOTE: do NOT match against label — labels share common words
                      // like "office" across multiple alerts and produce wrong matches.
                      const spokenNoAlert = normalizePlaceName(placeName.replace(/\balert\b/gi, '').trim());
                      if (spokenNoAlert.length > 2 && rPlace.length > 0 && rPlace.includes(spokenNoAlert)) return true;
                      return false;
                    }) as any;
                    if (match) {
                      const enabled = match.enabled !== false;
                      locationIntercepted = true;
                      if (enabled) {
                        // Check if the new action adds tasks, list_name, or body to existing alert.
                        // If so — merge into the existing rule instead of blocking.
                        const newTasks    = Array.isArray(action.action_config?.tasks) ? action.action_config.tasks : [];
                        const newListName = String(action.action_config?.list_name ?? '').trim();
                        const newBody     = String(action.action_config?.body ?? '').trim();
                        const hasNewContent = newTasks.length > 0 || newListName || newBody;

                        if (hasNewContent) {
                          // Merge via manage-rules Edge Function (service_role) — direct client update
                          // silently fails due to RLS on some setups.
                          const { data: mergeData, error: mergeErr } = await invokeWithTimeout<any>(
                            'manage-rules',
                            { body: { op: 'merge_tasks', rule_id: match.id, tasks: newTasks.length > 0 ? newTasks : undefined, list_name: newListName || undefined } },
                            10_000,
                          );
                          if (!mergeErr && mergeData?.ok) {
                            const addedDesc = newListName ? `your ${newListName} list` : newTasks.join(', ') || 'reminder';
                            turnSpeechOverride = `Got it — I've added ${addedDesc} to your existing alert for ${match.trigger_config?.place_name || placeName}.`;
                            console.log(`[orch:loc:memory-hit] merged new content into rule ${match.id}`);
                          } else {
                            console.error('[orch:loc:memory-hit] merge update failed:', mergeErr?.message);
                            turnSpeechOverride = `You already have an alert for ${match.trigger_config?.place_name || placeName}. Tap Alerts to update it.`;
                          }
                          continue;
                        }

                        // No new content — just inform user alert exists.
                        const mode = match.one_shot ? 'one-time' : 'recurring';
                        const addrSuffix = (match.trigger_config?.address)
                          ? ` at ${String(match.trigger_config.address).split(',')[0]?.trim()}`
                          : '';
                        turnSpeechOverride = `You already have a ${mode} alert for ${match.trigger_config?.place_name || placeName}${addrSuffix}. Tap Alerts to change or remove it.`;
                        console.log(`[orch:loc:memory-hit] name-match for "${placeName}" -> rule ${match.id} already enabled (mode=${mode})`);
                      } else {
                        // 2026-05-26 (Wael, B6a) — REPLACED bail-to-UI with
                        // in-chat re-arm. Existing expired rule is updated
                        // in place (enabled=true, last_fired_at=null);
                        // existing action_config preserved so recipient
                        // doesn't silently change.
                        const armResult = await reArmLocationRule(supabase!, match);
                        turnSpeechOverride = armResult.speech;
                        if (armResult.success) {
                          import('@/hooks/useGeofencing')
                            .then(({ syncGeofencesForUser }) => syncGeofencesForUser(session.user.id))
                            .catch(err => console.error('[Orchestrator] geofence sync after re-arm failed:', err));
                        }
                        console.log(`[orch:loc:memory-hit] name-match for "${placeName}" -> rule ${match.id} re-armed (success=${armResult.success})`);
                      }
                      continue;
                    }
                  } catch (err: any) {
                    console.error('[orch:loc:memory-hit] check failed:', err?.message || err);
                    // Fall through to standard resolve-place flow.
                  }
                }
                // V57.10.1 — lazy permission request, "Allow all the time"
                // required. Removed the persistent home banner; we now ask
                // the moment Robert creates a location-trigger rule.
                // Arrival alerts need background permission to fire when
                // the phone is locked, so we request foreground first
                // (Android-required order) then background. Final state
                // is re-checked because Android 11+ opens Settings for
                // background and the request promise can resolve before
                // the user finishes choosing.
                try {
                  const bgInitial = await Location.getBackgroundPermissionsAsync();
                  if (bgInitial.status !== 'granted') {
                    const fgReq = await Location.requestForegroundPermissionsAsync();
                    if (fgReq.status === 'granted') {
                      await Location.requestBackgroundPermissionsAsync();
                    }
                    const bgFinal = await Location.getBackgroundPermissionsAsync();
                    if (bgFinal.status !== 'granted') {
                      locationIntercepted = true;
                      turnSpeechOverride = `Please pick 'Allow all the time' so I can alert you at ${placeName}.`;
                      console.log('[orch:loc] background permission not granted — aborting rule creation');
                      continue;
                    }
                  }
                } catch (err) {
                  console.error('[orch:loc] permission check threw:', err);
                  // Fall through — let downstream sync decide what to do.
                }
                try {
                  remoteLog(diagSession, 'loc-resolve-place-start', { placeName, hasPossessive: !!possessiveContactSource, url: `${SUPABASE_URL}/functions/v1/resolve-place` });
                  const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/resolve-place`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON}` },
                    body: JSON.stringify({
                      user_id: session.user.id,
                      place_name: placeName,
                      save_to_cache: false,
                      // Contact-card addresses are residential — use Geocoding
                      // API directly instead of Places Text Search.
                      use_geocoding: !!possessiveContactSource,
                    }),
                  }, 30000);
                  const data = await res.json();

                  // 1. Settings home/office hit → insert immediately with resolved coords.
                  // V57.13.3 — memory cache removed. The only "instant-commit"
                  // paths now are settings_home / settings_work — explicit
                  // pet-name shortcuts the user defined in their settings.
                  if (data?.status === 'ok' && (data.source === 'settings_home' || data.source === 'settings_work' || data.source === 'contact')) {
                    // V57.11 — explicitly carry radius_meters into trigger_config.
                    // Without this every rule landed with NULL radius (resolve-place
                    // returns one but the orchestrator wasn't reading it), which
                    // breaks OS geofencing because the OS can't register a fence
                    // with no radius. Default 150m if neither resolve-place nor
                    // Claude provided a value.
                    const triggerConfig = {
                      ...(action.trigger_config ?? {}),
                      place_name: formatLocationLabel(spokenLabel) || data.place_name,
                      address: data.address ?? null,
                      resolved_lat: data.lat,
                      resolved_lng: data.lng,
                      radius_meters: data.radius_meters
                        ?? (action.trigger_config as any)?.radius_meters
                        ?? 300,
                    };
                    // V57.18 — location alerts default to RECURRING (one_shot=false).
                    // Most users create alerts for places they visit regularly
                    // (home, work, gym, Costco) where "every time I arrive"
                    // is the natural intent. The server prompt sets one_shot=true
                    // explicitly when the user signals one-time intent ("this
                    // weekend", "today", "remind me to do X" — a task that's
                    // done after the first arrival). We default to false here as
                    // a safety net so a forgotten field doesn't silently disable
                    // the rule after one fire.
                    const oneShot = action.one_shot ?? true;
                    // 2026-05-22 — F2e dedup across fire cycles. Same logic
                    // as commitPending's pre-check: find any rule at these
                    // coords (enabled OR disabled). Disabled dupe →
                    // point user to Reactivate. Enabled dupe → "you
                    // already have one". Without this, the memory-hit path
                    // (settings_home / settings_work shortcuts) would
                    // duplicate rows after an alert fired.
                    {
                      const dupEpsilon = 0.00001;
                      const { data: existingDupes } = await queryWithTimeout(
                        supabase
                          .from('action_rules')
                          .select('id, trigger_config, one_shot, enabled')
                          .eq('user_id', session.user.id)
                          .eq('trigger_type', 'location'),
                        10_000,
                        'check-dup-location-rule-memory-hit',
                      );
                      const dupe = Array.isArray(existingDupes) ? (existingDupes as any[]).find(r => {
                        const rLat = r?.trigger_config?.resolved_lat;
                        const rLng = r?.trigger_config?.resolved_lng;
                        if (typeof rLat !== 'number' || typeof rLng !== 'number') return false;
                        return Math.abs(rLat - data.lat) < dupEpsilon && Math.abs(rLng - data.lng) < dupEpsilon;
                      }) : null;
                      if (dupe) {
                        const dupEnabled = dupe.enabled !== false;
                        locationIntercepted = true;
                        if (dupEnabled) {
                          // Check if the new action adds tasks or list — merge instead of blocking
                          const newTasks    = Array.isArray(action.action_config?.tasks) ? action.action_config.tasks : [];
                          const newListName = String(action.action_config?.list_name ?? '').trim();
                          const hasNewContent = newTasks.length > 0 || newListName;

                          if (hasNewContent) {
                            const { data: mergeData, error: mergeErr } = await invokeWithTimeout<any>(
                              'manage-rules',
                              { body: { op: 'merge_tasks', rule_id: dupe.id, tasks: newTasks.length > 0 ? newTasks : undefined, list_name: newListName || undefined } },
                              10_000,
                            );
                            const dupPlace = String(dupe.trigger_config?.place_name ?? data.place_name);
                            if (!mergeErr && mergeData?.ok) {
                              const addedDesc = newListName ? `your ${newListName} list` : newTasks.join(', ');
                              turnSpeechOverride = `Got it — I've added ${addedDesc} to your existing alert for ${dupPlace}.`;
                              console.log(`[orch:loc:coord-hit] merged tasks into rule ${dupe.id}`);
                            } else {
                              console.error('[orch:loc:coord-hit] merge failed:', mergeErr?.message);
                              turnSpeechOverride = `You already have an alert there. Tap Alerts to update it.`;
                            }
                            continue;
                          }

                          const dupMode = dupe.one_shot ? 'one-time' : 'recurring';
                          const dupAddrSuffix = (dupe.trigger_config?.address)
                            ? ` at ${String(dupe.trigger_config.address).split(',')[0]?.trim()}`
                            : '';
                          const dupPlace = String(dupe.trigger_config?.place_name ?? data.place_name);
                          turnSpeechOverride = `You already have a ${dupMode} alert for ${dupPlace}${dupAddrSuffix}. Say "list my alerts" if you want to change or remove it.`;
                        } else {
                          // 2026-05-26 (Wael, B6a) — REPLACED bail-to-UI with
                          // in-chat re-arm. Refresh place_name/address from
                          // the fresh resolve in case canonical names drifted.
                          const armResult = await reArmLocationRule(supabase!, dupe, {
                            place_name:    data.place_name,
                            address:       data.address ?? null,
                            radius_meters: data.radius_meters ?? (action.trigger_config as any)?.radius_meters ?? 300,
                            one_shot:      action.one_shot ?? (dupe.one_shot === true),
                            action_config: action.action_config as Record<string, any> | undefined,
                          });
                          turnSpeechOverride = armResult.speech;
                          if (armResult.success) {
                            import('@/hooks/useGeofencing')
                              .then(({ syncGeofencesForUser }) => syncGeofencesForUser(session.user.id))
                              .catch(err => console.error('[Orchestrator] geofence sync after re-arm failed:', err));
                          }
                        }
                        continue;
                      }
                    }
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
                          label:          formatLocationLabel(placeName) || String(action.label ?? 'Location alert'),
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
                        placeName: formatLocationLabel(spokenLabel) || data.place_name,
                        address: data.address ?? null,
                        oneShot,
                      });
                      // 2026-05-20 (Wael, B4j) — if action_config carries a
                      // list_name reference, eager-create the list + the
                      // list_connections row so the rule self-references a
                      // real list at fire time (instead of "your X list is
                      // empty" because no list exists at all).
                      const listNameRef = String((actionConfig as any).list_name ?? '').trim();
                      if (listNameRef) {
                        ensureListAttachedToRule(String(insertedRule!.id), listNameRef)
                          .then(r => {
                            if (r.success) console.log(`[Orchestrator] B4j ensureList memory-hit: listLabel="${r.listLabel}" created=${r.created}`);
                            else console.error('[Orchestrator] B4j ensureList memory-hit failed:', r.error);
                          })
                          .catch(err => console.error('[Orchestrator] B4j ensureList memory-hit threw:', err));
                      }
                      // V57.13 Bug U — fire-and-forget so memory-hit replies
                      // don't wait 7-8s on geofence registration before the
                      // chat turn renders.
                      import('@/hooks/useGeofencing')
                        .then(({ syncGeofencesForUser }) => syncGeofencesForUser(session.user.id))
                        .catch((err) => console.error('[Orchestrator] geofence sync after memory-hit insert:', err));
                      // V57.9.7 — first-time battery-exemption nudge.
                      maybePromptBatteryExemption().catch(() => {});
                    }
                    locationIntercepted = true;
                    // V57.4 — speech now states one-time vs every-time so
                    // Robert always knows which mode the rule is in.
                    // V57.6 — fall back to a candid error if the insert
                    // didn't land. Speech-truthfulness rule.
                    // V57.9 — distinguish unique-constraint duplicates (HTTP 409
                    // / Postgres 23505) from real failures. Wael testing 2026-04-30
                    // surfaced this: the office alert had been added twice the
                    // previous evening, blocking new inserts. Old speech ("I
                    // couldn't save the alert") was misleading — the alert was
                    // already set, not failing.
                    const modeText = oneShot ? 'one time' : 'every time';
                    const isDuplicate =
                      (insertErr as any)?.code === '23505' ||
                      /duplicate|already exists|conflict/i.test(insertErr?.message ?? '');
                    const displayName = formatLocationLabel(spokenLabel) || data.place_name;
                    turnSpeechOverride = insertSucceeded
                      ? `Alert set — ${modeText} you arrive at ${displayName}.`
                      : isDuplicate
                        ? `You already have an alert set for ${displayName}.`
                        : `I couldn't save the alert — please try again in a moment.`;
                    console.log(`[orch:loc] turnSpeechOverride set | "${turnSpeechOverride}"`);
                    continue;
                  }

                  // 2a. Address came from contact card — already verified, skip picker.
                  if (data?.status === 'ok' && possessiveContactSource) {
                    pendingLocationRef.current = {
                      originalAction: action,
                      placeName,
                      resolved: {
                        place_name:      formatLocationLabel(spokenLabel) || data.place_name,
                        address:         data.address,
                        lat:             data.lat,
                        lng:             data.lng,
                        canonical_alias: data.canonical_alias,
                        radius_meters:   data.radius_meters,
                      },
                      attempts: 1,
                      createdAt: Date.now(),
                    };
                    // Rule 12 pre-confirmation — show the resolved address and ask Yes/No.
                    // The isYes && pending.resolved handler at the top of send() commits it.
                    locationIntercepted = true;
                    const addrDisplay = data.address && data.address !== data.place_name
                      ? `${data.place_name} at ${data.address.split(',')[0]?.trim()}`
                      : data.place_name;
                    const newTasksPreview = Array.isArray((action.action_config as any)?.tasks) ? (action.action_config as any).tasks as string[] : [];
                    const taskSuffix = newTasksPreview.length > 0 ? ` with a reminder: ${newTasksPreview.join(', ')}` : '';
                    turnSpeechOverride = `I'll set an alert for ${possessiveContactSource.name}'s ${possessiveContactSource.kind} — ${addrDisplay}${taskSuffix}. Say yes to confirm, cancel to skip.`;
                    continue;
                  }

                  // 2b. Fresh resolve → defer to next turn for user confirmation.
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
                      createdAt: Date.now(), // V57.12.1 Bug B
                    };
                    locationIntercepted = true;
                    turnSpeechOverride = `Found ${data.place_name}${data.address && data.address !== data.place_name ? ' at ' + data.address : ''}. Say yes to set the alert, cancel to skip, or give me a different area.`;
                    continue;
                  }

                  // 2b. Multiple candidates → present numbered picker.
                  // V57.11.3 — fires when bare-brand query has 2+ saved or
                  // fresh matches. User picks by number ("two") or by street
                  // name ("Bank"). The pick is handled in send()'s pre-Claude
                  // section via parseLocationPick() against pendingLocation.
                  if (data?.status === 'multiple' && Array.isArray(data.candidates) && data.candidates.length >= 2) {
                    const cands = data.candidates.slice(0, 5);
                    pendingLocationRef.current = {
                      originalAction: action,
                      placeName,
                      resolved: null,
                      candidates: cands,
                      candidatesSource: data.source === 'memory' ? 'memory' : 'fresh',
                      attempts: 1,
                      createdAt: Date.now(), // V57.12.1 Bug B
                    };
                    locationIntercepted = true;
                    const sourcePhrase = data.source === 'memory' ? 'from your saved places' : 'nearby';
                    // V57.11.3 — list format with newlines for the bubble (TTS
                    // reads the newlines as brief pauses, which sounds natural).
                    // Smart pluralization: don't add an 's' if the brand already
                    // ends in 's' (e.g. "Tim Hortons", "Pizza Pizza"). Brand is
                    // the user's exact phrase — Costco, Tim Hortons, McDonald's.
                    // Always show the full first-segment of the address (with
                    // civic number) so two branches on the same street are
                    // unambiguously distinct. Wael 2026-05-05.
                    const brand = placeName.trim();
                    const brandPlural = /s$/i.test(brand) ? brand : `${brand}s`;
                    const lines = cands.map((c: any, i: number) => {
                      const seg = String(c.address || '').split(',')[0]?.trim() || c.place_name;
                      return `${i + 1}. ${seg}`;
                    });
                    turnSpeechOverride = `I see ${cands.length} ${brandPlural} ${sourcePhrase}:\n${lines.join('\n')}\nSay a number or the street name. Or say cancel to stop.`;
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
                      createdAt: Date.now(), // V57.12.1 Bug B
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
                  remoteLog(diagSession, 'loc-resolve-place-catch', { placeName, err: String((err as any)?.message || err).slice(0, 200) });
                  locationIntercepted = true;
                  turnSpeechOverride = "Couldn't reach the location service. Try again in a moment.";
                  continue;
                }
              }

              // ── Non-location triggers: original insert path ──────────────
              // 2026-05-20 (Wael, B4j) — capture the inserted id so we can
              // attach a list_connection if action_config carries a
              // list_name reference. Switched from no-return insert to
              // .select('id').single() for the rule id.
              //
              // 2026-05-24 (Wael, B4y) — defensively normalize
              // trigger_config: Haiku occasionally emits this field as a
              // JSON STRING (instead of an object) when the schema is
              // `oneOf` of multiple sub-schemas. Postgres JSONB accepts
              // strings as valid JSON values, so the rule lands with
              // trigger_config stored as a string — `app/alerts.tsx:134`
              // reads `c.from_name` on a string → undefined → renders
              // "Email from anyone" (the fallback). Live evidence: Bob
              // email rule today (deleted) stored as string. Parse here
              // so the insert always gets an object.
              let normalizedTriggerConfig: any = action.trigger_config ?? {};
              if (typeof normalizedTriggerConfig === 'string') {
                try {
                  normalizedTriggerConfig = JSON.parse(normalizedTriggerConfig);
                  console.log('[Orchestrator] B4y: parsed trigger_config from JSON string');
                } catch (err) {
                  console.warn('[Orchestrator] B4y: failed to parse trigger_config string, using empty object:', err);
                  normalizedTriggerConfig = {};
                }
              }
              // ARCH-1 email path: Haiku emits flat params (from, subject_keyword)
              // not a nested trigger_config. Build trigger_config from flat fields
              // so the insert stores conditions correctly.
              if (triggerType === 'email' && Object.keys(normalizedTriggerConfig).length === 0) {
                const fromVal    = String((action as any).from ?? '').trim();
                const subjectVal = String((action as any).subject_keyword ?? '').trim();
                if (fromVal) {
                  // Email addresses go into from_email so the DB match uses
                  // sender_email; display names go into from_name for sender_name match.
                  if (fromVal.includes('@')) {
                    normalizedTriggerConfig.from_email = fromVal;
                  } else {
                    normalizedTriggerConfig.from_name = fromVal;
                  }
                }
                if (subjectVal) normalizedTriggerConfig.subject_keyword = subjectVal;
                // Build a readable label if Claude didn't supply one
                if (!action.label) {
                  const parts = [fromVal ? `from ${fromVal}` : '', subjectVal ? `about "${subjectVal}"` : ''].filter(Boolean);
                  (action as any).label = parts.length ? `Email ${parts.join(' ')}` : 'Email alert';
                }
                console.log('[Orchestrator] ARCH-1: built email trigger_config from flat params:', normalizedTriggerConfig);
              }
              // 2026-05-24 (Wael, B4y) — default to_phone from
              // user_settings.phone when action_type='sms'/'whatsapp'
              // and no to_phone resolved. SET_EMAIL_ALERT handler at
              // line 2226 already had this default (via getUserPhone);
              // SET_ACTION_RULE didn't, so rules with action_type='sms'
              // and no explicit `to` field landed with no destination
              // phone — silent fail at evaluate-rules fire time.
              if ((actionType === 'sms' || actionType === 'whatsapp') && !actionConfig.to_phone) {
                const { data: settings } = await queryWithTimeout(
                  supabase
                    .from('user_settings')
                    .select('phone')
                    .eq('user_id', session.user.id)
                    .single(),
                  15_000,
                  'select-user-phone-for-set-action-rule',
                );
                if ((settings as any)?.phone) {
                  actionConfig.to_phone = (settings as any).phone;
                  console.log('[Orchestrator] B4y: defaulted to_phone from user_settings:', actionConfig.to_phone);
                }
              }
              // Route through manage-rules Edge Function (service_role) so the
              // insert bypasses RLS that blocks direct client writes on action_rules.
              remoteLog(`[SET_ACTION_RULE] calling manage-rules create | trigger=${triggerType} | label=${String(action.label ?? '')} | userId=${session.user.id.slice(0,8)}`);
              const { data: createRes, error } = await invokeWithTimeout('manage-rules', {
                body: {
                  op:             'create',
                  user_id:        session.user.id,
                  trigger_type:   triggerType,
                  trigger_config: normalizedTriggerConfig,
                  action_type:    actionType,
                  action_config:  actionConfig,
                  label:          String(action.label ?? 'Action rule'),
                  one_shot:       action.one_shot ?? true,
                },
              }, 15_000);
              remoteLog(`[SET_ACTION_RULE] manage-rules response | ok=${(createRes as any)?.ok} | id=${(createRes as any)?.id} | error=${JSON.stringify(error)}`);
              const insertedId = (createRes as any)?.id ?? null;
              const insertedRow = insertedId ? { id: insertedId } : null;
              if (error) {
                console.error('[Orchestrator] SET_ACTION_RULE failed:', error.message);
                remoteLog(`[SET_ACTION_RULE] FAILED | trigger=${triggerType} | error=${JSON.stringify(error)}`);
                // Don't clobber compound queue speech ("On it. First — ...") with an error message.
                // In a compound batch, other actions may have succeeded — log only.
                const isCompoundBatch = (response.speech ?? '').startsWith('On it.');
                if (!isCompoundBatch) {
                  turnSpeechOverride = "I tried to save that alert but something went wrong. Please try again.";
                }
              } else {
                console.log('[Orchestrator] SET_ACTION_RULE saved via manage-rules:', action.label);
                // B4j — eager-create list + connection for the legacy
                // list_name reference shape.
                const listNameRef = String((actionConfig as any).list_name ?? '').trim();
                const ruleIdNew = String((insertedRow as any)?.id ?? '');
                if (listNameRef && ruleIdNew) {
                  ensureListAttachedToRule(ruleIdNew, listNameRef)
                    .then(r => {
                      if (r.success) console.log(`[Orchestrator] B4j ensureList non-location: listLabel="${r.listLabel}" created=${r.created}`);
                      else console.error('[Orchestrator] B4j ensureList non-location failed:', r.error);
                    })
                    .catch(err => console.error('[Orchestrator] B4j ensureList non-location threw:', err));
                }
              }
            }
          }
        }
      }

      // ── Append turn with all its cards ────────────────────────────────────────
      // 2026-05-22 — B4r v81 two-field architecture. Use `display` (rich
      // markdown with bullets / newlines) for the chat bubble if Claude
      // emitted it; otherwise fall back to `speech` (TTS prose). TTS path
      // below (finalSpeech) always uses `response.speech` — never `display`.
      // Older builds that don't read `display` continue to render `speech`
      // as before; no behavior change for replies without `display`.
      let displaySpeech = (typeof response.display === 'string' && response.display.trim().length > 0)
        ? response.display
        : response.speech;
      // Keep "Say yes to send" in display speech — user confirms by typing or voice Yes.
      // Location rule intercept — always wins over Claude's speech.
      if (turnSpeechOverride !== null) {
        displaySpeech = turnSpeechOverride;
      }
      // V57.11.3 — align the bubble's "Leave by" with the card data,
      // matching finalSpeech below. V57.11.5 — also strip Claude's
      // best-effort duration estimate ("About 15 minutes from here")
      // since Claude is hallucinating times that don't match reality;
      // the card has the truth. Match "Leave by" with OR without a
      // time so a truncated Claude speech ("Leave by") still gets the
      // proper time appended. Wael 2026-05-05 caught both bugs at once.
      if (turnSpeechOverride === null && turnNav.length > 0 && turnNav[0].leaveByLabel) {
        displaySpeech = displaySpeech
          .replace(/\babout\s+\d+\s+minutes?\s+(?:from\s+here|away|drive)\b[\.,—–-]?\s*/gi, '')
          .replace(
            /\bleave\s+(?:by|around|at)(?:\s+\d{1,2}(?::\d{2})?\s*(?:a|p)\.?\s*m\.?)?\b\.?/gi,
            turnNav[0].leaveByLabel + '.',
          )
          .replace(/\s+—\s*$/, '.')
          .replace(/\.+$/, '.')
          .trim();
      }
      // V57.12.2 Bug M fix — apply LIST_READ and GLOBAL_SEARCH appendings to
      // the bubble too, not only to TTS. Previously only finalSpeech got these
      // tail-appends, so screen-only users saw a filler bubble ("Looking that
      // up.") while voice users heard the actual answer. Wael 2026-05-06 sweep
      // surfaced this as a voice/text mismatch on FETCH_TRAVEL_TIME and
      // GLOBAL_SEARCH paths. The bubble now mirrors what TTS will say.
      if (turnSpeechOverride === null) {
        for (const lr of turnLists) {
          if (lr.action === 'read' && lr.items && lr.items.length > 0) {
            const itemsText = lr.items.map((item: string, i: number) => `${i + 1}. ${item}`).join('. ');
            displaySpeech += ` Here are the items: ${itemsText}.`;
          }
        }
      }
      const appendTailToDisplay =
        turnSpeechOverride === null &&
        turnGlobalSearch &&
        turnGlobalSearch.origin === 'claude-action';
      if (appendTailToDisplay && turnGlobalSearch!.results.length > 0) {
        // Card shows every result — speech is already the headline from naavi-chat.
        // Don't enumerate "In email: snippet. In drive: filename..." here.
        // Just append a count so the bubble isn't a bare loading phrase.
        const n = turnGlobalSearch!.results.length;
        displaySpeech += n === 1 ? ' I found 1 result.' : ` I found ${n} results.`;
      } else if (appendTailToDisplay) {
        displaySpeech += ` I didn't find anything for ${turnGlobalSearch!.query}.`;
      }
      console.log('[Orchestrator] response.speech:', response.speech);
      console.log('[Orchestrator] displaySpeech (for bubble):', displaySpeech);
      // V57.11.6 — bubble-truncation diagnostic: log the userMessage at
      // the moment it's about to be stored in the turn, so we can see if
      // it matches what arrived at send-entry above.
      remoteLog(bubbleDiag, 'turn-stored', {
        len: userMessage.length,
        head: userMessage.slice(0, 60),
        tail: userMessage.slice(-30),
      });
      endDiagSession(bubbleDiag);
      const newTurn: ConversationTurn = {
        userMessage,
        enrichedUserMessage: enrichedMessage !== userMessage ? enrichedMessage : undefined,
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
        // Card shows every result — speech headline already set by naavi-chat.
        // Don't enumerate sources/snippets in TTS; it reads like a file system.
        const n = turnGlobalSearch!.results.length;
        finalSpeech += n === 1 ? ' I found 1 result.' : ` I found ${n} results.`;
      } else if (appendTail) {
        finalSpeech += ` I didn't find anything for ${turnGlobalSearch!.query}.`;
      }

      // Keep "Say yes to send" in TTS — user confirms by typing or voice Yes.
      // V57.11.2 — align spoken "Leave by" with the card's computed leave time.
      // V57.11.5 — strip Claude's hallucinated duration ("About 15 minutes
      // from here" when the actual is 21 min) and match "Leave by" with or
      // without a time so even a truncated Claude speech gets the correct
      // leave-by appended. Same regex flow as displaySpeech above so TTS
      // and bubble stay in lockstep.
      if (turnNav.length > 0 && turnNav[0].leaveByLabel) {
        finalSpeech = finalSpeech
          .replace(/\babout\s+\d+\s+minutes?\s+(?:from\s+here|away|drive)\b[\.,—–-]?\s*/gi, '')
          .replace(
            /\bleave\s+(?:by|around|at)(?:\s+\d{1,2}(?::\d{2})?\s*(?:a|p)\.?\s*m\.?)?\b\.?/gi,
            turnNav[0].leaveByLabel + '.',
          )
          .replace(/\s+—\s*$/, '.')
          .replace(/\.+$/, '.')
          .trim();
      }
      console.log('[Orchestrator] finalSpeech (for TTS):', finalSpeech);

      // Check if this turn has a confirmable action (Phase A: DRAFT_MESSAGE)
      const confirmableDraft = turnDrafts.find(d => isConfirmable(d));
      const turnIndex = turns.length; // index of the turn being added

      // V57.11.6 — removed the `handsfreeRef.current` guard. With hands-
      // free mode deleted in V57.11.3, handsfreeRef is now const-false and
      // this block NEVER ran, so pendingActionRef was never set. The
      // DraftCard's Send button calls confirmPending() which reads
      // pendingActionRef.current — finds null — does nothing. Wael
      // 2026-05-05: drafted email, tapped Send, no email sent (instead
      // a GLOBAL_SEARCH on the email address). Removing the guard
      // restores the confirm-to-send pipeline for tap-to-talk users.
      if (confirmableDraft) {
        // Pre-resolve contact info so we can verify before sending
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
      speakResponse(finalSpeech, language).then(async () => {
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
        // V57.11.6 — pending action is now ALWAYS preserved across the
        // speak phase so the DraftCard's Send button can commit it.
        // Don't auto-clear; confirmPending / cancelPending / a fresh
        // send() turn handle teardown. Wael 2026-05-05: Send button
        // was broken because the old logic cleared pendingActionRef
        // immediately after speech ended in tap-to-talk mode.
        //
        // Compound queue: if action[0] was a non-DRAFT_MESSAGE type (CREATE_EVENT,
        // REMEMBER, SET_ACTION_RULE, etc.) it executes silently without setting
        // pendingActionRef. After its speech ends, advance the queue so items 2-N
        // are presented one-by-one instead of being left stuck.
        if (compoundQueueRef.current.length > 0 && !pendingActionRef.current) {
          await advanceCompoundQueue(language);
        } else {
          setStatus('idle');
        }
      }).catch(async () => {
        setAudioPlaying(false);
        if (isCancelled()) return;
        if (statusRef.current === 'answer_active') {
          startCooldown();
          return;
        }
        if (statusRef.current === 'cooldown') return;
        if (compoundQueueRef.current.length > 0 && !pendingActionRef.current) {
          await advanceCompoundQueue(language);
        } else {
          setStatus('idle');
        }
      });

    } catch (err) {
      // V57.9 — when sendToNaavi (or any step inside the try) throws, status
      // was being left at 'error' forever, leaving every voice channel locked
      // until the user force-stopped the app (P0 #2 from V57.8 handoff).
      // Show the error briefly, then auto-reset to 'idle' so the user can
      // simply tap and try again.
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Orchestrator] send() threw:', message);
      remoteLog(diagSession, 'orch-outer-catch', { error: message.slice(0, 300) });
      setError(message);
      setStatus('error');
      setTimeout(() => {
        setError(null);
        setStatus('idle');
      }, 4000);
    } finally {
      remoteLog(diagSession, 'orch-send-done', { totalMs: Date.now() - t0 });
      // V57.9.3 stuck-button safety net — if status hasn't returned to
      // 'idle' after send-done (e.g. TTS playback hang after a
      // successful reply, audio focus race after the previous turn),
      // force-reset so the user's mic / send buttons unlock.
      // V57.11.1 — shrunk 30s → 8s. Wael 2026-05-04: TTS hangs were
      // leaving the UI locked for the full 30s while the user waited
      // to reply. 8s is enough headroom for a normal long TTS reply
      // (~6s) but short enough that a hang doesn't feel like "the app
      // froze". Per-chunk TTS playback already has its own internal
      // timeouts so this only fires on edge cases.
      // V57.13.5 — the safety net used to fire force-idle after 8s for any
      // non-idle status, INCLUDING 'speaking'. That hid the orange Stop
      // button for any TTS reply >8s, even when audio was still playing
      // cleanly. Wael 2026-05-07: a 40-second answer had the Stop button
      // disappear after a few seconds; user had no way to interrupt.
      // Fix: if state is 'speaking' AND audio is still playing, the state
      // is NOT stuck — let the normal cleanup (via .then on speakResponse)
      // handle the transition when speech ends. Force-idle only fires for
      // genuine hangs (state stuck but no audio activity).
      setTimeout(() => {
        const stuckStatus = statusRef.current;
        if (stuckStatus !== 'idle' && stuckStatus !== 'cooldown' && stuckStatus !== 'answer_active') {
          if (stuckStatus === 'speaking' && isAudioPlayingRef.current) {
            console.log('[Orchestrator] stuck-state safety — speaking + audio playing, NOT forcing idle');
            remoteLog(diagSession, 'orch-stuck-safety-skip-speaking', { lastStatus: stuckStatus });
            endDiagSession(diagSession);
            return;
          }
          console.warn(`[Orchestrator] stuck-state safety — forcing idle (was ${stuckStatus})`);
          remoteLog(diagSession, 'orch-stuck-safety-fired', { lastStatus: stuckStatus });
          setError(null);
          setStatus('idle');
        }
        endDiagSession(diagSession);
      }, 8_000);
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

    // If this action was part of a compound queue, advance to the next action.
    if (compoundQueueRef.current.length > 0) {
      await advanceCompoundQueue(language);
    }
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
    pendingCompoundItemsRef.current = [];
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
    pendingCompoundItemsRef.current = [];
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
      pendingCompoundItemsRef.current = [];
      setStatus('idle');
    } else if (s === 'speaking') {
      // Silence voice.
      stopSpeaking();
      setAudioPlaying(false);
      // V57.11 — Single-tap unlock for tap-to-talk users. In hands-free
      // mode the answer_active state is meaningful (Naavi keeps thinking
      // in the background while voice is silenced). For tap-to-talk
      // users it just adds a second mandatory tap before they can reply.
      // Skip straight to idle in that case so one Stop tap fully unlocks.
      if (handsfreeRef.current) {
        setStatus('answer_active');
      } else {
        currentTurnIdRef.current++;
        clearCooldownTimer();
        pendingActionRef.current = null;
        setPendingAction(null);
        pendingCompoundItemsRef.current = [];
        setStatus('idle');
      }
    } else if (s === 'answer_active') {
      // V57.10.2 — explicit Cancel goes straight to 'idle' so the mic is
      // released immediately. Previously this called startCooldown() which
      // held the mic locked for 10 seconds. Wael 2026-05-01 with stopwatch:
      // "Cancel doesn't release the mic — it waits until the message
      // completes." The 10-s cooldown still applies to the natural
      // end-of-speech path (startCooldown is still called from the
      // speakResponse .then()/.catch() handlers when speech ends on its
      // own), but explicit Cancel is the user saying "I'm done now."
      currentTurnIdRef.current++;
      stopSpeaking();
      setAudioPlaying(false);
      clearCooldownTimer();
      pendingActionRef.current = null;
      setPendingAction(null);
      pendingCompoundItemsRef.current = [];
      setStatus('idle');
    }
    // cooldown / idle / pending_confirm / error: no-op.
  }, [clearCooldownTimer, setAudioPlaying, startCooldown]);

  // Auto-advance compound pre-confirm items when each item's cycle completes.
  // When status returns to idle and there are still parsed items queued,
  // send the next item to Claude as a standalone request.
  useEffect(() => {
    if (status !== 'idle') return;
    if (pendingCompoundItemsRef.current.length === 0) return;
    if (pendingActionRef.current) return;
    if (compoundQueueRef.current.length > 0) return;
    const nextItem = pendingCompoundItemsRef.current.shift()!;
    console.log(`[compound-pre-confirm] auto-advancing to next item: "${nextItem}"`);
    // Discard any unconfirmed draft cards from prior turns before advancing
    setTurns(prev => prev.map(t => ({
      ...t,
      drafts: (t.drafts ?? []).map((d: any) =>
        d.type === 'DRAFT_MESSAGE' && !d._voiceConfirmed ? { ...d, _discarded: true } : d
      ),
    })));
    send(nextItem);
  }, [status, send]);

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
    // Word-reveal: number of words shown in the latest turn bubble while TTS plays.
    revealWordCount,
    // Chunk-scroll: which chunk is currently playing (for auto-scroll sync).
    currentChunk,
  };
}

// ─── Speech sanitiser ─────────────────────────────────────────────────────────
// Prevents TTS from reading mixed alphanumeric strings as large numbers.
// "aggan2207" → "aggan 2 2 0 7"   |   "test123" → "test 1 2 3"

function sanitiseForSpeech(text: string): string {
  // 2026-05-24 (Wael) — B4f. Normalize Canadian postal codes BEFORE the
  // character-splitter below. Without this, "K1C5M3" gets split into
  // "K 1 C 5 M 3", and the standalone M/N/S/W between digits is then
  // pronounced by Deepgram as the SI unit (meters/newtons/seconds/watts).
  // The downstream text-to-speech Edge Function has the same normalizer
  // but never sees the unsplit form because we mangle it here first.
  // Mirrors text-to-speech/index.ts:200-254.
  const fixPostalLetter = (l: string) => {
    if (l === 'M') return 'em';
    if (l === 'N') return 'en';
    if (l === 'S') return 'ess';
    if (l === 'W') return 'double u';
    return l;
  };
  text = text
    // Full Canadian postal code (L-D-L [optional space] D-L-D).
    .replace(
      /\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/g,
      (_m, l1, d1, l2, d2, l3, d3) =>
        `${fixPostalLetter(l1)} ${d1} ${fixPostalLetter(l2)}, ${d2} ${fixPostalLetter(l3)} ${d3}`,
    )
    // Partial postal-code fragment (D-L-D where L ∈ M/N/S/W).
    .replace(/\b(\d)([MNSW])(\d)\b/g, (_m, d1, l, d2) => `${d1} ${fixPostalLetter(l)} ${d2}`)
    // Province codes (require leading comma so "ON the light" stays intact).
    .replace(/,\s*ON\b/g, ', Ontario')
    .replace(/,\s*QC\b/g, ', Quebec')
    .replace(/,\s*BC\b/g, ', British Columbia')
    .replace(/,\s*AB\b/g, ', Alberta')
    .replace(/,\s*MB\b/g, ', Manitoba')
    .replace(/,\s*SK\b/g, ', Saskatchewan')
    .replace(/,\s*NS\b/g, ', Nova Scotia')
    .replace(/,\s*NB\b/g, ', New Brunswick')
    .replace(/,\s*NL\b/g, ', Newfoundland and Labrador')
    .replace(/,\s*PE\b/g, ', Prince Edward Island')
    .replace(/,\s*YT\b/g, ', Yukon')
    .replace(/,\s*NT\b/g, ', Northwest Territories')
    .replace(/,\s*NU\b/g, ', Nunavut');

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
// V57.10.3 — registry of pending playBase64AudioNative cleanup callbacks.
// Without this, an external stopSpeaking() call stops the audio but the
// playBase64AudioNative Promise stays pending up to 4-15 s waiting for a
// safety timer, because the status-update callback no longer fires once
// playback is stopped. Wael 2026-05-01: Cancel-to-mic-release was 3 s
// (the chunk-duration safety timer firing) instead of near-instant.
// stopSpeaking now invokes the cleanup callback synchronously so the
// Promise resolves immediately and the next tick can release the mic.
let _pendingPlaybackCleanup: ((reason: string) => void) | null = null;

// Chunk-scroll sync — hook registers callbacks; speakCloudNative fires them.
let _revealCallbacks: {
  start: (text: string) => void;
  stop: () => void;
  chunkStart?: (chunkIdx: number, totalChunks: number, charOffset: number, totalChars: number) => void;
} | null = null;

export function stopSpeaking(): void {
  _revealCallbacks?.stop();
  _speechGen++;  // invalidate any in-flight speakResponse
  // B-NEW-4 fix: capture _currentSound BEFORE firing the cleanup callback.
  // cleanupAndResolve (registered as _pendingPlaybackCleanup) sets
  // _currentSound = null when it runs, so the `if (_currentSound)` block
  // below was always skipped — stopAsync() was never called, only
  // unloadAsync() (async/fire-and-forget from cleanupAndResolve), which
  // does not reliably halt playback immediately on Android.
  const soundToStop = _currentSound;
  _currentSound = null;
  // V57.10.3 — release any pending playBase64AudioNative cleanup so the
  // speakResponse Promise resolves immediately instead of waiting for the
  // safety timer.
  if (_pendingPlaybackCleanup) {
    const cb = _pendingPlaybackCleanup;
    _pendingPlaybackCleanup = null;
    try { cb('stopSpeaking-external'); } catch { /* swallow */ }
  }
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
  if (soundToStop) {
    try {
      soundToStop.stopAsync()
        .then(() => soundToStop.unloadAsync().catch(() => {}))
        .catch(() => soundToStop.unloadAsync().catch(() => {}));
    } catch {
      try { soundToStop.unloadAsync().catch(() => {}); } catch {}
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
    // V57.11.6 — root-cause fix for the chronic AudioFocusNotAcquiredException
    // on Android. Wael 2026-05-05: after a useWhisperMemo recording, every
    // TTS chunk-play call threw "expo.modules.av.AudioFocusNotAcquiredException:
    // This experience is currently in the background, so audio focus could
    // not be acquired" → fell back to expo-speech (system TTS, sounds
    // completely different from Aura Hera). Force-closing the app reset
    // the audio mode and TTS came back. Three layers of fix:
    //   1. setIsEnabledAsync(true) — explicitly enable the audio system
    //      before mode change, in case it got disabled.
    //   2. interruptionModeAndroid: DUCK_OTHERS — claim audio focus
    //      explicitly with duck mode, which is the most permissive on
    //      Android and bypasses the "experience in background" check.
    //   3. Brief retry with mode reset on AudioFocusNotAcquiredException —
    //      handled by the catch in the outer playback Promise (see below).
    await Audio.setIsEnabledAsync(true).catch(() => {});
    // V57.12.3 Bug H + no-voice fix — expo-av 16 (SDK 55) renamed the
    // module-level constants. The legacy `Audio.INTERRUPTION_MODE_*_DUCK_OTHERS`
    // references are now `undefined`, and expo-av's setAudioModeAsync throws
    // "interruptionModeIOS was set to an invalid value" on every TTS chunk.
    // Cumulative audio-state churn after several chunks deadlocked Android's
    // audio service (~40-50s) and crashed the JS thread silently — Bug H.
    // Use the named enum imports introduced in expo-av 15+ instead.
    // Wrapped in try/catch as defence-in-depth: even if the mode fails to
    // set, chunk playback now falls through cleanly without leaving the
    // audio session half-mutated.
    try {
      // staysActiveInBackground: true — B3a fix (Wael 2026-05-09). Lets cloud
      // Aura play even when the app is backgrounded so we never fall back to
      // Android native TTS impersonating Naavi. Without this, Android denies
      // audio focus to backgrounded apps and we hit the AudioFocusNotAcquired
      // path → expo-speech fallback → "third voice" perception.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      });
    } catch (modeErr) {
      console.warn('[TTS Native] setAudioModeAsync failed, continuing without explicit mode:', modeErr);
    }
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
        if (_pendingPlaybackCleanup === cleanupAndResolve) _pendingPlaybackCleanup = null;
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        console.log(`[TTS Native] chunk done — ${reason}`);
        resolve();
      };

      // V57.10.3 — register so stopSpeaking() can resolve us immediately
      // instead of waiting for the per-chunk safety timer.
      _pendingPlaybackCleanup = cleanupAndResolve;

      const cleanupAndReject = (err: any) => {
        if (resolved) return;
        resolved = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (_currentSound === sound) _currentSound = null;
        if (_pendingPlaybackCleanup === cleanupAndResolve) _pendingPlaybackCleanup = null;
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
        .catch(async (err) => {
          // V57.11.6 — retry once on AudioFocusNotAcquiredException by
          // re-asserting the audio mode. Wael 2026-05-05: every TTS chunk
          // hit this exception after a recording session, falling back to
          // expo-speech. The retry gives audio focus a second chance after
          // a fresh setIsEnabledAsync + mode reset.
          const msg = String(err?.message ?? err ?? '');
          if (/AudioFocusNotAcquired/i.test(msg)) {
            try {
              await Audio.setIsEnabledAsync(true);
              // V57.12.3 Bug H fix — same enum import fix as the primary
              // audio-mode call site above. Without this the retry path
              // throws on the same `undefined` constants and the audio
              // session never recovers.
              await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
                interruptionModeIOS: InterruptionModeIOS.DuckOthers,
              });
              await sound.playAsync();
              return;
            } catch (retryErr) {
              cleanupAndReject(retryErr);
              return;
            }
          }
          cleanupAndReject(err);
        });
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
  // V57.11.5 — remote-log every TTS step so we can diagnose Aura-Hera-vs-
  // expo-speech fallbacks on Wael's phone without console access.
  const ttsSession = newDiagSession();
  remoteLog(ttsSession, 'tts-entry', {
    voiceEnabled,
    textLen: text?.length ?? 0,
    textHead: (text ?? '').slice(0, 80),
  });
  // Honor global voice-playback toggle.
  if (!voiceEnabled) {
    console.log('[TTS Native] Skipped — voice playback disabled in Settings');
    remoteLog(ttsSession, 'tts-skip-voice-off');
    endDiagSession(ttsSession);
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
  // Build character offsets so we know where each chunk sits in the full text.
  const charOffsets: number[] = [];
  let _searchFrom = 0;
  for (const chunk of chunks) {
    const pos = text.indexOf(chunk, _searchFrom);
    charOffsets.push(pos >= 0 ? pos : _searchFrom);
    _searchFrom = pos >= 0 ? pos + chunk.length : _searchFrom + chunk.length;
  }

  try {
    // Show full text immediately — word-reveal removed; chunk scroll handles sync.
    _revealCallbacks?.start(text);
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
        remoteLog(ttsSession, 'tts-chunk-null', { chunkIdx, total: chunks.length });
        continue;
      }
      if (isStale()) {
        console.log(`[TTS Native] chunk ${chunkIdx}/${chunks.length} stale after fetch, skipping playback`);
        continue;
      }
      // Fire scroll callback 300ms before audio so Robert's eye lands before voice.
      _revealCallbacks?.chunkStart?.(chunkIdx - 1, chunks.length, charOffsets[chunkIdx - 1] ?? 0, text.length);
      console.log(`[TTS Native] playing chunk ${chunkIdx}/${chunks.length} (${base64.length} bytes base64)`);
      remoteLog(ttsSession, 'tts-chunk-play', { chunkIdx, total: chunks.length, bytes: base64.length });
      await playBase64AudioNative(base64);
      playedAny = true;
    }
    // If no cloud TTS chunks played (all returned null), fall back to expo-speech
    if (!playedAny && !isStale()) {
      console.warn(`[TTS Native] All ${chunks.length} chunks returned null — falling back to expo-speech`);
      remoteLog(ttsSession, 'tts-all-null-fallback', { total: chunks.length });
      throw new Error('No TTS audio available');
    }
    if (playedAny) {
      console.log(`[TTS Native] Done — played ${chunks.length} chunks successfully`);
      remoteLog(ttsSession, 'tts-done', { total: chunks.length });
      endDiagSession(ttsSession);
    }
    // Audio finished — show full text immediately regardless of reveal timer.
    _revealCallbacks?.stop();
  } catch (err) {
    if (isStale()) { endDiagSession(ttsSession); return; }
    // Fall back to expo-speech if cloud TTS fails
    console.error('[TTS Native] cloud TTS failed, using expo-speech:', err);
    remoteLog(ttsSession, 'tts-fallback-expo', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    endDiagSession(ttsSession);
    await Speech.stop();
    // 2026-05-24 (Wael) — B4f. Postal-code + province normalization
    // happens upstream in sanitiseForSpeech (called by speakResponse)
    // so `text` here is already normalized. Pass it through directly.
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
