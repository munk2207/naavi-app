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
import { Platform } from 'react-native';
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

// ── Detect Whisper hallucinations (invented text on silence/noise) ──
// Whisper never returns empty for silence — it invents YouTube outros,
// fillers, and repeated phrases. This filter catches them so the silence
// counter can actually climb and hands-free can auto-pause.
function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase().replace(/[.!?]+$/, '');

  // Rule 1 — too short to be real speech
  if (lower.length < 3) return true;

  // Rule 2 — known Whisper outro phrases
  const outros = [
    'for watching',
    'thank you for watching',
    'thanks for watching',
    'subscribe',
    'like and subscribe',
    "don't forget to like and subscribe",
    'see you in the next video',
    'see you next time',
    'see you again',
    'if you enjoyed',
    'jingle bells',
    'welcome to pyramid chili',
  ];
  if (outros.some(o => lower === o || lower.includes(o))) return true;

  // Rule 3 — filler word standing alone
  const fillers = ['mm', 'uh', 'ah', 'hmm', 'okay', 'ok', 'bye', 'yeah', 'huh'];
  if (fillers.includes(lower)) return true;

  // Rule 4 — same short word/phrase repeated 3+ times in a row
  //   e.g. "america acts america acts america acts"
  const words = lower.split(/\s+/);
  if (words.length >= 3) {
    // check repeated single words
    for (let i = 0; i <= words.length - 3; i++) {
      if (words[i] === words[i + 1] && words[i + 1] === words[i + 2]) return true;
    }
    // check repeated 2-word phrases
    if (words.length >= 6) {
      for (let i = 0; i <= words.length - 6; i++) {
        if (
          words[i] === words[i + 2] && words[i + 2] === words[i + 4] &&
          words[i + 1] === words[i + 3] && words[i + 3] === words[i + 5]
        ) return true;
      }
    }
  }

  return false;
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
      // Clean up any leftover recording — Android only allows one at a time
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (_) { /* already stopped */ }
        recordingRef.current = null;
      }

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
          extension: '.m4a',
          outputFormat: 2,      // MPEG_4
          audioEncoder: 3,      // AAC
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
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
        return { base64, mimeType: 'audio/m4a' };
      } else {
        // Web fallback — not primary target but kept for testing
        return null;
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Handsfree] Record error:', msg);
      setError(`Recording failed: ${msg}`);
      // Debug alerts removed — errors show via setError() on screen
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

    try {
    while (loopActiveRef.current && stateRef.current === 'listening') {
      const chunk = await recordChunk();

      // Check if we were deactivated during recording
      if (!loopActiveRef.current || stateRef.current !== 'listening') break;

      if (!chunk) {
        // No chunk + pending speech → auto-submit
        if (pendingTextRef.current.trim()) {
          const messageToSend = pendingTextRef.current.trim();
          console.log(`[Handsfree] AUTO-SUBMIT (no chunk after speech): "${messageToSend}"`);
          setState('waiting');
          stateRef.current = 'waiting';
          waitingForOrchestratorRef.current = true;
          loopActiveRef.current = false;
          pendingTextRef.current = '';
          await sendMessage(messageToSend);
          break;
        }
        silenceCountRef.current++;
        if (silenceCountRef.current >= SILENCE_COUNT_TO_PAUSE) {
          console.log('[Handsfree] Idle timeout — pausing');
          setState('paused');
          stateRef.current = 'paused';
          await speakCue('Tap Resume when you need me.');
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

      if (!transcript || isHallucination(transcript)) {
        if (transcript) {
          console.log(`[Handsfree] Ignored hallucination: "${transcript}"`);
        }
        // Silence after speech → auto-submit accumulated text
        if (pendingTextRef.current.trim()) {
          const messageToSend = pendingTextRef.current.trim();
          console.log(`[Handsfree] AUTO-SUBMIT (silence after speech): "${messageToSend}"`);
          setState('waiting');
          stateRef.current = 'waiting';
          waitingForOrchestratorRef.current = true;
          loopActiveRef.current = false;
          pendingTextRef.current = '';
          await sendMessage(messageToSend);
          break;
        }
        // No speech yet — just silence, count toward pause
        silenceCountRef.current++;
        if (silenceCountRef.current >= SILENCE_COUNT_TO_PAUSE) {
          console.log('[Handsfree] Idle timeout — pausing');
          setState('paused');
          stateRef.current = 'paused';
          await speakCue('Tap Resume when you need me.');
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
    } catch (loopErr) {
      const msg = loopErr instanceof Error ? loopErr.message : String(loopErr);
      console.error('[Handsfree] Loop crashed:', msg);
      setError(`Hands-free stopped unexpectedly: ${msg}`);
    } finally {
      loopActiveRef.current = false;
      if (stateRef.current === 'listening' || stateRef.current === 'processing') {
        console.log('[Handsfree] Loop ended in active state — resetting to paused');
        setState('paused');
        stateRef.current = 'paused';
      }
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (_) { /* ignore */ }
        recordingRef.current = null;
      }
      console.log('[Handsfree] Recording loop ended');
    }
  }

  // ── Activate hands-free mode (self-healing) ──
  // Always force-cleans any leftover state before starting fresh, so tapping
  // the button always works even if the loop got stuck.
  const activate = useCallback(async () => {
    console.log('[Handsfree] Activate requested — current state:', stateRef.current);

    // Force cleanup of any prior session (stuck loop, leftover recording, etc.)
    loopActiveRef.current = false;
    waitingForOrchestratorRef.current = false;
    pendingTextRef.current = '';
    silenceCountRef.current = 0;

    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (_) { /* already stopped */ }
      recordingRef.current = null;
    }

    setError(null);
    setState('listening');
    stateRef.current = 'listening';

    await speakCue("I'm listening.");

    // Wait for speaker to release audio focus before opening the mic.
    // Without this delay, the first Recording.createAsync after TTS on
    // Android silently fails, leaving hands-free "listening" but capturing
    // nothing. Matches the same delay used by the post-orchestrator resume.
    await new Promise(resolve => setTimeout(resolve, POST_TTS_DELAY_MS));

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
