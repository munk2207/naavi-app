/**
 * useWhisperMemo hook — tap-to-talk voice input
 *
 * - Native (Android / iOS): uses @jamsch/expo-speech-recognition (on-device STT)
 * - Web: uses MediaRecorder + Whisper Edge Function (fallback)
 *
 * Robert taps the button → speaks → taps stop → Naavi transcribes.
 *
 * Hook signature is unchanged — callers don't need to change.
 */

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from '@jamsch/expo-speech-recognition';
import { supabase } from '@/lib/supabase';

export type MemoState = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UseWhisperMemoResult {
  memoState: MemoState;
  memoError: string | null;
  isSupported: boolean;
  startRecording: () => void;
  stopRecording: (onTranscript: (text: string) => void, language?: string) => void;
}

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

export function useWhisperMemo(): UseWhisperMemoResult {
  const [memoState, setMemoState] = useState<MemoState>('idle');
  const [memoError, setMemoError] = useState<string | null>(null);

  // Web refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Native: callback ref — set when stopRecording is called, fired by result event
  const onTranscriptRef = useRef<((text: string) => void) | null>(null);

  const isSupported = isNative || (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );

  // ── Native: expo-speech-recognition event handlers ────────────────────

  // Final result — deliver transcript via callback
  useSpeechRecognitionEvent('result', (event) => {
    // Only handle if we're in tap-to-talk mode (recording/transcribing)
    if (!onTranscriptRef.current) return;

    const result = event.results[event.results.length - 1];
    if (!result?.isFinal) return;

    const transcript = result.transcript;
    const cb = onTranscriptRef.current;
    onTranscriptRef.current = null;

    if (transcript && transcript.trim()) {
      setMemoState('idle');
      cb(transcript);
    } else {
      setMemoError('No speech detected — try again.');
      setMemoState('error');
      setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
    }
  });

  // Recognition ended without a result (e.g. no speech)
  useSpeechRecognitionEvent('end', () => {
    if (!onTranscriptRef.current) return;
    // If we still have a pending callback, recognition ended without a final result
    onTranscriptRef.current = null;
    setMemoError('No speech detected — try again.');
    setMemoState('error');
    setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
  });

  // Error during recognition
  useSpeechRecognitionEvent('error', (event) => {
    if (!onTranscriptRef.current) return;
    console.error('[useWhisperMemo] Recognition error:', event.error, event.message);
    onTranscriptRef.current = null;
    setMemoError(event.message || 'Speech recognition failed.');
    setMemoState('error');
    setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
  });

  // ── Start recording ───────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setMemoError('Audio recording not supported.');
      setTimeout(() => setMemoError(null), 4000);
      return;
    }

    setMemoError(null);

    if (isNative) {
      // ── Native: start speech recognition ─────────────────────────
      (async () => {
        try {
          const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (status !== 'granted') {
            setMemoError('Microphone permission denied. Allow it in Settings.');
            setTimeout(() => setMemoError(null), 4000);
            return;
          }

          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: false,
          });
          setMemoState('recording');
        } catch (err) {
          console.error('[useWhisperMemo] Native start error:', err);
          setMemoError('Could not start recording.');
          setMemoState('error');
          setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
        }
      })();
    } else {
      // ── Web recording ─────────────────────────────────────────────
      chunksRef.current = [];
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
        setMemoState('recording');
      }).catch((err) => {
        console.error('[useWhisperMemo] Mic error:', err);
        setMemoError('Microphone blocked. Allow it in your browser settings.');
        setMemoState('error');
        setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
      });
    }
  }, [isSupported]);

  // ── Stop recording ────────────────────────────────────────────────────

  const stopRecording = useCallback((onTranscript: (text: string) => void, language?: string) => {
    if (isNative) {
      // ── Native: stop recognition → triggers final result event ───
      onTranscriptRef.current = onTranscript;
      setMemoState('transcribing');
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (err) {
        console.error('[useWhisperMemo] Native stop error:', err);
        onTranscriptRef.current = null;
        setMemoError('Could not stop recording.');
        setMemoState('error');
        setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
      }

    } else {
      // ── Web stop ──────────────────────────────────────────────────
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;

      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach(t => t.stop());
        setMemoState('transcribing');

        try {
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          console.log('[WhisperMemo] Audio blob size:', audioBlob.size, 'bytes');

          if (audioBlob.size < 1000) {
            throw new Error('Recording too short — please speak for at least 1 second.');
          }

          const arrayBuffer = await audioBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (const b of bytes) binary += String.fromCharCode(b);
          const base64 = btoa(binary);

          if (!supabase) throw new Error('Supabase not configured');

          const { data, error } = await supabase.functions.invoke('transcribe-memo', {
            body: { audio: base64, mimeType: 'audio/webm', language },
          });

          if (error || !data?.transcript) {
            throw new Error(error?.message ?? 'Transcription failed');
          }

          setMemoState('idle');
          onTranscript(data.transcript);

        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          console.error('[useWhisperMemo]', msg);
          setMemoError(msg);
          setMemoState('error');
          setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
        }
      };

      recorder.stop();
    }
  }, []);

  return { memoState, memoError, isSupported, startRecording, stopRecording };
}
