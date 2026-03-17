/**
 * useVoice hook
 *
 * Handles microphone input using the Web Speech API (browser)
 * and expo-av (mobile — Phase 7.5).
 *
 * On web: uses the browser's built-in speech recognition (Chrome/Edge).
 * On mobile: returns a stub — voice recording via expo-av comes in Phase 7.5.
 */

import { useState, useCallback, useRef } from 'react';
import { Platform } from 'react-native';

export type VoiceState = 'idle' | 'listening' | 'error';

export interface UseVoiceResult {
  voiceState: VoiceState;
  startListening: (onResult: (transcript: string) => void) => void;
  stopListening: () => void;
  isSupported: boolean;
}

export function useVoice(language: 'en' | 'fr' = 'en'): UseVoiceResult {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Web Speech API is only available in browsers
  const isSupported =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = useCallback(
    (onResult: (transcript: string) => void) => {
      if (!isSupported) {
        console.warn('[useVoice] Speech recognition not supported on this platform.');
        return;
      }

      // Stop any existing session
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const SpeechRecognitionClass =
        (window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition })
          .webkitSpeechRecognition ?? window.SpeechRecognition;

      const recognition = new SpeechRecognitionClass();

      recognition.lang = language === 'fr' ? 'fr-CA' : 'en-CA';
      recognition.continuous = false;       // Stop after first pause
      recognition.interimResults = false;   // Only final results
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
        console.error('[useVoice] Speech recognition error:', event.error);
        setVoiceState('error');
        setTimeout(() => setVoiceState('idle'), 2000);
      };

      recognition.onend = () => {
        setVoiceState('idle');
      };

      recognitionRef.current = recognition;
      recognition.start();
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

  return { voiceState, startListening, stopListening, isSupported };
}
