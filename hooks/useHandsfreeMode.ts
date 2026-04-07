/**
 * useHandsfreeMode hook — walkie-talkie model with native speech recognition
 *
 * Robert controls the conversation with voice keywords:
 *   "Hi Naavi"    → wake up, start listening
 *   "Thanks"      → submit my message to Naavi
 *   "Goodbye"     → exit hands-free mode
 *
 * Speech detection uses Android's native SpeechRecognizer via
 * @jamsch/expo-speech-recognition. Built-in VAD means silence never
 * produces a transcript — no hallucinations.
 *
 * Web fallback: MediaRecorder + Whisper (unchanged).
 *
 * Keywords are configurable — edit the KEYWORDS table below.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from '@jamsch/expo-speech-recognition';
import { supabase } from '@/lib/supabase';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandsfreeState =
  | 'inactive'     // not in hands-free mode
  | 'listening'    // recognition active, waiting for speech
  | 'processing'   // speech captured, processing transcript
  | 'waiting'      // waiting for orchestrator to finish (thinking + speaking)
  | 'paused';      // paused (idle timeout or error)

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  activate: () => void;
  deactivate: () => void;
}

// ─── Configurable Keyword Table ─────────────────────────────────────────────
// Edit these to change voice commands. All matching is case-insensitive.

export const KEYWORDS = {
  /** Say one of these to submit your message to Naavi */
  SUBMIT: ['thank you', 'thank you naavi', 'thanks', 'thanks naavi', 'over'],

  /** Say one of these to exit hands-free mode completely */
  EXIT: ['goodbye', 'goodbye naavi', 'stop listening', "that's all", 'thats all'],

  /** Say one of these to wake Naavi up (after response or from paused) */
  WAKE: ['hi naavi', 'hey naavi', 'hello naavi', 'naavi'],
};

// ─── Constants ──────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 60_000;         // 60s of no speech → auto-pause
const POST_TTS_DELAY_MS = 1500;         // wait after Naavi speaks before recognition resumes

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

// ─── Keyword matching helpers ───────────────────────────────────────────────

