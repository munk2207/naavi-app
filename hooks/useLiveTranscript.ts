/**
 * useLiveTranscript hook
 *
 * Streams audio to AssemblyAI's real-time WebSocket API and returns live
 * transcript words as the conversation is happening.
 *
 * Flow:
 *   startLive() → fetch token → open WebSocket → capture PCM audio →
 *   receive PartialTranscript / FinalTranscript messages → update UI
 *
 * Runs in parallel with useConversationRecorder (each opens their own mic).
 * The real-time transcript is for display only — the full recording goes
 * through AssemblyAI batch transcription for speaker diarization.
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveSegment {
  text: string;
  isFinal: boolean;
}

export interface UseLiveTranscriptResult {
  isLive: boolean;
  liveWord: string;           // current partial (not yet final) text
  segments: LiveSegment[];    // completed final utterances
  liveError: string | null;
  startLive: () => Promise<void>;
  stopLive: () => void;
  clearSegments: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveTranscript(): UseLiveTranscriptResult {
  const [isLive, setIsLive]       = useState(false);
  const [liveWord, setLiveWord]   = useState('');
  const [segments, setSegments]   = useState<LiveSegment[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);

  const wsRef        = useRef<WebSocket | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);

  // ── Stop ────────────────────────────────────────────────────────────────────

  const stopLive = useCallback(() => {
    // Disconnect audio graph
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    // Stop mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // Close WebSocket
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    setIsLive(false);
    setLiveWord('');
    console.log('[LiveTranscript] Stopped');
  }, []);

  // ── Start ───────────────────────────────────────────────────────────────────

  const startLive = useCallback(async () => {
    // Guard: browser environment with required APIs
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined' ||
      typeof WebSocket === 'undefined'
    ) {
      setLiveError('Live transcript not supported in this environment.');
      return;
    }

    if (!supabase) {
      setLiveError('Not configured');
      return;
    }

    try {
      // Step 1 — get temporary token from Edge Function
      console.log('[LiveTranscript] Fetching token...');
      const { data, error } = await supabase.functions.invoke('get-realtime-token', {});
      if (error || !data?.token) {
        throw new Error(error?.message ?? 'Failed to get real-time token');
      }
      const token: string = data.token;

      // Step 2 — open microphone (separate stream from the recorder)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Step 3 — open AssemblyAI real-time WebSocket
      const ws = new WebSocket(
        `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=${token}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[LiveTranscript] WebSocket open');
        setIsLive(true);
        setLiveError(null);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '{}');

          if (msg.message_type === 'PartialTranscript') {
            setLiveWord(msg.text ?? '');

          } else if (msg.message_type === 'FinalTranscript' && msg.text?.trim()) {
            setSegments(prev => [...prev, { text: msg.text, isFinal: true }]);
            setLiveWord('');

          } else if (msg.message_type === 'SessionBegins') {
            console.log('[LiveTranscript] Session started, ID:', msg.session_id);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        console.error('[LiveTranscript] WebSocket error');
        setLiveError('Real-time connection error');
      };

      ws.onclose = (e) => {
        console.log('[LiveTranscript] WebSocket closed, code:', e.code);
        setIsLive(false);
        setLiveWord('');
      };

      // Step 4 — set up 16kHz audio processing pipeline
      //   AudioContext resamples from the mic's native rate → 16kHz
      //   ScriptProcessorNode converts Float32 → Int16 PCM and sends to WS
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 4096-sample buffer; mono (1 input + 1 output channel)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16   = new Int16Array(float32.length);

        for (let i = 0; i < float32.length; i++) {
          // Clamp to [-1, 1] then scale to Int16 range
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
        }

        ws.send(int16.buffer);
      };

      // Wire up: mic → processor → (silent output)
      source.connect(processor);
      processor.connect(audioCtx.destination);

      console.log('[LiveTranscript] Audio pipeline started');

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start live transcript';
      console.error('[LiveTranscript] Error:', msg);
      setLiveError(msg);
      stopLive();
    }
  }, [stopLive]);

  // ── Clear ────────────────────────────────────────────────────────────────────

  const clearSegments = useCallback(() => {
    setSegments([]);
    setLiveWord('');
  }, []);

  return { isLive, liveWord, segments, liveError, startLive, stopLive, clearSegments };
}
