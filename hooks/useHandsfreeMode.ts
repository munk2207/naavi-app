/**
 * useHandsfreeMode hook — walkie-talkie model
 *
 * Robert controls the conversation with voice keywords:
 *   "Hi Naavi"    → wake up, start listening
 *   "Thank you"   → submit my message to Naavi
 *   "Goodbye"     → exit hands-free mode
 *
 * Flow:
 *   1. Hands-free activated (button or Google intent)
 *   2. Mic opens continuously — always recording
 *   3. Silence detection segments audio into chunks
 *   4. Each chunk is transcribed by Whisper
 *   5. Transcript checked for keywords:
 *      - SUBMIT keyword found → strip it, send message to orchestrator
 *      - EXIT keyword found → deactivate hands-free
 *      - WAKE keyword found → acknowledge and keep listening
 *      - No keyword → discard (garbage/noise), keep listening
 *   6. After Naavi responds → mic reopens, cycle continues
 *
 * Keywords are configurable — edit the KEYWORDS table below.
 *
 * Native (Android/iOS): expo-av metering for silence detection
 * Web: AnalyserNode on MediaRecorder stream
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
  | 'listening'    // mic is active, accepting speech + keywords
  | 'wake_listen'  // mic is active but ONLY listening for "Hi Naavi" (after TTS)
  | 'processing'   // recording stopped, sending to Whisper
  | 'waiting'      // waiting for orchestrator to finish (thinking + speaking)
  | 'paused';      // auto-paused after idle timeout (mic off)

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  activate: () => void;
  deactivate: () => void;
}

// ─── Configurable Keyword Table ─────────────────────────────────────────────
// Edit these to change voice commands. All matching is case-insensitive.
// Each category is an array — any match triggers the action.

export const KEYWORDS = {
  /** Say one of these to submit your message to Naavi */
  SUBMIT: ['thank you', 'thank you naavi', 'thanks', 'thanks naavi', 'over'],

  /** Say one of these to exit hands-free mode completely */
  EXIT: ['goodbye', 'goodbye naavi', 'stop listening', "that's all", 'thats all'],

  /** Say one of these to wake Naavi up (when paused or as acknowledgement) */
  WAKE: ['hi naavi', 'hey naavi', 'hello naavi', 'naavi'],
};

// ─── Audio Constants ────────────────────────────────────────────────────────

