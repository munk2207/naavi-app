/**
 * AI Orchestration Layer — Main Orchestrator
 *
 * This is the central engine of Naavi. It coordinates:
 * 1. Receiving Robert's message
 * 2. Building the full context package (profile + integration snapshot + history)
 * 3. Calling the Claude API
 * 4. Parsing Claude's structured response
 * 5. Executing the resulting actions
 * 6. Returning the spoken response and updating conversation history
 *
 * Plain English: this is the "director" — it calls all the other
 * pieces in the right order and returns a single clean result.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildOrchestrationPayload } from './prompt-builder';
import { parseClaudeResponse } from './action-parser';
import { executeActions } from './action-executor';
import type {
  OrchestrationRequest,
  ClaudeResponse,
  ConversationTurn,
} from './types';

// ─── Configuration ────────────────────────────────────────────────────────────

const MODEL = {
  /**
   * Primary model — used for all standard morning briefs
   * and routine requests. Fast and cost-effective.
   */
  standard: 'claude-sonnet-4-6',

  /**
   * Deep reasoning model — used when Robert raises a health concern,
   * a complex scheduling conflict, or a multi-step task.
   * Slower but significantly better at nuanced reasoning.
   */
  deep: 'claude-opus-4-6',
} as const;

const MAX_TOKENS = 1024; // Naavi's responses are intentionally brief

// ─── Orchestrator result ──────────────────────────────────────────────────────

export interface OrchestratorResult {
  /** What Naavi should say out loud */
  speech: string;

  /** The full parsed response from Claude (for logging/debugging) */
  claudeResponse: ClaudeResponse;

  /** Whether all actions executed successfully */
  actionsSucceeded: boolean;

  /** Any actions that failed to execute */
  failedActions: ClaudeResponse['actions'];

  /** Updated conversation history including this turn */
  updatedHistory: ConversationTurn[];
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export class NaaviOrchestrator {
  private client: Anthropic;

  constructor() {
    // API key is read from the ANTHROPIC_API_KEY environment variable.
    // In the Expo app this will be stored in a secure environment config,
    // never hardcoded in the source code.
    this.client = new Anthropic();
  }

  /**
   * Process a single turn of conversation with Robert.
   *
   * This is the main entry point — called every time Robert
   * says something to Naavi.
   */
  async process(request: OrchestrationRequest): Promise<OrchestratorResult> {
    // Step 1: Decide which model to use based on content
    const model = this.selectModel(request.userMessage);

    // Step 2: Build the full prompt payload
    const { systemPrompt, messages } = buildOrchestrationPayload(request);

    // Step 3: Call Claude
    let rawResponse: string;
    try {
      rawResponse = await this.callClaude(systemPrompt, messages, model);
    } catch (err) {
      console.error('[Orchestrator] Claude API call failed:', err);
      return this.errorResult(request, 'I am having trouble connecting right now — please try again.');
    }

    // Step 4: Parse Claude's structured JSON response
    const claudeResponse = parseClaudeResponse(rawResponse);

    // Step 5: Execute the actions (reminders, profile updates, etc.)
    const executionSummary = await executeActions(claudeResponse);

    // Step 6: Update conversation history with this turn
    const updatedHistory = this.appendToHistory(
      request.conversationHistory,
      request.userMessage,
      claudeResponse.speech
    );

    return {
      speech: claudeResponse.speech,
      claudeResponse,
      actionsSucceeded: executionSummary.allSucceeded,
      failedActions: executionSummary.failedActions,
      updatedHistory,
    };
  }

  // ─── Private methods ────────────────────────────────────────────────────────

  private async callClaude(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string
  ): Promise<string> {
    const response = await this.client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content');
    }

    return textBlock.text;
  }

  /**
   * Chooses the right model based on what Robert said.
   *
   * Triggers for the deeper (Opus) model:
   * - Health-related keywords (symptom, pain, dizzy, medication, doctor)
   * - Complex scheduling (conflict, overlap, reschedule)
   * - Relationship context (upset, worried, not heard from)
   *
   * Everything else uses Sonnet — faster and sufficient for
   * routine orchestration tasks.
   */
  private selectModel(message: string): string {
    const lower = message.toLowerCase();

    const deepTriggers = [
      // Health
      'pain', 'symptom', 'dizzy', 'chest', 'breathe', 'medication', 'doctor', 'hospital',
      'blood pressure', 'glucose', 'insulin', 'prescribed',
      // Complex scheduling
      'conflict', 'overlap', 'reschedule', 'cancel all',
      // Relationship concerns
      'upset', 'worried', 'not heard from', 'concerned about',
    ];

    const needsDeepReasoning = deepTriggers.some(trigger => lower.includes(trigger));
    return needsDeepReasoning ? MODEL.deep : MODEL.standard;
  }

  private appendToHistory(
    history: ConversationTurn[],
    userMessage: string,
    assistantResponse: string
  ): ConversationTurn[] {
    const now = new Date().toISOString();
    return [
      ...history,
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantResponse, timestamp: now },
    ];
  }

  private errorResult(
    request: OrchestrationRequest,
    speech: string
  ): OrchestratorResult {
    const fallback: ClaudeResponse = {
      speech,
      actions: [],
      pendingThreads: [],
      profileUpdates: [],
    };

    return {
      speech,
      claudeResponse: fallback,
      actionsSucceeded: false,
      failedActions: [],
      updatedHistory: request.conversationHistory,
    };
  }
}

// Singleton instance — one orchestrator for the whole app
export const orchestrator = new NaaviOrchestrator();
