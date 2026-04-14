/**
 * useHandsfreeMode hook
 *
 * Hands-free voice mode using Deepgram streaming transcription.
 * Streams raw PCM audio over WebSocket to Deepgram Nova-3,
 * which handles endpointing (detects when the user stops talking)
 * and returns full-sentence transcripts.
 *
 * Keywords:
 *   "Hi Naavi"  → wake / start fresh listening
 *   "Thanks"    → submit accumulated speech to orchestrator
 *   "Goodbye"   → exit hands-free mode
 *
 * Auto-submit: When Deepgram fires UtteranceEnd (user stopped talking),
 * accumulated text is submitted automatically — no keyword needed.
 *
 * Voice-Confirm (Phase A): After a confirmable action (DRAFT_MESSAGE),
 * enters 'confirming' state — mic stays open, Robert says yes/no/edit.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { ExpoPlayAudioStream } from '@mykin-ai/expo-audio-stream';
import { supabase } from '@/lib/supabase';
import { loadKeyterms } from '@/lib/loadKeyterms';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';
import { isPendingConfirmActive } from '@/hooks/useOrchestrator';
import { classifyConfirmation, CONFIRM_TIMEOUT_MS } from '@/lib/voice-confirm';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConfirmResponse = 'confirm' | 'cancel' | 'timeout' | 'edit';

export type HandsfreeState =
  | 'inactive'
  | 'listening'
  | 'processing'
  | 'waiting'
  | 'paused'
  | 'confirming';

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  debugLog: string[];
  activate: () => void;
  deactivate: () => void;
}

// ─── Configurable Keyword Table ─────────────────────────────────────────────

export const KEYWORDS = {
  SUBMIT: ['thank you', 'thank you naavi', 'thanks', 'thanks naavi', 'over'],
  EXIT: ['goodbye', 'goodbye naavi', 'stop listening', "that's all", 'thats all', 'end', 'end listening'],
  WAKE: ['hi naavi', 'hey naavi', 'hello naavi', 'naavi'],
};

// ─── Constants ──────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 60000;         // 60s no speech → pause
const POST_TTS_DELAY_MS = 1500;        // wait after TTS before reopening mic
const KEEPALIVE_INTERVAL_MS = 4000;    // send keepalive every 4s during TTS
const MAX_RECONNECT_ATTEMPTS = 3;

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

// ─── Deepgram URL builder ───────────────────────────────────────────────────

function buildDeepgramUrl(keyterms: string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    utterance_end_ms: '1000',
    endpointing: '300',
    vad_events: 'true',
    smart_format: 'true',
  });

  // Append keyterms (Deepgram expects repeated keyterm= params)
  for (const term of keyterms) {
    params.append('keyterm', term);
  }

  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useHandsfreeMode(
  orchestratorStatus: OrchestratorStatus,
  sendMessage: (text: string) => Promise<void>,
  speakCue: (text: string) => Promise<void>,
  onConfirmResponse?: (response: ConfirmResponse, editText?: string) => void,
): UseHandsfreeModeResult {
  const [state, setState] = useState<HandsfreeState>('inactive');
  const [error, setError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const audioChunkCountRef = useRef(0);

  function dbg(msg: string) {
    console.log(`[Handsfree] ${msg}`);
    setDebugLog(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()} ${msg}`]);
  }

  const stateRef = useRef<HandsfreeState>('inactive');
  const pendingTextRef = useRef('');
  const wsRef = useRef<WebSocket | null>(null);
  const audioStreamActiveRef = useRef(false);
  const audioSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopActiveRef = useRef(false);
  const waitingForOrchestratorRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmHandledRef = useRef(false);  // guard: only process one confirmation
  const pendingConfirmTransitionRef = useRef(false);  // true during the delay before entering confirming

  // Keep stateRef in sync
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Idle timer management ──
  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(async () => {
      if (stateRef.current === 'listening' && loopActiveRef.current) {
        console.log('[Handsfree] Idle timeout — pausing');
        await stopStreaming();
        setState('paused');
        stateRef.current = 'paused';
        await speakCue('Tap Resume when you need me.');
      }
    }, IDLE_TIMEOUT_MS);
  }

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  // ── Keep-alive management (during TTS / waiting) ──
  function startKeepAlive() {
    stopKeepAlive();
    keepAliveIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  function stopKeepAlive() {
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
  }

  // ── Confirm timeout management ──
  function startConfirmTimeout() {
    clearConfirmTimeout();
    confirmTimeoutRef.current = setTimeout(() => {
      if (stateRef.current === 'confirming') {
        console.log('[Handsfree] Confirm timeout — auto-cancelling');
        exitConfirmState('timeout');
      }
    }, CONFIRM_TIMEOUT_MS);
  }

  function clearConfirmTimeout() {
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  }

  // ── Get Deepgram temporary token ──
  async function getDeepgramToken(): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error: fnError } = await supabase.functions.invoke('deepgram-token');
    if (fnError || !data?.token) {
      throw new Error(`Failed to get Deepgram token: ${fnError?.message ?? 'no token'}`);
    }
    return data.token;
  }

  // ── Stop audio streaming ──
  async function stopAudioStream() {
    if (audioSubscriptionRef.current) {
      try { audioSubscriptionRef.current.remove(); } catch (_) { /* ignore */ }
      audioSubscriptionRef.current = null;
    }
    if (audioStreamActiveRef.current) {
      try {
        await ExpoPlayAudioStream.stopRecording();
      } catch (_) { /* already stopped */ }
      audioStreamActiveRef.current = false;
    }
  }

  // ── Start audio streaming to WebSocket ──
  async function startAudioStream() {
    await stopAudioStream();

    // Request mic permission
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      setError('Microphone permission denied.');
      return;
    }

    // Set audio mode for recording
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });

    // Start streaming PCM audio
    dbg('Starting ExpoPlayAudioStream.startRecording...');
    audioChunkCountRef.current = 0;

    const { recordingResult, subscription } = await ExpoPlayAudioStream.startRecording({
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_16bit',
      interval: 250, // deliver chunks every 250ms
      onAudioStream: (event: { data: string; position: number; eventDataSize: number; totalSize: number; soundLevel?: number; fileUri: string }) => {
        audioChunkCountRef.current++;
        // Log first few chunks and then every 20th
        if (audioChunkCountRef.current <= 3 || audioChunkCountRef.current % 20 === 0) {
          dbg(`Audio chunk #${audioChunkCountRef.current}: ${event.data?.length ?? 0} chars, ws=${wsRef.current?.readyState}`);
        }
        // event.data is base64-encoded PCM
        if (wsRef.current?.readyState === WebSocket.OPEN && event.data) {
          try {
            // Decode base64 to binary and send
            const binaryStr = atob(event.data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            wsRef.current.send(bytes.buffer);
          } catch (sendErr) {
            dbg(`Send failed: ${sendErr}`);
          }
        }
      },
    });

    audioSubscriptionRef.current = subscription ?? null;
    audioStreamActiveRef.current = true;
    dbg(`Audio stream started. result: ${JSON.stringify(recordingResult)}`);
  }

  // ── Exit confirm state and fire callback ──
  async function exitConfirmState(response: ConfirmResponse, editText?: string) {
    clearConfirmTimeout();
    // Stop mic immediately so it doesn't pick up the TTS response ("Sent.", "Cancelled.", etc.)
    await stopAudioStream();
    startKeepAlive();
    waitingForOrchestratorRef.current = true;
    setState('waiting');
    stateRef.current = 'waiting';
    onConfirmResponse?.(response, editText);
  }

  // ── Process finalized transcript ──
  function processTranscript(transcript: string) {
    if (!transcript.trim()) return;

    // If we're transitioning to confirm state, ignore any leftover transcripts
    if (pendingConfirmTransitionRef.current) {
      console.log(`[Handsfree] Ignoring transcript during confirm transition: "${transcript}"`);
      return;
    }

    console.log(`[Handsfree] Final transcript: "${transcript}"`);
    resetIdleTimer();

    // ── If confirming (module-level switch OR React state), classify the response ──
    if (stateRef.current === 'confirming' || isPendingConfirmActive()) {
      // Guard: only process one confirmation to prevent looping
      if (confirmHandledRef.current) {
        console.log('[Handsfree] Confirm already handled — ignoring transcript');
        return;
      }
      confirmHandledRef.current = true;

      console.log(`[Handsfree] Confirm transcript: "${transcript}"`);
      const classification = classifyConfirmation(transcript);
      console.log(`[Handsfree] Classification: ${classification}`);

      if (classification === 'confirm') {
        exitConfirmState('confirm');
      } else if (classification === 'cancel') {
        exitConfirmState('cancel');
      } else {
        exitConfirmState('edit', transcript);
      }
      return;
    }

    // EXIT: goodbye
    if (matchKeyword(transcript, KEYWORDS.EXIT)) {
      console.log('[Handsfree] EXIT keyword detected');
      loopActiveRef.current = false;
      stopStreaming().then(() => {
        setState('inactive');
        stateRef.current = 'inactive';
        speakCue('Goodbye Robert. Talk to you soon.');
      });
      return;
    }

    // SUBMIT: thanks / over
    if (matchKeyword(transcript, KEYWORDS.SUBMIT)) {
      const cleaned = stripKeywords(transcript);
      if (cleaned) pendingTextRef.current += (pendingTextRef.current ? ' ' : '') + cleaned;

      const messageToSend = pendingTextRef.current.trim();
      if (messageToSend) {
        console.log(`[Handsfree] SUBMIT: "${messageToSend}"`);
        submitMessage(messageToSend);
      }
      return;
    }

    // WAKE: hi naavi — reset and start fresh
    if (matchKeyword(transcript, KEYWORDS.WAKE)) {
      console.log('[Handsfree] WAKE keyword — starting fresh');
      pendingTextRef.current = '';
      const cleaned = stripKeywords(transcript);
      if (cleaned) pendingTextRef.current = cleaned;
      return;
    }

    // Regular speech — accumulate
    pendingTextRef.current += (pendingTextRef.current ? ' ' : '') + transcript;
    console.log(`[Handsfree] Accumulated: "${pendingTextRef.current}"`);
  }

  // ── Handle UtteranceEnd — auto-submit or timeout confirm ──
  function handleUtteranceEnd() {
    // During confirm transition, ignore
    if (pendingConfirmTransitionRef.current) return;
    // In confirming state (React or module-level switch), UtteranceEnd is handled by processTranscript
    if (stateRef.current === 'confirming' || isPendingConfirmActive()) return;

    // Normal mode — auto-submit accumulated text
    const messageToSend = pendingTextRef.current.trim();
    if (messageToSend) {
      console.log(`[Handsfree] UtteranceEnd — auto-submit: "${messageToSend}"`);
      submitMessage(messageToSend);
    }
  }

  // ── Submit accumulated message to orchestrator ──
  async function submitMessage(text: string) {
    console.log(`[Handsfree] Submitting: "${text}"`);

    // Pause audio but keep WebSocket alive
    await stopAudioStream();
    startKeepAlive();
    clearIdleTimer();

    setState('waiting');
    stateRef.current = 'waiting';
    waitingForOrchestratorRef.current = true;
    pendingTextRef.current = '';

    await sendMessage(text);
  }

  // ── Start Deepgram WebSocket streaming ──
  async function startStreaming() {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;

    try {
      setState('listening');
      stateRef.current = 'listening';

      // Load keyterms (contact names) and get auth token
      const [keyterms, token] = await Promise.all([
        loadKeyterms(),
        getDeepgramToken(),
      ]);

      if (!loopActiveRef.current) return; // deactivated during token fetch

      const url = buildDeepgramUrl(keyterms);
      dbg(`Connecting to Deepgram (${keyterms.length} keyterms), key len=${token.length}...`);

      // Sec-WebSocket-Protocol with raw API key (not temp token) — per Deepgram docs
      const ws = new WebSocket(url, ['token', token]);
      wsRef.current = ws;

      ws.onopen = async () => {
        dbg('Deepgram WS connected');
        reconnectAttemptsRef.current = 0;
        setError(null);

        // Start streaming audio
        await startAudioStream();
        resetIdleTimer();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.type === 'Results') {
            const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
            const isFinal = msg.is_final === true;

            if (transcript) {
              resetIdleTimer(); // Any speech resets idle timer
            }

            if (isFinal && transcript) {
              processTranscript(transcript);
            }
          }

          if (msg.type === 'UtteranceEnd') {
            handleUtteranceEnd();
          }

        } catch (parseErr) {
          console.error('[Handsfree] Failed to parse Deepgram message:', parseErr);
        }
      };

      ws.onerror = (event) => {
        console.error('[Handsfree] WebSocket error:', event);
      };

      ws.onclose = (event) => {
        dbg(`WS closed: code=${event.code} reason="${event.reason}" chunks=${audioChunkCountRef.current}`);
        wsRef.current = null;

        // If still supposed to be active, try to reconnect
        if (loopActiveRef.current && (stateRef.current === 'listening' || stateRef.current === 'confirming')) {
          handleReconnect();
        }
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Handsfree] startStreaming error:', msg);
      setError(`Hands-free failed: ${msg}`);
      loopActiveRef.current = false;
      setState('paused');
      stateRef.current = 'paused';
    }
  }

  // ── Reconnection with exponential backoff ──
  async function handleReconnect() {
    reconnectAttemptsRef.current++;

    if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
      console.log('[Handsfree] Max reconnect attempts reached — pausing');
      reconnectAttemptsRef.current = 0;
      loopActiveRef.current = false;
      setError('Connection lost. Tap Resume to try again.');
      setState('paused');
      stateRef.current = 'paused';
      await speakCue('I lost the connection. Tap Resume when ready.');
      return;
    }

    const delay = 1000 * Math.pow(2, reconnectAttemptsRef.current); // 2s, 4s, 8s
    console.log(`[Handsfree] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    if (loopActiveRef.current && (stateRef.current === 'listening' || stateRef.current === 'confirming')) {
      loopActiveRef.current = false; // Reset so startStreaming can set it
      await startStreaming();
    }
  }

  // ── Stop everything ──
  async function stopStreaming() {
    loopActiveRef.current = false;
    clearIdleTimer();
    clearConfirmTimeout();
    stopKeepAlive();

    await stopAudioStream();

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        wsRef.current.close();
      } catch (_) { /* ignore */ }
      wsRef.current = null;
    }
  }

  // ── Watch orchestrator status: when it goes idle after 'waiting', resume listening ──
  useEffect(() => {
    if (!waitingForOrchestratorRef.current) return;
    if (orchestratorStatus === 'idle' && (stateRef.current === 'waiting' || stateRef.current === 'confirming')) {
      waitingForOrchestratorRef.current = false;
      stopKeepAlive();
      clearConfirmTimeout();

      // Delay before reopening mic (prevents picking up TTS audio)
      setTimeout(async () => {
        if (stateRef.current === 'waiting' || stateRef.current === 'paused' || stateRef.current === 'confirming') {
          console.log('[Handsfree] Orchestrator done, resuming listening');
          pendingTextRef.current = '';

          setState('listening');
          stateRef.current = 'listening';

          // If WebSocket is still open, just restart audio
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            await startAudioStream();
            resetIdleTimer();
          } else {
            // WebSocket was closed during TTS — reconnect
            loopActiveRef.current = false;
            await startStreaming();
          }
        }
      }, POST_TTS_DELAY_MS);
    }
  }, [orchestratorStatus]);

  // ── Watch for pending_confirm: enter confirming state after TTS finishes ──
  useEffect(() => {
    if (orchestratorStatus !== 'pending_confirm') return;
    if (stateRef.current === 'inactive') return;
    if (stateRef.current === 'confirming') return; // already confirming

    console.log('[Handsfree] Orchestrator needs confirmation — stopping mic until TTS finishes');
    pendingConfirmTransitionRef.current = true;
    // Stop mic immediately so it doesn't pick up Naavi's own confirmation prompt
    stopAudioStream();
    startKeepAlive();

    // Wait longer for TTS to fully finish before reopening mic (confirmation prompts are longer)
    setTimeout(async () => {
      if (stateRef.current === 'inactive') return;
      stopKeepAlive();
      pendingConfirmTransitionRef.current = false;
      confirmHandledRef.current = false;  // reset guard for new confirmation
      setState('confirming');
      stateRef.current = 'confirming';
      startConfirmTimeout();

      // Restart audio stream for confirmation listening
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        await startAudioStream();
      } else {
        // Need to reconnect
        loopActiveRef.current = false;
        await startStreaming();
      }
    }, POST_TTS_DELAY_MS * 3);
  }, [orchestratorStatus]);

  // ── Activate hands-free mode (self-healing) ──
  const activate = useCallback(async () => {
    console.log('[Handsfree] Activate requested — current state:', stateRef.current);

    // Force cleanup of any prior session
    await stopStreaming();
    waitingForOrchestratorRef.current = false;
    pendingConfirmTransitionRef.current = false;
    confirmHandledRef.current = false;
    pendingTextRef.current = '';
    reconnectAttemptsRef.current = 0;

    setError(null);
    setState('listening');
    stateRef.current = 'listening';

    await speakCue("I'm listening.");

    // Wait for speaker to release audio focus before opening the mic
    await new Promise(resolve => setTimeout(resolve, POST_TTS_DELAY_MS));

    await startStreaming();
  }, []);

  // ── Deactivate hands-free mode ──
  const deactivate = useCallback(async () => {
    console.log('[Handsfree] Deactivating');
    await stopStreaming();
    waitingForOrchestratorRef.current = false;
    pendingTextRef.current = '';

    setError(null);
    setState('inactive');
    stateRef.current = 'inactive';
  }, []);

  return { state, error, debugLog, activate, deactivate };
}
