/**
 * useHandsfreeMode hook
 *
 * Wraps existing Whisper recording + orchestrator into a continuous
 * hands-free voice loop so Robert never needs to tap the screen.
 *
 * Flow:
 *   activate() → mic starts → Robert speaks → silence detected (~2s)
 *   → auto-submit to Whisper → orchestrator processes → Naavi speaks
 *   → mic restarts → Robert speaks again → …
 *   → Robert says "goodbye" or 60s silence → deactivate
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
  | 'listening'    // mic is active, waiting for speech
  | 'processing'   // recording stopped, sending to Whisper
  | 'waiting'      // waiting for orchestrator to finish (thinking + speaking)
  | 'paused';      // auto-paused after silence timeout

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  activate: () => void;
  deactivate: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD_DB = -45;       // dB — below this = silence (native)
const SILENCE_THRESHOLD_WEB = 0.01;     // RMS amplitude — below this = silence (web)
const SILENCE_DURATION_MS = 2000;       // 2s of silence → auto-submit
const IDLE_TIMEOUT_MS = 60_000;         // 60s of no speech at all → auto-exit
const MIN_RECORDING_MS = 1000;          // ignore recordings shorter than 1s
const METERING_INTERVAL_MS = 250;       // how often to check audio level

// Exit keywords — checked against lowercase transcript
const EXIT_KEYWORDS = ['goodbye', 'stop listening', "that's all", 'thats all'];

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

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

  // Native recording ref
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

  // Web recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Silence detection refs
  const silenceStartRef = useRef<number | null>(null);
  const meteringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Idle timeout ref (no speech for 60s → auto-exit)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Function refs to break circular dependency:
  // startListening ↔ submitRecording ↔ handleTranscript all call each other
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
        speakCueRef.current('Listening paused. Tap to resume.');
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
        body: { audio: base64, mimeType },
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
      if (audioBlob.size < 1000) return null; // too short

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

  // ── Core loop functions (assigned to refs to break circular deps) ────────

  // handleTranscript: process transcription result
  const handleTranscript = useCallback(async (transcript: string | null) => {
    if (!transcript || !transcript.trim()) {
      // Empty transcription — resume listening
      if (stateRef.current === 'processing') {
        startListeningRef.current();
      }
      return;
    }

    console.log('[Handsfree] Transcript:', transcript);

    // Check for exit keywords
    const lower = transcript.toLowerCase().trim();
    if (EXIT_KEYWORDS.some(kw => lower.includes(kw))) {
      console.log('[Handsfree] Exit keyword detected');
      speakCueRef.current('Goodbye Robert.');
      deactivateRef.current();
      return;
    }

    // Send to orchestrator
    setState('waiting');
    clearIdleTimer();
    await sendMessageRef.current(transcript);
    // The useEffect watching orchestratorStatus will restart listening when idle
  }, [clearIdleTimer]);

  // submitRecording: stop recording and transcribe
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

  // startNativeListening: open mic with metering
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

      // Poll metering for silence detection
      let speechDetected = false;
      meteringTimerRef.current = setInterval(async () => {
        if (stateRef.current !== 'listening' || !nativeRecordingRef.current) return;

        try {
          const statusResult = await nativeRecordingRef.current.getStatusAsync();
          if (!statusResult.isRecording) return;

          const db = statusResult.metering ?? -160;

          if (db > SILENCE_THRESHOLD_DB) {
            speechDetected = true;
            silenceStartRef.current = null;
            resetIdleTimer();
          } else if (speechDetected) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now();
            } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
              console.log('[Handsfree] Silence detected (native), submitting');
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

  // startWebListening: open mic with AnalyserNode
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
          silenceStartRef.current = null;
          resetIdleTimer();
        } else if (speechDetected) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
            console.log('[Handsfree] Silence detected (web), submitting');
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

  // startListening: entry point that delegates to native or web
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

  // Keep startListening ref current
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Watch orchestrator: speaking → idle = restart listening ───────────────

  useEffect(() => {
    if (stateRef.current === 'waiting' && orchestratorStatus === 'idle') {
      console.log('[Handsfree] Orchestrator idle, restarting listening');
      startListeningRef.current();
    }
  }, [orchestratorStatus]);

  // ── Activate ─────────────────────────────────────────────────────────────

  const activate = useCallback(() => {
    if (stateRef.current !== 'inactive' && stateRef.current !== 'paused') return;

    console.log('[Handsfree] Activating');
    speakCueRef.current("I'm listening.");

    // Small delay so the "I'm listening" cue plays before mic opens
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
    setState('inactive');
  }, [clearMeteringTimer, clearIdleTimer, stopRecordingSilently]);

  // Keep deactivate ref current
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
