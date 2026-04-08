/**
 * useHandsfreeMode hook
 *
 * Hands-free voice mode using expo-av recording + Google Cloud STT.
 * Records 5-second audio chunks, sends to transcribe-google Edge Function,
 * and uses keyword detection to control the conversation.
 *
 * Keywords:
 *   "Hi Naavi"  → wake / start fresh listening
 *   "Thanks"    → submit accumulated speech to orchestrator
 *   "Goodbye"   → exit hands-free mode
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandsfreeState =
  | 'inactive'
  | 'listening'
  | 'processing'
  | 'waiting'
  | 'paused';

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  activate: () => void;
  deactivate: () => void;
}

// ─── Configurable Keyword Table ─────────────────────────────────────────────

export const KEYWORDS = {
  SUBMIT: ['thank you', 'thank you naavi', 'thanks', 'thanks naavi', 'over'],
  EXIT: ['goodbye', 'goodbye naavi', 'stop listening', "that's all", 'thats all'],
  WAKE: ['hi naavi', 'hey naavi', 'hello naavi', 'naavi'],
};

// ─── Constants ──────────────────────────────────────────────────────────────

const CHUNK_DURATION_MS = 5000;        // 5-second recording chunks
const IDLE_TIMEOUT_MS = 60000;         // 60s silence → pause
const POST_TTS_DELAY_MS = 1500;        // wait after TTS before reopening mic
const SILENCE_COUNT_TO_PAUSE = 12;     // 12 × 5s = 60s of silence → pause

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

// ─── Helpers ────────────────────────────────────────────────────────────────

function matchKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase().trim();
  return keywords.some(k => lower.includes(k));
}

function stripKeywords(text: string): string {
  let lower = text.toLowerCase();
  for (const kw of [...KEYWORDS.SUBMIT, ...KEYWORDS.WAKE]) {
    lower = lower.replace(new RegExp(kw, 'gi'), '');
  }
  return lower.replace(/\s+/g, ' ').trim();
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useHandsfreeMode(
  orchestratorStatus: OrchestratorStatus,
  sendMessage: (text: string) => Promise<void>,
  speakCue: (text: string) => Promise<void>,
): UseHandsfreeModeResult {
  const [state, setState] = useState<HandsfreeState>('inactive');
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<HandsfreeState>('inactive');
  const pendingTextRef = useRef('');
  const silenceCountRef = useRef(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const loopActiveRef = useRef(false);
  const waitingForOrchestratorRef = useRef(false);

  // Keep stateRef in sync
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Watch orchestrator status: when it goes idle after 'waiting', resume listening ──
  useEffect(() => {
    if (!waitingForOrchestratorRef.current) return;
    if (orchestratorStatus === 'idle' && stateRef.current === 'waiting') {
      waitingForOrchestratorRef.current = false;
      // Delay before reopening mic (prevents picking up TTS audio)
      setTimeout(() => {
        if (stateRef.current === 'waiting' || stateRef.current === 'paused') {
          console.log('[Handsfree] Orchestrator done, resuming listening');
          pendingTextRef.current = '';
          silenceCountRef.current = 0;
          setState('listening');
          stateRef.current = 'listening';
          startRecordingLoop();
        }
      }, POST_TTS_DELAY_MS);
    }
  }, [orchestratorStatus]);

  // ── Record one 5-second chunk and return base64 ──
  async function recordChunk(): Promise<{ base64: string; mimeType: string } | null> {
    try {
      console.log('[Handsfree] Requesting mic permission...');
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError('Microphone permission denied.');
        return null;
      }

      console.log('[Handsfree] Setting audio mode for recording...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });

      console.log('[Handsfree] Starting 5s recording...');
      const { recording } = await Audio.Recording.createAsync({
        android: {
          extension: '.3gp',
          outputFormat: 2,      // THREE_GPP (was MPEG_4)
          audioEncoder: 4,      // AMR_WB — directly supported by Google Cloud STT
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 23850,       // AMR-WB standard bitrate
        },
        ios: {
          extension: '.m4a',
          outputFormat: 'aac',
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

      recordingRef.current = recording;

      // Wait for chunk duration
      await new Promise(resolve => setTimeout(resolve, CHUNK_DURATION_MS));

      // Stop recording — check it's still the same recording (not deactivated)
      if (recordingRef.current !== recording) {
        console.log('[Handsfree] Recording was replaced during wait — skipping');
        return null;
      }

      await recording.stopAndUnloadAsync();
      recordingRef.current = null;

      const uri = recording.getURI();
      console.log('[Handsfree] Recording URI:', uri);
      if (!uri) {
        console.error('[Handsfree] No URI from recording');
        return null;
      }

      if (isNative) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log(`[Handsfree] Got base64 audio: ${base64.length} chars`);
        return { base64, mimeType: Platform.OS === 'android' ? 'audio/amr-wb' : 'audio/m4a' };
      } else {
        // Web fallback — not primary target but kept for testing
        return null;
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Handsfree] Record error:', msg);
      setError(`Recording failed: ${msg}`);
      if (isNative) Alert.alert('Handsfree Debug', `Record error: ${msg}`);
      recordingRef.current = null;
      return null;
    }
  }

  // ── Send audio to Google Cloud STT ──
  async function transcribe(base64: string, mimeType: string): Promise<string> {
    try {
      console.log(`[Handsfree] Sending ${base64.length} chars to transcribe-google...`);
      const { data, error: fnError } = await supabase.functions.invoke('transcribe-google', {
        body: { audio: base64, mimeType, language: 'en' },
      });

      if (fnError) {
        console.error('[Handsfree] Transcribe error:', fnError.message);
        setError(`Transcribe failed: ${fnError.message}`);
        return '';
      }

      console.log('[Handsfree] Transcribe result:', JSON.stringify(data));
      return data?.transcript ?? '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Handsfree] Transcribe exception:', msg);
      setError(`Transcribe exception: ${msg}`);
      return '';
    }
  }

  // ── Main recording loop ──
  async function startRecordingLoop() {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;

    console.log('[Handsfree] Recording loop started');
    if (isNative) Alert.alert('Handsfree Debug', 'Recording loop started');

    while (loopActiveRef.current && stateRef.current === 'listening') {
      const chunk = await recordChunk();

      // Check if we were deactivated during recording
      if (!loopActiveRef.current || stateRef.current !== 'listening') break;

      if (!chunk) {
        silenceCountRef.current++;
        if (silenceCountRef.current >= SILENCE_COUNT_TO_PAUSE) {
          console.log('[Handsfree] Idle timeout — pausing');
          setState('paused');
          stateRef.current = 'paused';
          await speakCue("I'll be here when you need me. Say Hi Naavi to continue.");
          break;
        }
        continue;
      }

      // Transcribe
      setState('processing');
      stateRef.current = 'processing';
      const transcript = await transcribe(chunk.base64, chunk.mimeType);

      // Check if deactivated during transcription
      if (!loopActiveRef.current) break;

      if (!transcript) {
        // Silence — no hallucination, just record next chunk
        silenceCountRef.current++;
        if (silenceCountRef.current >= SILENCE_COUNT_TO_PAUSE) {
          console.log('[Handsfree] Idle timeout — pausing');
          setState('paused');
          stateRef.current = 'paused';
          await speakCue("I'll be here when you need me. Say Hi Naavi to continue.");
          break;
        }
        setState('listening');
        stateRef.current = 'listening';
        continue;
      }

      // Got speech — reset silence counter
      silenceCountRef.current = 0;
      console.log(`[Handsfree] Transcript: "${transcript}"`);

      // ── Keyword detection ──

      // EXIT: goodbye
      if (matchKeyword(transcript, KEYWORDS.EXIT)) {
        console.log('[Handsfree] EXIT keyword detected');
        loopActiveRef.current = false;
        setState('inactive');
        stateRef.current = 'inactive';
        await speakCue('Goodbye Robert. Talk to you soon.');
        break;
      }

      // SUBMIT: thanks / over
      if (matchKeyword(transcript, KEYWORDS.SUBMIT)) {
        // Add any speech before the keyword to pending
        const cleaned = stripKeywords(transcript);
        if (cleaned) pendingTextRef.current += (pendingTextRef.current ? ' ' : '') + cleaned;

        const messageToSend = pendingTextRef.current.trim();
        if (messageToSend) {
          console.log(`[Handsfree] SUBMIT: "${messageToSend}"`);
          setState('waiting');
          stateRef.current = 'waiting';
          waitingForOrchestratorRef.current = true;
          loopActiveRef.current = false;
          pendingTextRef.current = '';
          await sendMessage(messageToSend);
        } else {
          // No accumulated text — keep listening
          setState('listening');
          stateRef.current = 'listening';
        }
        break;
      }

      // WAKE: hi naavi — reset and start fresh
      if (matchKeyword(transcript, KEYWORDS.WAKE)) {
        console.log('[Handsfree] WAKE keyword — starting fresh');
        pendingTextRef.current = '';
        const cleaned = stripKeywords(transcript);
        if (cleaned) pendingTextRef.current = cleaned;
        setState('listening');
        stateRef.current = 'listening';
        continue;
      }

      // Regular speech — accumulate
      pendingTextRef.current += (pendingTextRef.current ? ' ' : '') + transcript;
      console.log(`[Handsfree] Accumulated: "${pendingTextRef.current}"`);
      setState('listening');
      stateRef.current = 'listening';
    }

    loopActiveRef.current = false;
    console.log('[Handsfree] Recording loop ended');
  }

  // ── Activate hands-free mode ──
  const activate = useCallback(async () => {
    if (stateRef.current !== 'inactive' && stateRef.current !== 'paused') return;

    console.log('[Handsfree] Activating');
    setError(null);
    pendingTextRef.current = '';
    silenceCountRef.current = 0;

    setState('listening');
    stateRef.current = 'listening';

    await speakCue("I'm listening.");

    startRecordingLoop();
  }, []);

  // ── Deactivate hands-free mode ──
  const deactivate = useCallback(async () => {
    console.log('[Handsfree] Deactivating');
    loopActiveRef.current = false;
    waitingForOrchestratorRef.current = false;
    pendingTextRef.current = '';

    // Stop any in-progress recording
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {}
      recordingRef.current = null;
    }

    setState('inactive');
    stateRef.current = 'inactive';
  }, []);

  return { state, error, activate, deactivate };
}
