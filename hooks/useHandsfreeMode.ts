/**
 * useHandsfreeMode hook — walkie-talkie model with VAD
 *
 * Robert controls the conversation with voice keywords:
 *   "Hi Naavi"    → wake up, start listening
 *   "Thanks"      → submit my message to Naavi
 *   "Goodbye"     → exit hands-free mode
 *
 * Speech detection uses Silero VAD (on-device ML model) to distinguish
 * real speech from silence/noise. Only real speech is sent to Whisper.
 * Silence never reaches Whisper — no hallucinations.
 *
 * Flow:
 *   1. Hands-free activated → VAD starts monitoring mic
 *   2. VAD detects speech → start capturing audio
 *   3. VAD detects speech end → stop capture, transcribe via Whisper
 *   4. Transcript checked for keywords (SUBMIT/EXIT/WAKE)
 *   5. After Naavi responds → VAD keeps monitoring for "Hi Naavi"
 *   6. No taps needed at any point
 *
 * Keywords are configurable — edit the KEYWORDS table below.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandsfreeState =
  | 'inactive'     // not in hands-free mode
  | 'listening'    // VAD is monitoring mic, waiting for speech
  | 'processing'   // speech captured, sending to Whisper
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
const POST_TTS_DELAY_MS = 1500;         // wait after Naavi speaks before VAD resumes

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

  // Native recording ref
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

  // Web recording refs
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
      }
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimer]);

  const stopRecordingSilently = useCallback(async () => {
    if (isNative) {
      const recording = nativeRecordingRef.current;
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch {}
        nativeRecordingRef.current = null;
      }
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

  // ── Transcribe helpers ─────────────────────────────────────────────────

  const transcribeNative = useCallback(async (recording: Audio.Recording): Promise<string | null> => {
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      nativeRecordingRef.current = null;

      if (!uri) return null;

      const raw = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      const base64 = raw.replace(/\s/g, '');

      const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
      const mimeMap: Record<string, string> = { m4a: 'audio/m4a', mp4: 'audio/mp4', '3gp': 'audio/3gp', wav: 'audio/wav' };
      const mimeType = mimeMap[ext] ?? 'audio/m4a';

      const { data, error: fnErr } = await supabase.functions.invoke('transcribe-memo', {
        body: { audio: base64, mimeType, language: 'en' },
      });

      if (fnErr || !data?.transcript) return null;
      return data.transcript;
    } catch (err) {
      console.error('[Handsfree] Native transcribe error:', err);
      return null;
    }
  }, []);

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
  // ── VAD-POWERED LISTENING ─────────────────────────────────────────────
  //
  // TODO: Replace this section with Silero VAD integration.
  //
  // Current: placeholder that records for a fixed window, then transcribes.
  // Target:  VAD detects speech start → record → VAD detects speech end
  //          → transcribe. Silence never sent to Whisper.
  //
  // The VAD integration will:
  //   1. Open mic and feed audio frames to Silero VAD model
  //   2. VAD returns true/false for each frame (is speech?)
  //   3. On speech start: begin capturing audio to a buffer
  //   4. On speech end (after sustained silence): stop capture
  //   5. Send only the speech buffer to Whisper for transcription
  //   6. Loop: keep VAD monitoring for next speech segment
  // ══════════════════════════════════════════════════════════════════════

  // Placeholder: record for up to 10s, then transcribe
  // This will be replaced by VAD-triggered recording
  const startListening = useCallback(async () => {
    setError(null);
    await stopRecordingSilently();

    setState('listening');
    resetIdleTimer();

    if (isNative) {
      try {
        const { status: permStatus } = await Audio.requestPermissionsAsync();
        if (permStatus !== 'granted') {
          setError('Microphone permission denied.');
          deactivateRef.current();
          return;
        }

        try {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: false });
        } catch {}
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        const recordingOptions = {
          isMeteringEnabled: true,
          android: {
            extension: '.m4a',
            outputFormat: 2,
            audioEncoder: 3,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 32000,
          },
          ios: {
            extension: '.m4a',
            outputFormat: 'aac' as any,
            audioQuality: 32,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 32000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
        };

        let recording: Audio.Recording;
        try {
          ({ recording } = await Audio.Recording.createAsync(recordingOptions));
        } catch {
          await new Promise(r => setTimeout(r, 500));
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          ({ recording } = await Audio.Recording.createAsync(recordingOptions));
        }

        nativeRecordingRef.current = recording;

        // ── VAD PLACEHOLDER ──────────────────────────────────────────
        // Currently: record for 8 seconds max, then transcribe.
        // With VAD: speech-start → capture, speech-end → stop & transcribe.
        // The 8s window is a temporary safety net.
        setTimeout(async () => {
          if (stateRef.current !== 'listening' || !nativeRecordingRef.current) return;
          setState('processing');
          const transcript = await transcribeNative(nativeRecordingRef.current);
          await handleTranscript(transcript);
        }, 8000);

      } catch (err) {
        console.error('[Handsfree] Native start error:', err);
        setError('Could not start microphone.');
        deactivateRef.current();
      }
    } else {
      // Web path — placeholder
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        chunksRef.current = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;

        setTimeout(async () => {
          if (stateRef.current !== 'listening' || !mediaRecorderRef.current) return;
          setState('processing');
          const recorder = mediaRecorderRef.current;
          if (recorder && recorder.state !== 'inactive') {
            const transcript = await new Promise<string | null>((resolve) => {
              recorder.onstop = async () => {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
                }
                const result = await transcribeWeb([...chunksRef.current]);
                chunksRef.current = [];
                resolve(result);
              };
              recorder.stop();
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
  }, [stopRecordingSilently, resetIdleTimer, transcribeNative, transcribeWeb, handleTranscript]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Watch orchestrator: speaking → idle = wait then resume listening ────

  useEffect(() => {
    if (stateRef.current === 'waiting' && orchestratorStatus === 'idle') {
      console.log('[Handsfree] Orchestrator idle — resuming VAD after delay');
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
