/**
 * useConversationRecorder hook
 *
 * Manages the full long-form conversation recording flow:
 *   idle → recording → uploading → transcribing → labeling → extracting → done
 *
 * Uses AssemblyAI for speaker diarization, then Claude to extract action items.
 */

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout } from '@/lib/invokeWithTimeout';
import { saveToDrive } from '@/lib/drive';
import { saveDriveNote } from '@/lib/supabase';
import { ingestNote } from '@/lib/knowledge';
import { registry } from '@/lib/adapters/registry';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConvState =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'transcribing'
  | 'labeling'      // waiting for user to name speakers
  | 'extracting'
  | 'done'
  | 'error';

export interface Utterance {
  speaker: string;   // 'A', 'B', 'C'
  text: string;
  start: number;
  end: number;
}

export interface ConversationAction {
  type: 'appointment' | 'meeting' | 'call' | 'email' | 'prescription' | 'test' | 'follow_up' | 'task' | 'reminder';
  title: string;
  description: string;
  timing: string;
  suggested_by: string;
  calendar_title?: string;
  email_draft?: string;
  // Structured scheduling fields (extract-actions populates when resolvable).
  start_date?: string; // ISO date "YYYY-MM-DD"
  start_time?: string; // "HH:MM" 24h
  // Prescription-only — used by V57.3 dose-expansion to create N daily events
  // instead of a single one. extract-actions Sonnet emits these for type="prescription".
  duration_days?: number;
  dose_times?: string[]; // array of "HH:MM"
}

