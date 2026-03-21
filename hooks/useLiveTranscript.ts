/**
 * useLiveTranscript hook
 *
 * Uses the browser's built-in Web Speech API (SpeechRecognition) to display
 * words on screen in real-time while the conversation recorder is running.
 *
 * No API keys or WebSocket setup needed — Chrome sends audio to Google's
 * speech engine and returns live interim + final transcripts.
 *
 * Supported: Chrome, Edge  |  Not supported: Firefox, Safari
 */

import { useState, useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveSegment {
  text: string;
  isFinal: boolean;
}

export interface UseLiveTranscriptResult {
  isLive: boolean;
  liveWord: string;           // current interim (not yet final) text
  segments: LiveSegment[];    // completed final utterances
  liveError: string | null;
  startLive: () => void;
  stopLive: () => void;
  clearSegments: () => void;
}

// ─── Extend Window with vendor-prefixed SpeechRecognition ─────────────────────

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveTranscript(): UseLiveTranscriptResult {
  const [isLive, setIsLive]       = useState(false);
  const [liveWord, setLiveWord]   = useState('');
  const [segments, setSegments]   = useState<LiveSegment[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Stop ────────────────────────────────────────────────────────────────────

  const stopLive = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsLive(false);
    setLiveWord('');
    console.log('[LiveTranscript] Stopped');
  }, []);

  // ── Start ───────────────────────────────────────────────────────────────────

  const startLive = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setLiveError('Live transcript requires Chrome or Edge');
      return;
    }

    // Stop any existing session first
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const recognition = new SR();
    recognition.continuous     = true;   // keep listening until stopLive()
    recognition.interimResults = true;   // show partial words
    recognition.lang           = 'en-US';
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      console.log('[LiveTranscript] Started');
      setIsLive(true);
      setLiveError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            setSegments(prev => [...prev, { text, isFinal: true }]);
          }
        } else {
          interimText += result[0].transcript;
        }
      }

      setLiveWord(interimText);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[LiveTranscript] Error:', event.error);
      if (event.error === 'not-allowed') {
        setLiveError('Microphone access denied');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setLiveError(`Recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      console.log('[LiveTranscript] onend — isLive:', isLive);
      setIsLive(false);
      setLiveWord('');
      // Auto-restart if we didn't intentionally stop (handles Chrome's ~60s timeout)
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setIsLive(true);
        } catch {
          // ignore restart errors
        }
      }
    };

    try {
      recognition.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start recognition';
      console.error('[LiveTranscript] Start error:', msg);
      setLiveError(msg);
    }
  }, []);

  // ── Clear ────────────────────────────────────────────────────────────────────

  const clearSegments = useCallback(() => {
    setSegments([]);
    setLiveWord('');
  }, []);

  return { isLive, liveWord, segments, liveError, startLive, stopLive, clearSegments };
}