const SILENCE_THRESHOLD_DB = -35;       // dB — below this = silence (native)
const SILENCE_THRESHOLD_WEB = 0.02;     // RMS amplitude — below this = silence (web)
const SILENCE_DURATION_MS = 2000;       // 2s of silence → segment (stop recording, transcribe chunk)
const IDLE_TIMEOUT_MS = 60_000;         // 60s of no speech at all → auto-pause
const MIN_RECORDING_MS = 1500;          // ignore recordings shorter than 1.5s
const MIN_SPEECH_MS = 500;              // need at least 500ms of actual speech before segmenting
const METERING_INTERVAL_MS = 250;       // how often to check audio level
const POST_TTS_DELAY_MS = 1500;         // wait after Naavi speaks before opening mic

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
  // Remove the keyword from the end of the transcript (most common position)
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

  // ── Refs for current values (avoid stale closures) ─────────────────────
  const stateRef = useRef<HandsfreeState>('inactive');
  const orchestratorStatusRef = useRef<OrchestratorStatus>(orchestratorStatus);
  const recordingStartedAtRef = useRef<number>(0);
  const sendMessageRef = useRef(sendMessage);
  const speakCueRef = useRef(speakCue);

  // Accumulator: collects transcript fragments until a SUBMIT keyword is spoken
  const pendingTranscriptRef = useRef<string>('');

  // Native recording ref
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

  // Web recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Silence detection refs
  const silenceStartRef = useRef<number | null>(null);
  const speechAccumulatedMsRef = useRef<number>(0);
  const meteringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Idle timeout ref
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether we're in wake-only listening mode (only "Hi Naavi" and "Goodbye" accepted)
  const wakeListenModeRef = useRef<boolean>(false);

  // Function refs to break circular dependency
  const startListeningRef = useRef<() => void>(() => {});
  const submitRecordingRef = useRef<() => void>(() => {});
  const deactivateRef = useRef<() => void>(() => {});

  // Keep refs current
  useEffect(() => { orchestratorStatusRef.current = orchestratorStatus; }, [orchestratorStatus]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { speakCueRef.current = speakCue; }, [speakCue]);

  // ── Cleanup helpers ──────────────────────────────────────────────────────

  const clearMeteringTimer = useCallback(() => {
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = null;
    }
  }, []);

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

  // ── Stop current recording (without transcribing) ────────────────────────

  const stopRecordingSilently = useCallback(async () => {
    clearMeteringTimer();

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
      analyserRef.current = null;
      chunksRef.current = [];
    }
  }, [clearMeteringTimer]);

  // ── Transcribe helpers ───────────────────────────────────────────────────

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
        body: { audio: base64, mimeType: 'audio/webm' },
      });

      if (fnErr || !data?.transcript) return null;
      return data.transcript;
    } catch (err) {
      console.error('[Handsfree] Web transcribe error:', err);
      return null;
    }
  }, []);

  // ── Handle completed transcription (keyword-based) ───────────────────────

  const handleTranscript = useCallback(async (transcript: string | null) => {
    if (!transcript || !transcript.trim()) {
      // Empty — resume listening in same mode
      if (stateRef.current === 'processing') {
        startListeningRef.current();
      }
      return;
    }

    const currentMode = stateRef.current;
    console.log('[Handsfree] Transcript chunk (mode:', currentMode, '):', transcript);

    const lower = transcript.toLowerCase().trim();

    // ── Garbage filter — discard very short non-keyword transcripts ───────
    const wordCount = lower.split(/\s+/).length;
    const hasAnyKeyword = matchesKeyword(lower, KEYWORDS.EXIT) ||
                          matchesKeyword(lower, KEYWORDS.SUBMIT) ||
                          matchesKeyword(lower, KEYWORDS.WAKE);
    if (wordCount <= 2 && !hasAnyKeyword) {
      console.log('[Handsfree] Garbage discarded (too short, no keyword):', transcript);
      startListeningRef.current();
      return;
    }

    // ── EXIT keywords — always checked, highest priority ──────────────────
    if (matchesKeyword(lower, KEYWORDS.EXIT)) {
      console.log('[Handsfree] EXIT keyword detected');
      pendingTranscriptRef.current = '';
      speakCueRef.current('Goodbye Robert.');
      deactivateRef.current();
      return;
    }

    // ── WAKE keyword — transitions from wake_listen → full listening ──────
    if (matchesKeyword(lower, KEYWORDS.WAKE)) {
      console.log('[Handsfree] WAKE keyword detected — switching to full listening');
      pendingTranscriptRef.current = '';
      wakeListenModeRef.current = false;
      setState('listening');
      speakCueRef.current("I'm listening.");
      // Switch to full listening mode after cue plays
      setTimeout(() => {
        startListeningRef.current();
      }, 1500);
      return;
    }

    // ── If in wake_listen mode, discard everything that isn't WAKE or EXIT ─
    if (currentMode === 'processing' && wakeListenModeRef.current) {
      console.log('[Handsfree] Wake-only mode — discarding non-keyword audio');
      startListeningRef.current();
      return;
    }

    // ── SUBMIT keywords — send accumulated message ────────────────────────
    const submitMatch = matchesKeyword(lower, KEYWORDS.SUBMIT);
    if (submitMatch) {
      const fullText = (pendingTranscriptRef.current + ' ' + transcript).trim();
      const cleaned = stripKeyword(fullText, submitMatch);
      pendingTranscriptRef.current = '';

      if (!cleaned) {
        console.log('[Handsfree] SUBMIT keyword but no message, resuming');
        startListeningRef.current();
        return;
      }

      console.log('[Handsfree] SUBMIT — sending:', cleaned);
      setState('waiting');
      clearIdleTimer();
      await sendMessageRef.current(cleaned);
      return;
    }

    // ── No keyword — accumulate pending text ──────────────────────────────
    pendingTranscriptRef.current = (pendingTranscriptRef.current + ' ' + transcript).trim();
    console.log('[Handsfree] No keyword — accumulated:', pendingTranscriptRef.current);
    startListeningRef.current();
  }, [clearIdleTimer]);

  // ── Submit recording (silence segmented a chunk) ─────────────────────────

  const submitRecording = useCallback(async () => {
    if (stateRef.current !== 'listening') return;

    const elapsed = Date.now() - recordingStartedAtRef.current;
    if (elapsed < MIN_RECORDING_MS) {
      console.log('[Handsfree] Recording too short, resuming');
      await stopRecordingSilently();
      startListeningRef.current();
      return;
    }

    clearMeteringTimer();
    setState('processing');

    let transcript: string | null = null;

    if (isNative) {
      const recording = nativeRecordingRef.current;
      if (recording) {
        transcript = await transcribeNative(recording);
      }
    } else {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        transcript = await new Promise<string | null>((resolve) => {
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
      }
      mediaRecorderRef.current = null;
      analyserRef.current = null;
    }

    await handleTranscript(transcript);
  }, [clearMeteringTimer, stopRecordingSilently, transcribeNative, transcribeWeb, handleTranscript]);

  // Keep submitRecording ref current
  useEffect(() => { submitRecordingRef.current = submitRecording; }, [submitRecording]);

  // ── Native listening with metering ───────────────────────────────────────

  const startNativeListening = useCallback(async () => {
    try {
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== 'granted') {
        setError('Microphone permission denied.');
        deactivateRef.current();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: 2,      // MPEG_4
          audioEncoder: 3,      // AAC
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
      });

      nativeRecordingRef.current = recording;
      setState('listening');
      resetIdleTimer();

      // Poll metering for silence detection (segments audio into chunks)
      let speechDetected = false;
      speechAccumulatedMsRef.current = 0;
      meteringTimerRef.current = setInterval(async () => {
        if (stateRef.current !== 'listening' || !nativeRecordingRef.current) return;

        try {
          const statusResult = await nativeRecordingRef.current.getStatusAsync();
          if (!statusResult.isRecording) return;

          const db = statusResult.metering ?? -160;

          if (db > SILENCE_THRESHOLD_DB) {
            speechDetected = true;
            speechAccumulatedMsRef.current += METERING_INTERVAL_MS;
            silenceStartRef.current = null;
            resetIdleTimer();
          } else if (speechDetected && speechAccumulatedMsRef.current >= MIN_SPEECH_MS) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now();
            } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
              console.log('[Handsfree] Silence segment (native), speech:', speechAccumulatedMsRef.current, 'ms');
              submitRecordingRef.current();
            }
          }
        } catch {
          // Recording may have been stopped
        }
      }, METERING_INTERVAL_MS);

    } catch (err) {
      console.error('[Handsfree] Native start error:', err);
      setError('Could not start microphone.');
      deactivateRef.current();
    }
  }, [resetIdleTimer]);

  // ── Web listening with AnalyserNode ──────────────────────────────────────

  const startWebListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      setState('listening');
      resetIdleTimer();

      const dataArray = new Float32Array(analyser.fftSize);
      let speechDetected = false;
      speechAccumulatedMsRef.current = 0;

      meteringTimerRef.current = setInterval(() => {
        if (stateRef.current !== 'listening' || !analyserRef.current) return;

        analyserRef.current.getFloatTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms > SILENCE_THRESHOLD_WEB) {
          speechDetected = true;
          speechAccumulatedMsRef.current += METERING_INTERVAL_MS;
          silenceStartRef.current = null;
          resetIdleTimer();
        } else if (speechDetected && speechAccumulatedMsRef.current >= MIN_SPEECH_MS) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
            console.log('[Handsfree] Silence segment (web), speech:', speechAccumulatedMsRef.current, 'ms');
            submitRecordingRef.current();
          }
        }
      }, METERING_INTERVAL_MS);

    } catch (err) {
      console.error('[Handsfree] Web start error:', err);
      setError('Microphone blocked. Allow it in your browser settings.');
      deactivateRef.current();
    }
  }, [resetIdleTimer]);

  // ── Start listening ──────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    setError(null);
    silenceStartRef.current = null;
    recordingStartedAtRef.current = Date.now();

    if (isNative) {
      startNativeListening();
    } else {
      startWebListening();
    }
  }, [startNativeListening, startWebListening]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Watch orchestrator: speaking → idle = mic OFF, wait for tap ──────────
  // Mic is completely closed after Naavi responds. No background listening.
  // Robert taps Resume to start the next turn. "Hey Google" will also work
  // once the app is published on Play Store.

  useEffect(() => {
    if (stateRef.current === 'waiting' && orchestratorStatus === 'idle') {
      console.log('[Handsfree] Orchestrator idle — mic OFF, waiting for tap');
      setState('paused');
    }
  }, [orchestratorStatus]);

  // ── Activate ─────────────────────────────────────────────────────────────

  const activate = useCallback(() => {
    if (stateRef.current !== 'inactive' && stateRef.current !== 'paused') return;

    console.log('[Handsfree] Activating');
    pendingTranscriptRef.current = '';
    wakeListenModeRef.current = false;
    speakCueRef.current("I'm listening.");

    setTimeout(() => {
      startListeningRef.current();
    }, 1500);
  }, []);

  // ── Deactivate ───────────────────────────────────────────────────────────

  const deactivateInternal = useCallback(async () => {
    console.log('[Handsfree] Deactivating');
    clearMeteringTimer();
    clearIdleTimer();
    await stopRecordingSilently();
    pendingTranscriptRef.current = '';
    wakeListenModeRef.current = false;
    setState('inactive');
  }, [clearMeteringTimer, clearIdleTimer, stopRecordingSilently]);

  useEffect(() => { deactivateRef.current = deactivateInternal; }, [deactivateInternal]);

  const deactivate = useCallback(() => {
    deactivateInternal();
  }, [deactivateInternal]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearMeteringTimer();
      clearIdleTimer();
      stopRecordingSilently();
    };
  }, [clearMeteringTimer, clearIdleTimer, stopRecordingSilently]);

  return { state, error, activate, deactivate };
}
