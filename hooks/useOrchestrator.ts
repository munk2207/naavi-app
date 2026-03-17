/**
 * useOrchestrator hook
 *
 * Manages the full conversation loop:
 * - Sending Robert's message to Naavi
 * - Tracking conversation history
 * - Speaking the response aloud via expo-speech
 * - Returning loading/error state to the UI
 */

import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { sendToNaavi, type NaaviMessage, type NaaviResponse, type NaaviAction, type BriefItem } from '@/lib/naavi-client';

export type OrchestratorStatus = 'idle' | 'thinking' | 'speaking' | 'error';

export interface OrchestratorState {
  status: OrchestratorStatus;
  history: NaaviMessage[];
  lastResponse: NaaviResponse | null;
  error: string | null;
}

export function useOrchestrator(language: 'en' | 'fr' = 'en', briefItems: BriefItem[] = []) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [history, setHistory] = useState<NaaviMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<NaaviResponse | null>(null);
  const [drafts, setDrafts] = useState<NaaviAction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (userMessage: string) => {
    if (status === 'thinking' || status === 'speaking') return;

    setStatus('thinking');
    setError(null);

    try {
      const response = await sendToNaavi(userMessage, history, briefItems, language);

      console.log('[Orchestrator] actions:', JSON.stringify(response.actions));

      // Update conversation history
      setHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.speech },
      ]);

      setLastResponse(response);

      // Accumulate draft and contact actions across the session
      const newActions = response.actions.filter(
        a => a.type === 'DRAFT_MESSAGE' || a.type === 'ADD_CONTACT'
      );
      if (newActions.length > 0) {
        setDrafts(prev => [...prev, ...newActions]);
      }

      // Speak the response aloud
      setStatus('speaking');
      await speakResponse(response.speech, language);

      setStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStatus('error');
    }
  }, [status, history, language, briefItems]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setLastResponse(null);
    setDrafts([]);
    setError(null);
    setStatus('idle');
  }, []);

  return { status, history, lastResponse, drafts, error, send, clearHistory };
}

// ─── Speech helper ────────────────────────────────────────────────────────────

async function speakResponse(text: string, language: 'en' | 'fr'): Promise<void> {
  // On web — use the Web Speech API directly to access higher quality voices
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    return speakWeb(text, language);
  }

  // On mobile — use expo-speech
  await Speech.stop();
  return new Promise((resolve) => {
    Speech.speak(text, {
      language: language === 'fr' ? 'fr-CA' : 'en-CA',
      rate: 0.85,
      pitch: 1.0,
      onDone: resolve,
      onError: () => resolve(),
    });
  });
}

function speakWeb(text: string, language: 'en' | 'fr'): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    // Pick the best available voice — prefer natural/neural voices
    const voices = window.speechSynthesis.getVoices();
    const langCode = language === 'fr' ? 'fr' : 'en';

    const preferred = [
      // Microsoft natural voices (Edge)
      'Microsoft Aria Online (Natural)',
      'Microsoft Jenny Online (Natural)',
      'Microsoft Natasha Online (Natural)',
      // Google voices (Chrome)
      'Google UK English Female',
      'Google US English',
      'Google français',
    ];

    let selectedVoice: SpeechSynthesisVoice | null = null;

    // Try preferred voices first
    for (const name of preferred) {
      const match = voices.find(v => v.name === name);
      if (match) { selectedVoice = match; break; }
    }

    // Fall back to any voice matching the language
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.startsWith(langCode)) ?? null;
    }

    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = language === 'fr' ? 'fr-CA' : 'en-CA';

    window.speechSynthesis.speak(utterance);
  });
}
