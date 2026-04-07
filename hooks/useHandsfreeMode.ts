/**
 * useHandsfreeMode hook — DISABLED
 *
 * Native speech recognition libraries could not auto-link on
 * Expo SDK 55 / RN 0.83 (Samsung S23 Ultra). Hook returns inactive
 * state and does nothing. Kept as a placeholder for future implementation
 * using auto-recording turn-taking with Whisper.
 *
 * Keywords and types are preserved for when hands-free is rebuilt.
 */

import { useState, useCallback } from 'react';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandsfreeState =
  | 'inactive'
  | 'listening'
  | 'processing'
  | 'waiting'
  | 'paused';

export interface UseHandsfreeModeResult {
  state: HandsfreeState;
  error: string | null;
  activate: () => void;
  deactivate: () => void;
}

// ─── Configurable Keyword Table (preserved for future use) ──────────────────

export const KEYWORDS = {
  SUBMIT: ['thank you', 'thank you naavi', 'thanks', 'thanks naavi', 'over'],
  EXIT: ['goodbye', 'goodbye naavi', 'stop listening', "that's all", 'thats all'],
  WAKE: ['hi naavi', 'hey naavi', 'hello naavi', 'naavi'],
};

// ─── Hook (no-op stub) ──────────────────────────────────────────────────────

export function useHandsfreeMode(
  _orchestratorStatus: OrchestratorStatus,
  _sendMessage: (text: string) => Promise<void>,
  _speakCue: (text: string) => Promise<void>,
): UseHandsfreeModeResult {
  const [state] = useState<HandsfreeState>('inactive');
  const [error] = useState<string | null>(null);

  const activate = useCallback(() => {
    console.log('[Handsfree] Disabled — hands-free mode not available');
  }, []);

  const deactivate = useCallback(() => {}, []);

  return { state, error, activate, deactivate };
}
