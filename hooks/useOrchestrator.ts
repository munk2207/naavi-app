/**
 * useOrchestrator hook
 *
 * Manages the full conversation loop:
 * - Sending Robert's message to Naavi
 * - Tracking conversation history
 * - Speaking the response aloud via expo-speech
 * - Returning loading/error state to the UI
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { sendToNaavi, type NaaviMessage, type NaaviResponse, type NaaviAction, type BriefItem } from '@/lib/naavi-client';
import { saveContact, saveReminder } from '@/lib/supabase';
import { extractPersonQuery, getPersonContext, formatPersonContext, savePerson, saveTopic } from '@/lib/memory';
import { searchDriveFiles, formatDriveResults, saveToDrive } from '@/lib/drive';
import { createCalendarEvent } from '@/lib/calendar';

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
  const [createdEvents, setCreatedEvents] = useState<{ summary: string; htmlLink?: string }[]>([]);
  const [savedDocs, setSavedDocs] = useState<{ title: string; webViewLink?: string }[]>([]);
  const [driveFiles, setDriveFiles] = useState<import('@/lib/drive').DriveFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Always-current ref — send() reads this so it never uses a stale brief
  const briefRef = useRef(briefItems);
  useEffect(() => { briefRef.current = briefItems; }, [briefItems]);

  const send = useCallback(async (userMessage: string) => {
    if (status === 'thinking' || status === 'speaking') return;

    setStatus('thinking');
    setError(null);

    try {
      // Check if Robert is asking about a person — inject their full context
      let enrichedMessage = userMessage;
      const personName = extractPersonQuery(userMessage);
      console.log('[Orchestrator] extractPersonQuery result:', personName);
      if (personName) {
        const ctx = await getPersonContext(personName);
        if (ctx) {
          const contextBlock = formatPersonContext(ctx);
          console.log('[Orchestrator] Injecting context for', personName, ':\n', contextBlock);
          enrichedMessage = `${userMessage}\n\n${contextBlock}`;
        } else {
          console.log('[Orchestrator] No context found for', personName);
        }
      }

      const response = await sendToNaavi(enrichedMessage, history, briefRef.current, language);

      console.log('[Orchestrator] actions:', JSON.stringify(response.actions));

      // Update conversation history
      setHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.speech },
      ]);

      setLastResponse(response);

      // Execute SAVE_TO_DRIVE actions
      for (const action of response.actions) {
        if (action.type === 'SAVE_TO_DRIVE') {
          const result = await saveToDrive({
            title:   String(action.title   ?? 'Naavi Note'),
            content: String(action.content ?? ''),
          });
          if (result.success) {
            setSavedDocs(prev => [...prev, { title: String(action.title ?? 'Naavi Note'), webViewLink: result.webViewLink }]);
          } else {
            console.error('[Orchestrator] SAVE_TO_DRIVE failed:', result.error);
          }
        }
      }

      // Execute CREATE_EVENT actions
      for (const action of response.actions) {
        if (action.type === 'CREATE_EVENT') {
          const result = await createCalendarEvent({
            summary:     String(action.summary     ?? ''),
            description: String(action.description ?? ''),
            start:       String(action.start       ?? ''),
            end:         String(action.end         ?? ''),
            attendees:   Array.isArray(action.attendees) ? action.attendees.map(String) : [],
          });
          if (result.success) {
            setCreatedEvents(prev => [...prev, { summary: String(action.summary ?? ''), htmlLink: result.htmlLink }]);
          } else {
            console.error('[Orchestrator] CREATE_EVENT failed:', result.error);
          }
        }
      }

      // Execute DRIVE_SEARCH actions detected by Claude
      for (const action of response.actions) {
        if (action.type === 'DRIVE_SEARCH') {
          const query = String(action.query ?? '').trim();
          console.log('[Orchestrator] Drive query detected:', query);
          if (query) {
            const files = await searchDriveFiles(query);
            if (files.length > 0) setDriveFiles(files);
          }
        }
      }

      // Accumulate draft and contact actions across the session
      const newActions = response.actions.filter(
        a => a.type === 'DRAFT_MESSAGE' || a.type === 'ADD_CONTACT'
      );
      if (newActions.length > 0) {
        setDrafts(prev => [...prev, ...newActions]);
      }

      // Persist actions to Supabase
      for (const action of response.actions) {
        if (action.type === 'ADD_CONTACT') {
          const name = String(action.name ?? '');
          await saveContact({
            name,
            email:        String(action.email        ?? ''),
            phone:        String(action.phone        ?? ''),
            relationship: String(action.relationship ?? ''),
          });
          // Also save to people table for richer memory
          await savePerson({
            name,
            email:        String(action.email        ?? ''),
            phone:        String(action.phone        ?? ''),
            relationship: String(action.relationship ?? ''),
          });
        } else if (action.type === 'SET_REMINDER') {
          await saveReminder({
            title:    String(action.title    ?? ''),
            datetime: String(action.datetime ?? ''),
            source:   String(action.source   ?? ''),
          });
        } else if (action.type === 'LOG_CONCERN') {
          await saveTopic({
            subject:  String(action.category ?? 'general'),
            note:     String(action.note     ?? ''),
            category: String(action.severity ?? 'low'),
          });
        } else if (action.type === 'UPDATE_PROFILE') {
          await saveTopic({
            subject:  String(action.key      ?? 'preference'),
            note:     String(action.value    ?? ''),
            category: 'preference',
          });
        }
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
  }, [status, history, language]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setLastResponse(null);
    setDrafts([]);
    setCreatedEvents([]);
    setSavedDocs([]);
    setDriveFiles([]);
    setError(null);
    setStatus('idle');
  }, []);

  return { status, history, lastResponse, drafts, createdEvents, savedDocs, driveFiles, error, send, clearHistory };
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
