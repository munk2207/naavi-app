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
import { invokeWithTimeout } from '@/lib/invokeWithTimeout';
import { remoteLog, newDiagSession, endDiagSession } from '@/lib/remoteLog';

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

          // Defensive: stop any stale recording resource that may have been
          // left over from a previous session that didn't shut down cleanly.
          // Without this, Audio.Recording.createAsync below can either
          // reject ("Could not start recording") or silently start without
          // capturing audio because the mic is held by the prior recording.
          const stale = nativeRecordingRef.current;
          nativeRecordingRef.current = null;
          if (stale) {
            try { await stale.stopAndUnloadAsync(); } catch (_) { /* may already be stopped */ }
          }

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
        // V57.9.4 — Storage upload path replaces base64-in-body. The
        // legacy path stuffed 50-200 KB of base64 audio into a JSON
        // request body, then waited 30+ seconds for the Supabase API
        // gateway to forward it to transcribe-memo. New path uploads
        // the binary audio directly to a dedicated Storage endpoint
        // (much faster), then calls transcribe-memo with just the
        // storage path (~80 byte body). Same architectural win we
        // shipped for chat-send in V57.9.3.
        const diagSession = newDiagSession();
        remoteLog(diagSession, 'voice-stop-start');
        try {
          await recording.stopAndUnloadAsync();
          remoteLog(diagSession, 'voice-recording-unloaded');
          const uri = recording.getURI();
          nativeRecordingRef.current = null;

          if (!uri) throw new Error('No recording URI');

          setMemoState('transcribing');
          remoteLog(diagSession, 'voice-state-transcribing');

          if (!supabase) throw new Error('Supabase not configured');

          // Need the user_id to namespace the upload path under their folder
          // (storage RLS policy requires path[0] = auth.uid()). If session is
          // missing for some reason we fall back to the legacy base64 path so
          // voice still works.
          const { data: { user } } = await supabase.auth.getUser();
          remoteLog(diagSession, 'voice-user-resolved', { has_user: !!user });

          // File size for diagnostics — small ones don't even need Storage,
          // but we send everything via Storage for consistency now.
          let fileBytes = 0;
          try {
            const info = await FileSystem.getInfoAsync(uri);
            if ((info as any)?.size) fileBytes = Number((info as any).size);
          } catch { /* size lookup is best-effort */ }
          remoteLog(diagSession, 'voice-file-info', { file_bytes: fileBytes });

          const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
          const mimeMap: Record<string, string> = { m4a: 'audio/m4a', mp4: 'audio/mp4', '3gp': 'audio/3gp', wav: 'audio/wav' };
          const mimeType = mimeMap[ext] ?? 'audio/m4a';

          let storagePath: string | null = null;
          let base64ForFallback: string | null = null;

          if (user?.id) {
            // V57.9.4 fast path — read file as base64 then convert to bytes
            // for the storage upload. supabase-js storage.upload() on RN
            // accepts ArrayBuffer / Uint8Array.
            remoteLog(diagSession, 'voice-read-file-start');
            const raw = await FileSystem.readAsStringAsync(uri, {
              encoding: 'base64' as any,
            });
            const base64 = raw.replace(/\s/g, '');
            remoteLog(diagSession, 'voice-read-file-end', { base64_bytes: base64.length });
            base64ForFallback = base64;

            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const candidatePath = `${user.id}/${Date.now()}.${ext}`;
            remoteLog(diagSession, 'voice-storage-upload-start', { path: candidatePath, bytes: bytes.length });
            const { error: upErr } = await supabase.storage
              .from('voice-memos')
              .upload(candidatePath, bytes, { contentType: mimeType, upsert: false });
            if (upErr) {
              console.warn('[useWhisperMemo] storage upload failed, falling back to base64:', upErr.message);
              remoteLog(diagSession, 'voice-storage-upload-error', { error: upErr.message.slice(0, 200) });
              storagePath = null;
            } else {
              storagePath = candidatePath;
              remoteLog(diagSession, 'voice-storage-upload-end');
            }
          }

          // Build the request body — prefer storage_path, fall back to
          // base64 if upload failed or there's no logged-in user.
          const reqBody: Record<string, unknown> = { mimeType, language };
          if (storagePath) {
            reqBody.storage_path = storagePath;
          } else if (base64ForFallback) {
            reqBody.audio = base64ForFallback;
          } else {
            // No user AND we never read the file — read it now for legacy path.
            const raw = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
            reqBody.audio = raw.replace(/\s/g, '');
          }
          remoteLog(diagSession, 'voice-invoke-start', {
            mode: storagePath ? 'storage_path' : 'base64',
            body_audio_bytes: typeof reqBody.audio === 'string' ? reqBody.audio.length : 0,
          });

          // V57.6 — was 30_000 ms, but Whisper API can take 30-60s on
          // longer audio. 60s is comfortable headroom.
          const { data, error } = await invokeWithTimeout('transcribe-memo', {
            body: reqBody,
          }, 60_000);
          remoteLog(diagSession, 'voice-invoke-end', {
            had_error: !!error,
            transcript_bytes: typeof data?.transcript === 'string' ? data.transcript.length : 0,
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
          remoteLog(diagSession, 'voice-done');
          endDiagSession(diagSession);

        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          console.error('[useWhisperMemo] Native stop error:', msg);
          remoteLog(diagSession, 'voice-error', { error: msg.slice(0, 200) });
          endDiagSession(diagSession);
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

          const { data, error } = await invokeWithTimeout('transcribe-memo', {
            body: { audio: base64, mimeType: 'audio/webm', language },
          }, 30_000);

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
