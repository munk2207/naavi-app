/**
 * AI Orchestration Layer — Public API
 *
 * Everything the rest of the app needs from the orchestration layer
 * is exported from here. Other modules import from this file,
 * not from individual files inside this folder.
 */

export { orchestrator, NaaviOrchestrator } from './orchestrator';
export type { OrchestratorResult } from './orchestrator';
export type {
  OrchestrationRequest,
  ClaudeResponse,
  NaaviAction,
  IntegrationSnapshot,
  ProfileSummary,
  ConversationTurn,
  PendingThread,
  ProfileUpdate,
} from './types';
