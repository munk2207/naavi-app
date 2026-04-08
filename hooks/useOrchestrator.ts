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
import { sendToNaavi, type NaaviMessage, type NaaviAction, type BriefItem } from '@/lib/naavi-client';
import { saveContact, saveReminder, saveDriveNote, saveConversationTurn, supabase } from '@/lib/supabase';
import { sendPushNotification } from '@/lib/push';
import { extractPersonQuery, getPersonContext, formatPersonContext, savePerson, saveTopic } from '@/lib/memory';
import { lookupContact, lookupContactByPhone } from '@/lib/contacts';
import { ingestNote, deleteKnowledge, fetchAllKnowledge, searchKnowledge } from '@/lib/knowledge';
import { registry } from '@/lib/adapters/registry';
import type { StorageFile, NavigationResult } from '@/lib/types';

export type OrchestratorStatus = 'idle' | 'thinking' | 'speaking' | 'error';

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
  timestamp?: string;
}

export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = [], avoidHighways = false) {
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

    _speechStopped = false;
    setStatus('thinking');
    setError(null);

    // This turn's cards — collected during processing
    const turnNav: NavigationResult[] = [];
    const turnDrive: StorageFile[] = [];
    const turnDrafts: NaaviAction[] = [];
    const turnEvents: { summary: string; htmlLink?: string }[] = [];
    const turnDeleted: { count: number; titles: string[] }[] = [];
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

      // Check if this is a broad knowledge query — fetch memories directly
      const isBroadQuery = /\b(all|list|everything|what do you know|preferences?|what.*know.*me|know about me|what is my|what are my)\b/i.test(userMessage);

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
          if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              const { error } = await supabase.from('email_watch_rules').insert({
                user_id:         session.user.id,
                from_name:       action.fromName       ? String(action.fromName)       : null,
                from_email:      action.fromEmail      ? String(action.fromEmail)      : null,
                subject_keyword: action.subjectKeyword ? String(action.subjectKeyword) : null,
                phone_number:    String(action.phoneNumber ?? '+16137697957'),
                label:           String(action.label ?? 'Email alert'),
              });
              if (error) console.error('[Orchestrator] SET_EMAIL_ALERT failed:', error.message);
              else console.log('[Orchestrator] SET_EMAIL_ALERT saved:', action.label);
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

              const { error } = await supabase.from('action_rules').insert({
                user_id:        session.user.id,
                trigger_type:   String(action.trigger_type ?? 'email'),
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
      const newTurn = {
        userMessage,
        assistantSpeech: response.speech,
        drafts:           turnDrafts,
        createdEvents:    turnEvents,
        deletedEvents:    turnDeleted,
        savedDocs:        turnDocs,
        rememberedItems:  turnMemory,
        driveFiles:       turnDrive,
        navigationResults: turnNav,
        timestamp: new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
      setTurns(prev => [...prev, newTurn]);
      saveConversationTurn(newTurn).catch(() => {});

      // Speak concurrently — text appears and voice starts at the same time
      setStatus('speaking');
      speakResponse(response.speech, language).then(() => setStatus('idle')).catch(() => setStatus('idle'));

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStatus('error');
    }
  }, [status, language]);

  const clearHistory = useCallback(() => {
    stopSpeaking();
    setTurns([]);
    setError(null);
    setStatus('idle');
  }, []);

  const loadHistory = useCallback((savedTurns: ConversationTurn[]) => {
    setTurns(savedTurns);
  }, []);

  const stopAndReset = useCallback(() => {
    stopSpeaking();
    setStatus('idle');
  }, []);

  return { status, turns, error, send, clearHistory, loadHistory, stopSpeaking: stopAndReset };
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
      body: { text: chunk, voice: 'nova' },
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
