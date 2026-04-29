/**
 * Adapters — thin clients for Naavi's Edge Functions and direct DB access.
 *
 * Each adapter wraps fetch with:
 *   - 30s default timeout (AbortController)
 *   - Authorization header
 *   - JSON body parsing
 *
 * Tests call these instead of bare fetch so request/response handling is
 * uniform and easy to mock if needed.
 */

import type { TestContext } from './types';

interface CallOptions {
  /** Override timeout (default 30_000 ms). */
  timeoutMs?: number;
  /** Use service-role key instead of anon (bypasses RLS — server-side trust). */
  asService?: boolean;
}

async function callEdgeFunction(
  ctx: TestContext,
  fnName: string,
  body: any,
  opts: CallOptions = {},
): Promise<{ status: number; data: any; durationMs: number }> {
  const { timeoutMs = 30_000, asService = false } = opts;
  const url = `${ctx.supabaseUrl}/functions/v1/${fnName}`;
  const key = asService ? ctx.serviceRoleKey : ctx.anonKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        // For service-role calls we also set apikey header.
        ...(asService ? { 'apikey': ctx.serviceRoleKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, data, durationMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

export const adapters = {
  /** Generic call. Use this for any Edge Function. */
  call: callEdgeFunction,

  /** Cache the canonical Naavi prompt so we don't refetch on every test. */
  _promptCache: null as string | null,
  async _fetchPrompt(ctx: TestContext, channel: 'app' | 'voice' = 'app'): Promise<string> {
    if (this._promptCache) return this._promptCache;
    const res = await callEdgeFunction(ctx, 'get-naavi-prompt', { channel }, { timeoutMs: 15_000 });
    if (res.status !== 200 || !res.data?.prompt) {
      throw new Error(`get-naavi-prompt failed: status=${res.status} data=${JSON.stringify(res.data).slice(0, 200)}`);
    }
    this._promptCache = res.data.prompt;
    return this._promptCache;
  },

  /** naavi-chat — main Claude round-trip. Always loads the real prompt. */
  async naaviChat(
    ctx: TestContext,
    args: { system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; max_tokens?: number },
    opts: CallOptions = {},
  ) {
    const system = args.system ?? await this._fetchPrompt(ctx);
    return callEdgeFunction(ctx, 'naavi-chat', {
      system,
      messages: args.messages,
      max_tokens: args.max_tokens ?? 1024,
      user_id: ctx.testUserId, // critical — naavi-chat falls back to first-user-with-google-tokens otherwise (Hussein/Wael)
    }, opts);
  },

  /** lookup-contact — Google People API multi-match. */
  async lookupContact(ctx: TestContext, name: string, opts: CallOptions = {}) {
    return callEdgeFunction(ctx, 'lookup-contact', { name, user_id: ctx.testUserId }, opts);
  },

  /** resolve-place — verified-address-only resolver. */
  async resolvePlace(
    ctx: TestContext,
    args: { place_name: string; save_to_cache?: boolean; canonical_alias?: string },
    opts: CallOptions = {},
  ) {
    return callEdgeFunction(ctx, 'resolve-place', {
      user_id: ctx.testUserId,
      place_name: args.place_name,
      save_to_cache: args.save_to_cache ?? false,
      canonical_alias: args.canonical_alias,
    }, opts);
  },

  /** text-to-speech — Deepgram audio synth. */
  async textToSpeech(ctx: TestContext, text: string, opts: CallOptions = {}) {
    return callEdgeFunction(ctx, 'text-to-speech', { text }, opts);
  },

  /** global-search — multi-source content search. */
  async globalSearch(ctx: TestContext, query: string, opts: CallOptions = {}) {
    return callEdgeFunction(ctx, 'global-search', { query, user_id: ctx.testUserId, limit: 10 }, opts);
  },

  /** manage-rules — list/delete action rules. */
  async manageRules(
    ctx: TestContext,
    args: { op: 'list' | 'delete'; rule_id?: string },
    opts: CallOptions = {},
  ) {
    return callEdgeFunction(ctx, 'manage-rules', { ...args, user_id: ctx.testUserId }, opts);
  },

  /** ingest-note — knowledge fragment writer. Takes { text, source, user_id }. */
  async ingestNote(ctx: TestContext, text: string, opts: CallOptions = {}) {
    return callEdgeFunction(ctx, 'ingest-note', {
      user_id: ctx.testUserId,
      text,
      source: 'auto-tester',
    }, opts);
  },

  /** search-knowledge — vector search over fragments. Takes { q, top_k, user_id }. */
  async searchKnowledge(ctx: TestContext, query: string, opts: CallOptions = {}) {
    return callEdgeFunction(ctx, 'search-knowledge', {
      user_id: ctx.testUserId,
      q: query,
      top_k: 10,
    }, opts);
  },

  /** create-calendar-event. */
  async createCalendarEvent(
    ctx: TestContext,
    args: { summary: string; start: string; end: string; description?: string },
    opts: CallOptions = {},
  ) {
    return callEdgeFunction(ctx, 'create-calendar-event', {
      user_id: ctx.testUserId,
      ...args,
    }, opts);
  },
};

/** Direct Postgres REST helpers via PostgREST (uses service-role for unrestricted writes). */
export const db = {
  async select(ctx: TestContext, table: string, query: string = '') {
    const url = `${ctx.supabaseUrl}/rest/v1/${table}${query ? '?' + query : ''}`;
    const res = await fetch(url, {
      headers: {
        'apikey': ctx.serviceRoleKey,
        'Authorization': `Bearer ${ctx.serviceRoleKey}`,
      },
    });
    if (!res.ok) throw new Error(`db.select(${table}) failed: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async insert(ctx: TestContext, table: string, row: any) {
    const url = `${ctx.supabaseUrl}/rest/v1/${table}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': ctx.serviceRoleKey,
        'Authorization': `Bearer ${ctx.serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`db.insert(${table}) failed: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async delete(ctx: TestContext, table: string, query: string) {
    const url = `${ctx.supabaseUrl}/rest/v1/${table}?${query}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': ctx.serviceRoleKey,
        'Authorization': `Bearer ${ctx.serviceRoleKey}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!res.ok) throw new Error(`db.delete(${table}) failed: ${res.status} ${await res.text()}`);
  },
};
