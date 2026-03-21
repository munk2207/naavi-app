/**
 * useWhisperMemo hook
 *
 * Records audio in the browser using MediaRecorder,
 * sends it to the transcribe-memo Edge Function (Whisper),
 * and returns the transcript via a callback.
 *
 * Robert holds the button → speaks → releases → Naavi transcribes.
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type MemoState = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UseWhisperMemoResult {
  memoState: MemoState;
  memoError: string | null;
  isSupported: boolean;
  startRecording: () => void;
  stopRecording: (onTranscript: (text: string) => void, language?: string) => void;
}

export function useWhisperMemo(): UseWhisperMemoResult {
  const [memoState, setMemoState] = useState<MemoState>('idle');
  const [memoError, setMemoError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setMemoError('Audio recording not supported in this browser.');
      setTimeout(() => setMemoError(null), 4000);
      return;
    }

    setMemoError(null);
    chunksRef.current = [];

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(250); // collect chunks every 250ms
      mediaRecorderRef.current = recorder;
      setMemoState('recording');
    }).catch((err) => {
      console.error('[useWhisperMemo] Mic error:', err);
      setMemoError('Microphone blocked. Allow it in your browser settings.');
      setMemoState('error');
      setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
    });
  }, [isSupported]);

  const stopRecording = useCallback((onTranscript: (text: string) => void, language?: string) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = async () => {
      // Stop all mic tracks
      recorder.stream.getTracks().forEach(t => t.stop());

      setMemoState('transcribing');

      try {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        console.log('[WhisperMemo] Audio blob size:', audioBlob.size, 'bytes, chunks:', chunksRef.current.length);

        if (audioBlob.size < 1000) {
          throw new Error('Recording too short — please speak for at least 1 second.');
        }

        // Convert to base64
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
  }, []);

  return { memoState, memoError, isSupported, startRecording, stopRecording };
}