function matchesKeyword(transcript: string, keywords: string[]): string | null {
  const lower = transcript.toLowerCase().trim();
  for (const kw of keywords) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function stripKeyword(transcript: string, keyword: string): string {
  const lower = transcript.toLowerCase();
  const idx = lower.lastIndexOf(keyword);
  if (idx >= 0) {
    const before = transcript.slice(0, idx).trim();
    const after = transcript.slice(idx + keyword.length).trim();
    return (before + ' ' + after).trim();
  }
  return transcript;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useHandsfreeMode(
  orchestratorStatus: OrchestratorStatus,
  sendMessage: (text: string) => Promise<void>,
  speakCue: (text: string) => void,
): UseHandsfreeModeResult {
  const [state, setState] = useState<HandsfreeState>('inactive');
  const [error, setError] = useState<string | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────
  const stateRef = useRef<HandsfreeState>('inactive');
  const sendMessageRef = useRef(sendMessage);
  const speakCueRef = useRef(speakCue);

  // Pending transcript accumulator (for multi-chunk speech before keyword)
  const pendingTranscriptRef = useRef<string>('');

  // Web recording refs (fallback)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Idle timeout ref
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Function refs to break circular deps
  const startListeningRef = useRef<() => void>(() => {});
  const deactivateRef = useRef<() => void>(() => {});

  // Keep refs current
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { speakCueRef.current = speakCue; }, [speakCue]);

  // ── Cleanup helpers ──────────────────────────────────────────────────

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      if (stateRef.current === 'listening') {
        console.log('[Handsfree] Idle timeout — no speech for 60s');
        setState('paused');
        speakCueRef.current('Listening paused. Say Hi Naavi to resume.');
        // Stop native recognition
        if (isNative) {
          try { ExpoSpeechRecognitionModule.abort(); } catch {}
        }
      }
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimer]);

  const stopRecordingSilently = useCallback(async () => {
    if (isNative) {
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
    } else {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    }
  }, []);

  // ── Handle transcript (keyword-based) ──────────────────────────────────

  const handleTranscript = useCallback(async (transcript: string | null) => {
    if (!transcript || !transcript.trim()) {
      if (stateRef.current === 'processing') {
        startListeningRef.current();
      }
      return;
    }

    console.log('[Handsfree] Transcript:', transcript);
    const lower = transcript.toLowerCase().trim();

    // Garbage filter — very short, no keyword
    const wordCount = lower.split(/\s+/).length;
    const hasAnyKeyword = matchesKeyword(lower, KEYWORDS.EXIT) ||
                          matchesKeyword(lower, KEYWORDS.SUBMIT) ||
                          matchesKeyword(lower, KEYWORDS.WAKE);
    if (wordCount <= 2 && !hasAnyKeyword) {
      console.log('[Handsfree] Discarded (short, no keyword):', transcript);
      startListeningRef.current();
      return;
    }

    // EXIT — highest priority
    if (matchesKeyword(lower, KEYWORDS.EXIT)) {
      console.log('[Handsfree] EXIT keyword');
      pendingTranscriptRef.current = '';
      clearIdleTimer();
      await stopRecordingSilently();
      setState('inactive');
      speakCueRef.current('Goodbye Robert.');
      return;
    }

    // WAKE — acknowledge and listen
    if (matchesKeyword(lower, KEYWORDS.WAKE)) {
      console.log('[Handsfree] WAKE keyword');
      pendingTranscriptRef.current = '';
      setState('listening');
      speakCueRef.current("I'm listening.");
      setTimeout(() => { startListeningRef.current(); }, 1500);
      return;
    }

    // SUBMIT — send message
    const submitMatch = matchesKeyword(lower, KEYWORDS.SUBMIT);
    if (submitMatch) {
      const fullText = (pendingTranscriptRef.current + ' ' + transcript).trim();
      const cleaned = stripKeyword(fullText, submitMatch);
      pendingTranscriptRef.current = '';

      if (!cleaned) {
        console.log('[Handsfree] SUBMIT but no message');
        startListeningRef.current();
        return;
      }

      console.log('[Handsfree] SUBMIT:', cleaned);
      setState('waiting');
      clearIdleTimer();
      await sendMessageRef.current(cleaned);
      return;
    }

    // No keyword — accumulate
    pendingTranscriptRef.current = (pendingTranscriptRef.current + ' ' + transcript).trim();
    console.log('[Handsfree] Accumulated:', pendingTranscriptRef.current);
    startListeningRef.current();
  }, [clearIdleTimer, stopRecordingSilently]);

  // ══════════════════════════════════════════════════════════════════════
  // ── NATIVE: expo-speech-recognition event handlers ────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // Speech detected — reset idle timer
  useSpeechRecognitionEvent('speechstart', () => {
    if (stateRef.current !== 'listening') return;
    console.log('[Handsfree] speechstart — speech detected');
    resetIdleTimer();
  });

  // Final result — process transcript
  useSpeechRecognitionEvent('result', (event) => {
    if (stateRef.current !== 'listening' && stateRef.current !== 'processing') return;
    const result = event.results[event.results.length - 1];
    if (!result) return;

    // Only act on final results
    if (result.isFinal) {
      const transcript = result.transcript;
      console.log('[Handsfree] Final result:', transcript);
      setState('processing');
      handleTranscript(transcript);
    }
  });

  // Recognition ended — restart if still listening (continuous loop)
  useSpeechRecognitionEvent('end', () => {
    console.log('[Handsfree] Recognition ended, state:', stateRef.current);
    // Android may stop recognition after each utterance even with continuous: true
    // Restart if we're still supposed to be listening
    if (stateRef.current === 'listening') {
      console.log('[Handsfree] Restarting recognition (auto-restart)');
      setTimeout(() => {
        if (stateRef.current === 'listening') {
          startListeningRef.current();
        }
      }, 300);
    }
  });

  // Error — log and restart if recoverable
  useSpeechRecognitionEvent('error', (event) => {
    console.error('[Handsfree] Recognition error:', event.error, event.message);
    // "no-speech" is normal — just means silence, restart
    if (event.error === 'no-speech') {
      if (stateRef.current === 'listening') {
        startListeningRef.current();
      }
      return;
    }
    // For other errors, try to recover
    if (stateRef.current === 'listening' || stateRef.current === 'processing') {
      setTimeout(() => {
        if (stateRef.current === 'listening') {
          startListeningRef.current();
        }
      }, 1000);
    }
  });

  // ── Web transcribe helper (fallback) ──────────────────────────────────

  const transcribeWeb = useCallback(async (chunks: Blob[]): Promise<string | null> => {
    try {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      if (audioBlob.size < 1000) return null;

      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      const base64 = btoa(binary);

      const { data, error: fnErr } = await supabase.functions.invoke('transcribe-memo', {
        body: { audio: base64, mimeType: 'audio/webm', language: 'en' },
      });

      if (fnErr || !data?.transcript) return null;
      return data.transcript;
    } catch (err) {
      console.error('[Handsfree] Web transcribe error:', err);
      return null;
    }
  }, []);

  // ── Start listening ───────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    setError(null);

    setState('listening');
    resetIdleTimer();

    if (isNative) {
      // ── Native: expo-speech-recognition ───────────────────────────
      try {
        const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (status !== 'granted') {
          setError('Microphone/speech permission denied.');
          deactivateRef.current();
          return;
        }

        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          continuous: true,
          interimResults: false,
          contextualStrings: [
            ...KEYWORDS.SUBMIT,
            ...KEYWORDS.EXIT,
            ...KEYWORDS.WAKE,
          ],
        });
      } catch (err) {
        console.error('[Handsfree] Native start error:', err);
        setError('Could not start speech recognition.');
        deactivateRef.current();
      }
    } else {
      // ── Web: MediaRecorder + Whisper (fallback) ───────────────────
      try {
        await stopRecordingSilently();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        chunksRef.current = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;

        // Web placeholder: record 8s then transcribe
        setTimeout(async () => {
          if (stateRef.current !== 'listening' || !mediaRecorderRef.current) return;
          setState('processing');
          const rec = mediaRecorderRef.current;
          if (rec && rec.state !== 'inactive') {
            const transcript = await new Promise<string | null>((resolve) => {
              rec.onstop = async () => {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
                }
                const result = await transcribeWeb([...chunksRef.current]);
                chunksRef.current = [];
                resolve(result);
              };
              rec.stop();
            });
            mediaRecorderRef.current = null;
            await handleTranscript(transcript);
          }
        }, 8000);

      } catch (err) {
        console.error('[Handsfree] Web start error:', err);
        setError('Microphone blocked.');
        deactivateRef.current();
      }
    }
  }, [stopRecordingSilently, resetIdleTimer, transcribeWeb, handleTranscript]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Watch orchestrator: speaking → idle = wait then resume listening ────

  useEffect(() => {
    if (stateRef.current === 'waiting' && orchestratorStatus === 'idle') {
      console.log('[Handsfree] Orchestrator idle — resuming after delay');
      setTimeout(() => {
        if (stateRef.current === 'waiting') {
          startListeningRef.current();
        }
      }, POST_TTS_DELAY_MS);
    }
  }, [orchestratorStatus]);

  // ── Activate ─────────────────────────────────────────────────────────────

  const activate = useCallback(async () => {
    if (stateRef.current !== 'inactive' && stateRef.current !== 'paused') return;
    console.log('[Handsfree] Activating');
    await stopRecordingSilently();
    pendingTranscriptRef.current = '';
    speakCueRef.current("I'm listening.");
    setTimeout(() => { startListeningRef.current(); }, 1500);
  }, [stopRecordingSilently]);

  // ── Deactivate ───────────────────────────────────────────────────────────

  const deactivateInternal = useCallback(async () => {
    console.log('[Handsfree] Deactivating');
    clearIdleTimer();
    await stopRecordingSilently();
    pendingTranscriptRef.current = '';
    setState('inactive');
  }, [clearIdleTimer, stopRecordingSilently]);

  useEffect(() => { deactivateRef.current = deactivateInternal; }, [deactivateInternal]);

  const deactivate = useCallback(() => {
    deactivateInternal();
  }, [deactivateInternal]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearIdleTimer();
      stopRecordingSilently();
    };
  }, [clearIdleTimer, stopRecordingSilently]);

  return { state, error, activate, deactivate };
}
