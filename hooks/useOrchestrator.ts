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
import { sendToNaavi, type NaaviMessage, type NaaviAction, type BriefItem } from '@/lib/naavi-client';
import { saveContact, saveReminder, saveDriveNote } from '@/lib/supabase';
import { extractPersonQuery, getPersonContext, formatPersonContext, savePerson, saveTopic } from '@/lib/memory';
import { lookupContact, lookupContactByPhone } from '@/lib/contacts';
import { ingestNote } from '@/lib/knowledge';
import { registry } from '@/lib/adapters/registry';
import type { StorageFile, NavigationResult } from '@/lib/types';

export type OrchestratorStatus = 'idle' | 'thinking' | 'speaking' | 'error';

export interface ConversationTurn {
  userMessage: string;
  assistantSpeech: string;
  drafts: NaaviAction[];
  createdEvents: { summary: string; htmlLink?: string }[];
  savedDocs: { title: string; webViewLink?: string }[];
  rememberedItems: { text: string; count: number }[];
  driveFiles: StorageFile[];
  navigationResults: NavigationResult[];
}

export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = []) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Always-current ref — send() reads this so it never uses a stale brief
  const briefRef = useRef(briefItems);
  useEffect(() => { briefRef.current = briefItems; }, [briefItems]);

  // Derive history for Claude context from turns
  const historyRef = useRef<NaaviMessage[]>([]);
  useEffect(() => {
    historyRef.current = turns.flatMap(t => [
      { role: 'user' as const,      content: t.userMessage },
      { role: 'assistant' as const, content: t.assistantSpeech },
    ]);
  }, [turns]);

  const send = useCallback(async (userMessage: string) => {
    if (status === 'thinking' || status === 'speaking') return;

    setStatus('thinking');
    setError(null);

    // This turn's cards — collected during processing
    const turnNav: NavigationResult[] = [];
    const turnDrive: StorageFile[] = [];
    const turnDrafts: NaaviAction[] = [];
    const turnEvents: { summary: string; htmlLink?: string }[] = [];
    const turnDocs: { title: string; webViewLink?: string }[] = [];
    const turnMemory: { text: string; count: number }[] = [];

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

      const response = await sendToNaavi(enrichedMessage, historyRef.current, briefRef.current, language);
      console.log('[Orchestrator] actions:', JSON.stringify(response.actions));

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
            });
            turnEvents.push({ summary: event.title, htmlLink: event.htmlLink });
          } catch (err) {
            console.error('[Orchestrator] CREATE_EVENT failed:', err);
          }
        }

        if (action.type === 'FETCH_TRAVEL_TIME') {
          const destination   = String(action.destination   ?? '').trim();
          const eventStartISO = String(action.eventStartISO ?? '').trim();
          if (destination) {
            try {
              const result = await registry.maps.fetchTravelTime(destination, eventStartISO);
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

        if (action.type === 'DRAFT_MESSAGE' || action.type === 'ADD_CONTACT') {
          turnDrafts.push(action);
        }

        if (action.type === 'ADD_CONTACT') {
          const name = String(action.name ?? '');
          await saveContact({ name, email: String(action.email ?? ''), phone: String(action.phone ?? ''), relationship: String(action.relationship ?? '') });
          await savePerson({ name, email: String(action.email ?? ''), phone: String(action.phone ?? ''), relationship: String(action.relationship ?? '') });
        } else if (action.type === 'SET_REMINDER') {
          await saveReminder({ title: String(action.title ?? ''), datetime: String(action.datetime ?? ''), source: String(action.source ?? '') });
        } else if (action.type === 'LOG_CONCERN') {
          await saveTopic({ subject: String(action.category ?? 'general'), note: String(action.note ?? ''), category: String(action.severity ?? 'low') });
        } else if (action.type === 'UPDATE_PROFILE') {
          await saveTopic({ subject: String(action.key ?? 'preference'), note: String(action.value ?? ''), category: 'preference' });
        }
      }

      // ── Append turn with all its cards ────────────────────────────────────────
      setTurns(prev => [...prev, {
        userMessage,
        assistantSpeech: response.speech,
        drafts:           turnDrafts,
        createdEvents:    turnEvents,
        savedDocs:        turnDocs,
        rememberedItems:  turnMemory,
        driveFiles:       turnDrive,
        navigationResults: turnNav,
      }]);

      // Speak the response aloud
      setStatus('speaking');
      await speakResponse(response.speech, language);
      setStatus('idle');

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStatus('error');
    }
  }, [status, language]);

  const clearHistory = useCallback(() => {
    setTurns([]);
    setError(null);
    setStatus('idle');
  }, []);

  return { status, turns, error, send, clearHistory };
}

// ─── Speech helper ────────────────────────────────────────────────────────────

async function speakResponse(text: string, language: 'en' | 'fr'): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    return speakWeb(text, language);
  }
  await Speech.stop();
  return new Promise((resolve) => {
    Speech.speak(text, {
      language: language === 'fr' ? 'fr-CA' : 'en-CA',
      rate: 0.85,
      pitch: 1.0,
      onDone: resolve,
      onError: () => resolve(),
    });
  });
}

// Preferred voices in order — first match wins across all browsers/OS
const PREFERRED_VOICES_EN = [
  'Microsoft Aria Online (Natural)',   // Edge / Windows — best quality
  'Microsoft Jenny Online (Natural)',  // Edge / Windows
  'Google UK English Female',          // Chrome
  'Google US English',                 // Chrome fallback
  'Samantha',                          // Safari / macOS
  'Karen',                             // Safari / macOS AU
];
const PREFERRED_VOICES_FR = [
  'Microsoft Denise Online (Natural)', // Edge / Windows
  'Google français',                   // Chrome
  'Amelie',                            // Safari / macOS
];

function getPreferredVoice(language: 'en' | 'fr'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const list = language === 'fr' ? PREFERRED_VOICES_FR : PREFERRED_VOICES_EN;
  for (const name of list) {
    const match = voices.find(v => v.name === name);
    if (match) return match;
  }
  // Last resort: any voice matching the language
  const langCode = language === 'fr' ? 'fr' : 'en';
  return voices.find(v => v.lang.startsWith(langCode)) ?? null;
}

function speakWeb(text: string, language: 'en' | 'fr'): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.0;
    utterance.lang = language === 'fr' ? 'fr-CA' : 'en-CA';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    const applyVoiceAndSpeak = () => {
      const voice = getPreferredVoice(language);
      if (voice) {
        utterance.voice = voice;
        console.log('[Speech] Using voice:', voice.name);
      }
      window.speechSynthesis.speak(utterance);
    };

    // Voices may not be loaded yet on first call — wait for them
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      applyVoiceAndSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        applyVoiceAndSpeak();
      };
    }
  });
}
