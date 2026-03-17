/**
 * useVoice hook
 *
 * Handles microphone input using the Web Speech API (browser).
 *
 * On desktop Chrome/Edge: full support.
 * On mobile Chrome (Android): full support.
 * On iOS Safari: supported but getUserMedia must NOT be called first —
 *   calling it before recognition.start() causes both to fail silently.
 * On Firefox mobile / unsupported browsers: isSupported = false, button
 *   shows an "not available" message instead.
 */

import { useState, useCallback, useRef } from 'react';
import { Platform } from 'react-native';

export type VoiceState = 'idle' | 'listening' | 'error';

export interface UseVoiceResult {
  voiceState: VoiceState;
  voiceError: string | null;
  startListening: (onResult: (transcript: string) => void) => void;
  stopListening: () => void;
  isSupported: boolean;
}

// Detect iOS — Safari on iPhone/iPad requires special handling
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function useVoice(language: 'en' | 'fr' = 'en'): UseVoiceResult {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const isSupported =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = useCallback(
    (onResult: (transcript: string) => void) => {
      if (!isSupported) {
        setVoiceError('Voice not supported in this browser. Try Chrome.');
        setTimeout(() => setVoiceError(null), 4000);
        return;
      }

      setVoiceError(null);

      // Stop any existing session
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const SpeechRecognitionClass =
        (window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition })
          .webkitSpeechRecognition ?? window.SpeechRecognition;

      const recognition = new SpeechRecognitionClass();

      recognition.lang = language === 'fr' ? 'fr-CA' : 'en-CA';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setVoiceState('listening');
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript.trim();
        if (transcript) {
          onResult(transcript);
        }
        setVoiceState('idle');
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('[useVoice] error:', event.error);
        if (event.error === 'not-allowed') {
          setVoiceError('Microphone blocked. Allow it in your browser settings.');
        } else if (event.error === 'no-speech') {
          setVoiceError('No speech detected — try again.');
        } else {
          setVoiceError('Voice error: ' + event.error);
        }
        setVoiceState('error');
        setTimeout(() => { setVoiceState('idle'); setVoiceError(null); }, 3000);
      };

      recognition.onend = () => {
        setVoiceState('idle');
      };

      recognitionRef.current = recognition;

      // iOS Safari: calling getUserMedia before recognition.start() makes
      // both fail — the mic is grabbed twice and iOS blocks one of them.
      // On iOS we go straight to recognition.start() which triggers the
      // permission prompt itself.
      // On all other browsers we request mic permission first so the
      // prompt appears before the recognition session opens.
      if (isIOS()) {
        try {
          recognition.start();
        } catch (err) {
          console.error('[useVoice] iOS start error:', err);
          setVoiceError('Could not start microphone. Try again.');
          setVoiceState('error');
          setTimeout(() => { setVoiceState('idle'); setVoiceError(null); }, 3000);
        }
      } else {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(() => recognition.start())
          .catch((err) => {
            console.error('[useVoice] mic permission denied:', err);
            setVoiceError('Microphone blocked. Allow it in your browser settings.');
            setVoiceState('error');
            setTimeout(() => { setVoiceState('idle'); setVoiceError(null); }, 3000);
          });
      }
    },
    [isSupported, language]
  );

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setVoiceState('idle');
  }, []);

  return { voiceState, voiceError, startListening, stopListening, isSupported };
}