export interface UseConversationRecorderResult {
  convState: ConvState;
  convError: string | null;
  elapsedSeconds: number;
  isSupported: boolean;
  // Speaker labeling step
  speakers: string[];                    // ['A', 'B']
  speakerNames: Record<string, string>;  // { A: 'Dr. Ahmed', B: 'Robert' }
  setSpeakerName: (speaker: string, name: string) => void;
  conversationTitle: string;
  setConversationTitle: (title: string) => void;
  // Actions
  startRecording: (language?: string) => void;
  stopRecording: () => void;
  confirmSpeakers: (names: Record<string, string>, title: string) => Promise<void>;
  reset: () => void;
  // Result
  utterances: Utterance[];
  actions: ConversationAction[];
  savedDocLink: string | null;
  confirmedNames: Record<string, string>; // names as entered by user — for display
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useConversationRecorder(): UseConversationRecorderResult {
  const [convState, setConvState] = useState<ConvState>('idle');
  const [convError, setConvError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [conversationTitle, _setConversationTitle] = useState('');
  const setConversationTitle = useCallback((title: string) => {
    conversationTitleRef.current = title;
    _setConversationTitle(title);
  }, []);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [actions, setActions] = useState<ConversationAction[]>([]);
  const [confirmedNames, setConfirmedNames] = useState<Record<string, string>>({});
  const [savedDocLink, setSavedDocLink] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs so confirmSpeakers always reads the latest values regardless of closure timing
  const speakerNamesRef = useRef<Record<string, string>>({});
  const conversationTitleRef = useRef<string>('');
  const utterancesRef = useRef<Utterance[]>([]);

  // Native is always supported via expo-av; web requires MediaRecorder
  const isSupported = Platform.OS !== 'web'
    ? true
    : (typeof window !== 'undefined' &&
       typeof navigator !== 'undefined' &&
       !!navigator.mediaDevices?.getUserMedia &&
       typeof MediaRecorder !== 'undefined');

  // ── Helpers ──────────────────────────────────────────────────────────────

  function clearTimers() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }

  function setError(msg: string) {
    clearTimers();
    setConvError(msg);
    setConvState('error');
    setTimeout(() => { setConvState('idle'); setConvError(null); }, 6000);
  }

  // ── Start recording ───────────────────────────────────────────────────────

  const languageRef = useRef<string | undefined>(undefined);

  const startRecording = useCallback(async (language?: string) => {
    if (!isSupported) { setError('Audio recording not supported in this browser.'); return; }

    languageRef.current = language;
    setConvError(null);
    chunksRef.current = [];
    setElapsedSeconds(0);

    // ── Native (Android/iOS) via expo-av ──────────────────────────────────────
    if (Platform.OS !== 'web') {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') { setError('Microphone permission denied.'); return; }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
        nativeRecordingRef.current = recording;
        setConvState('recording');

        timerRef.current = setInterval(() => {
          setElapsedSeconds(s => s + 1);
        }, 1000);
      } catch (err) {
        console.error('[useConversationRecorder] Native mic error:', err);
        setError('Microphone error. Please try again.');
      }
      return;
    }

    // ── Web via MediaRecorder ─────────────────────────────────────────────────
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setConvState('recording');

      timerRef.current = setInterval(() => {
        setElapsedSeconds(s => s + 1);
      }, 1000);

    }).catch((err) => {
      console.error('[useConversationRecorder] Mic error:', err);
      setError('Microphone blocked. Allow it in your browser settings.');
    });
  }, [isSupported]);

  // ── Stop recording → upload ───────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    clearTimers();

    // ── Native stop ───────────────────────────────────────────────────────────
    if (Platform.OS !== 'web') {
      const recording = nativeRecordingRef.current;
      if (!recording) return;

      try {
        await recording.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = recording.getURI();
        nativeRecordingRef.current = null;

        if (!uri) throw new Error('No recording URI');
        setConvState('uploading');

        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || (info as any).size < 2000) {
          throw new Error('Recording too short — please record at least a few seconds.');
        }

        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await invokeWithTimeout('upload-conversation', {
          body: { audio: base64, mimeType: 'audio/m4a', language: languageRef.current },
        }, 60_000);

        if (error || !data?.transcript_id) {
          throw new Error(error?.message ?? 'Upload failed');
        }

        transcriptIdRef.current = data.transcript_id;
        setConvState('transcribing');
        pollTimerRef.current = setInterval(async () => { await pollTranscription(); }, 4000);

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
      }
      return;
    }

    // ── Web stop ──────────────────────────────────────────────────────────────
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      setConvState('uploading');

      try {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 2000) {
          throw new Error('Recording too short — please record at least a few seconds.');
        }

        const arrayBuffer = await audioBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        const base64 = btoa(binary);

        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await invokeWithTimeout('upload-conversation', {
          body: { audio: base64, mimeType: 'audio/webm', language: languageRef.current },
        }, 60_000);

        if (error || !data?.transcript_id) {
          throw new Error(error?.message ?? 'Upload failed');
        }

        transcriptIdRef.current = data.transcript_id;
        setConvState('transcribing');
        pollTimerRef.current = setInterval(async () => { await pollTranscription(); }, 4000);

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
      }
    };

    recorder.stop();
  }, []);

  // ── Poll AssemblyAI ───────────────────────────────────────────────────────

  async function pollTranscription() {
    const tid = transcriptIdRef.current;
    if (!tid || !supabase) return;

    try {
      // V57.6 — was 15_000 ms, but conversation processing (AssemblyAI
      // transcription + Claude analysis) regularly takes 30-60s. 15s
      // was always firing before the poll completed and failing the
      // visit recorder entirely. 90s is comfortable headroom.
      const { data, error } = await invokeWithTimeout('poll-conversation', {
        body: { transcript_id: tid },
      }, 90_000);

      if (error) throw new Error(error.message);

      if (data.status === 'completed') {
        clearTimers();
        const utts: Utterance[] = data.utterances ?? [];
        const spkrs: string[] = data.speakers ?? [];

        utterancesRef.current = utts;
        setUtterances(utts);
        setSpeakers(spkrs);

        // Default names: Speaker A, Speaker B, etc.
        const defaultNames: Record<string, string> = {};
        spkrs.forEach((s: string) => { defaultNames[s] = ''; });
        speakerNamesRef.current = defaultNames;
        setSpeakerNames(defaultNames);

        setConvState('labeling');
        console.log('[ConvRecorder] Transcription complete. Speakers:', spkrs);

      } else if (data.status === 'error') {
        throw new Error('AssemblyAI transcription failed');
      }
      // else still processing — keep polling

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Polling failed';
      setError(msg);
    }
  }

  // ── Speaker name assignment ───────────────────────────────────────────────

  const setSpeakerName = useCallback((speaker: string, name: string) => {
    speakerNamesRef.current = { ...speakerNamesRef.current, [speaker]: name };
    setSpeakerNames(speakerNamesRef.current);
  }, []);

  // ── Confirm speakers → extract actions ───────────────────────────────────

  const confirmSpeakers = useCallback(async (names: Record<string, string>, title: string) => {
    if (!supabase) return;
    // Names and title are passed directly as parameters — no closure or ref issues
    const currentNames = names;
    const currentTitle = title;
    const currentUtterances = utterancesRef.current;
    console.log('[ConvRecorder] confirmSpeakers — names:', JSON.stringify(currentNames), 'utterances:', currentUtterances.length);
    setConfirmedNames(currentNames);
    setConvState('extracting');

    try {
      // Step 1 — extract action items via Claude
      // V57.6 — was 30_000 ms, but Claude action extraction over a long
      // visit transcript can take 45-60s. 60s is comfortable headroom.
      const { data, error } = await invokeWithTimeout('extract-actions', {
        body: { utterances: currentUtterances, speaker_names: currentNames },
      }, 60_000);

      if (error) throw new Error(error.message);

      const extracted: ConversationAction[] = data?.actions ?? [];
      setActions(extracted);

      // Step 1b — auto-create calendar events for appointments, meetings, tests, follow-ups, prescriptions
      const calendarTypes = ['appointment', 'meeting', 'call', 'test', 'prescription', 'follow_up'];
      const toLocalISO = (d: Date): string => {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      const createdTitles = new Set<string>();
      for (const action of extracted) {
        if (calendarTypes.includes(action.type) && (action.calendar_title || action.title)) {
          const eventTitle = action.calendar_title || action.title;
          if (createdTitles.has(eventTitle.toLowerCase())) continue; // skip duplicates
          createdTitles.add(eventTitle.toLowerCase());
          try {
            // V57.3 — prescription expansion. When the action is a prescription
            // with dose_times + duration_days populated, generate one calendar
            // event per (day, dose_time) instead of a single event. Mirrors the
            // chat path's SCHEDULE_MEDICATION expansion. Prior behaviour (1
            // event for a 10-day course) left Robert without 9 days of dose
            // reminders.
            const isPrescriptionExpand = action.type === 'prescription'
              && Array.isArray(action.dose_times)
              && action.dose_times.length > 0
              && typeof action.duration_days === 'number'
              && action.duration_days > 0;

            // Resolve the start date once, used as day-1 anchor for prescription
            // expansion or as the single event's start for everything else.
            const baseStart: Date = action.start_date
              ? new Date(`${action.start_date}T00:00:00`)
              : (() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() + (isPrescriptionExpand ? 0 : 1));
                  return d;
                })();

            if (isPrescriptionExpand) {
              const doseTimes = action.dose_times!;
              const durationDays = action.duration_days!;
              let createdCount = 0;
              for (let dayOffset = 0; dayOffset < durationDays; dayOffset++) {
                const dayDate = new Date(baseStart);
                dayDate.setDate(dayDate.getDate() + dayOffset);
                for (const timeStr of doseTimes) {
                  const [hh, mm] = String(timeStr).split(':').map(Number);
                  const start = new Date(dayDate);
                  start.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
                  const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 min slot
                  try {
                    await registry.calendar.createEvent({
                      title:       eventTitle,
                      description: `${action.description}\n\nTiming: ${action.timing} (day ${dayOffset + 1} of ${durationDays})\nSuggested by: ${action.suggested_by}`,
                      startISO:    toLocalISO(start),
                      endISO:      toLocalISO(end),
                      attendees:   [],
                    });
                    createdCount++;
                  } catch (err) {
                    console.error('[ConvRecorder] Prescription dose create failed:', eventTitle, dayOffset, timeStr, err);
                  }
                }
              }
              console.log(`[ConvRecorder] Auto-created ${createdCount} prescription dose event(s) for "${eventTitle}" — ${durationDays} days × ${doseTimes.length} doses/day`);
            } else {
              // Single event for everything that isn't a multi-dose prescription.
              const [hh, mm] = (action.start_time ?? '09:00').split(':').map(Number);
              const start = new Date(baseStart);
              start.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
              const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour
              await registry.calendar.createEvent({
                title:       eventTitle,
                description: `${action.description}\n\nTiming: ${action.timing}\nSuggested by: ${action.suggested_by}`,
                startISO:    toLocalISO(start),
                endISO:      toLocalISO(end),
                attendees:   [],
              });
              console.log('[ConvRecorder] Auto-created calendar event:', eventTitle, 'at', toLocalISO(start));
            }
          } catch (err) {
            console.error('[ConvRecorder] Failed to create event:', eventTitle, err);
          }
        }
      }

      // Step 2 — format document content
      const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      const participants = Object.values(currentNames).filter(Boolean).join(', ') || 'Unknown speakers';
      const title = currentTitle.trim() || `Conversation — ${date}`;

      const transcriptLines = currentUtterances.map(u => {
        const name = currentNames[u.speaker] || `Speaker ${u.speaker}`;
        return `${name}: ${u.text}`;
      }).join('\n');

      const actionLines = extracted.length > 0
        ? extracted.map(a => `• [${a.type.toUpperCase()}] ${a.title} — ${a.timing} (advised by ${a.suggested_by})`).join('\n')
        : 'No specific action items identified.';

      const docContent = [
        `CONVERSATION RECORD`,
        `Title: ${title}`,
        `Date: ${date}`,
        `Participants: ${participants}`,
        ``,
        `─────────────────────────────`,
        `TRANSCRIPT`,
        `─────────────────────────────`,
        transcriptLines,
        ``,
        `─────────────────────────────`,
        `ACTION ITEMS`,
        `─────────────────────────────`,
        actionLines,
      ].join('\n');

      // Step 3 — save to Google Drive
      // category='transcript' routes the file into MyNaavi/Transcripts/.
      // Without it the conversation record lands in MyNaavi/ root.
      const driveResult = await saveToDrive({ title, content: docContent, category: 'transcript' });
      if (driveResult.success && driveResult.webViewLink) {
        setSavedDocLink(driveResult.webViewLink);
        await saveDriveNote({ title, webViewLink: driveResult.webViewLink });
        console.log('[ConvRecorder] Saved to Drive:', driveResult.webViewLink);
      } else {
        console.warn('[ConvRecorder] Drive save failed:', driveResult.error);
      }

      // Step 4 — ingest summary to knowledge_fragments for semantic search
      const summaryText = `Conversation titled "${title}" on ${date} with ${participants}. ${actionLines}`;
      ingestNote(summaryText, 'conversation' as never).catch(e =>
        console.warn('[ConvRecorder] Knowledge ingest failed:', e)
      );

      setConvState('done');
      console.log('[ConvRecorder] Extracted', extracted.length, 'actions, speakers:', currentNames);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action extraction failed';
      setError(msg);
    }
  }, []); // refs are always current — no deps needed

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    clearTimers();
    setConvState('idle');
    setConvError(null);
    setElapsedSeconds(0);
    setSpeakers([]);
    speakerNamesRef.current = {};
    setSpeakerNames({});
    conversationTitleRef.current = '';
    setConversationTitle('');
    utterancesRef.current = [];
    setUtterances([]);
    setActions([]);
    setConfirmedNames({});
    setSavedDocLink(null);
    transcriptIdRef.current = null;
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    nativeRecordingRef.current = null;
  }, []);

  return {
    convState,
    convError,
    elapsedSeconds,
    isSupported,
    speakers,
    speakerNames,
    setSpeakerName,
    conversationTitle,
    setConversationTitle,
    startRecording,
    stopRecording,
    confirmSpeakers,
    reset,
    utterances,
    actions,
    savedDocLink,
    confirmedNames,
  };
}
