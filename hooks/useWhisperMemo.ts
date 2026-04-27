/**
 * useWhisperMemo hook
 *
 * Records audio and sends it to the transcribe-memo Edge Function (Whisper).
 *
 * - Native (Android / iOS): uses expo-av Audio.Recording
 * - Web: uses MediaRecorder browser API
 *
 * Robert taps the button → speaks → taps stop → Naavi transcribes.
 */

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
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

  // Native ref
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

  const isSupported = isNative || (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setMemoError('Audio recording not supported.');
      setTimeout(() => setMemoError(null), 4000);
      return;
    }

    setMemoError(null);

    if (isNative) {
      // ── Native recording ──────────────────────────────────────────
      (async () => {
        try {
          const { status } = await Audio.requestPermissionsAsync();
          if (status !== 'granted') {
            setMemoError('Microphone permission denied. Allow it in Settings.');
            setTimeout(() => setMemoError(null), 4000);
            return;
          }

          // Force a clean audio session before createAsync. Previous TTS
          // playback can leave audio focus / mode in a state where
          // createAsync rejects with "Could not start recording". Setting
          // recording mode OFF then ON resets the session reliably.
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              playsInSilentModeIOS: true,
            });
          } catch (_) { /* best-effort reset */ }
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          });

          const { recording } = await Audio.Recording.createAsync({
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
              audioQuality: 32,     // LOW
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

  const stopRecording = useCallback((onTranscript: (text: string) => void, language?: string) => {
    if (isNative) {
      // ── Native stop ───────────────────────────────────────────────
      const recording = nativeRecordingRef.current;
      if (!recording) return;

      (async () => {
        try {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          nativeRecordingRef.current = null;

          if (!uri) throw new Error('No recording URI');

          setMemoState('transcribing');

          const raw = await FileSystem.readAsStringAsync(uri, {
            encoding: 'base64' as any,
          });
          const base64 = raw.replace(/\s/g, '');

          if (!supabase) throw new Error('Supabase not configured');

          const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
          const mimeMap: Record<string, string> = { m4a: 'audio/m4a', mp4: 'audio/mp4', '3gp': 'audio/3gp', wav: 'audio/wav' };
          const mimeType = mimeMap[ext] ?? 'audio/m4a';

          const { data, error } = await supabase.functions.invoke('transcribe-memo', {
            body: { audio: base64, mimeType, language },
          });

          if (error || !data?.transcript) {
            const ctxJson  = (error as any)?.context?.json?.error;
            const ctxText  = (error as any)?.context?.text;
            const detail   = (typeof ctxJson === 'string' ? ctxJson : null)
              ?? (typeof ctxText === 'string' ? ctxText : null)
              ?? error?.message
              ?? 'Transcription failed';
            throw new Error(detail);
          }

          setMemoState('idle');
          onTranscript(data.transcript);

        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          console.error('[useWhisperMemo] Native stop error:', msg);
          setMemoError(msg);
          setMemoState('error');
          setTimeout(() => { setMemoState('idle'); setMemoError(null); }, 4000);
        }
      })();

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
