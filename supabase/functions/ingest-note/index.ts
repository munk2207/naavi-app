/**
 * ingest-note Edge Function
 *
 * Accepts plain text or voice transcript. Uses Claude to extract
 * KnowledgeFragment records, then generates OpenAI embeddings for each.
 * Stores results to knowledge_fragments table.
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLAUDE_API  = 'https://api.anthropic.com/v1/messages';
const OPENAI_API  = 'https://api.openai.com/v1/embeddings';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function buildClassifierPrompt(userName: string): string {
  return `Given the following note or transcript from ${userName}, identify all distinct knowledge fragments.
For each fragment output JSON with:
  type (life_story|important_date|preference|relationship|place|routine|concern),
  content (the fragment in ${userName}'s own words — keep first-person "I", "my" where used; if a name substitution is needed, use "${userName}"),
  classification (PUBLIC|PERSONAL|SENSITIVE|MEDICAL|FINANCIAL),
  confidence (0.0–1.0).
Return a JSON array only. No explanation.`;
}

async function extractFragments(text: string, userName: string): Promise<Array<{
  type: string;
  content: string;
  classification: string;
  confidence: number;
}>> {
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Sonnet → Haiku: structured knowledge extraction is Haiku-easy.
      // Prompt caching: the classifier prompt is stable per user.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: buildClassifierPrompt(userName),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Note:\n${text}`,
        },
      ],
    }),
  });

  const data = await res.json();
  const raw = data.content?.[0]?.text ?? '[]';

  try {
    const cleaned = raw
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) {
      console.error('[ingest-note] No JSON array in Claude response:', raw);
      return [];
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    console.error('[ingest-note] Failed to parse Claude response:', raw);
    return [];
  }
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      }),
    });
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error('[ingest-note] Embedding failed:', err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  let userId: string | null = null;

  // Try JWT auth first (mobile app)
  try {
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch (_) { /* ignore */ }

  const body = await req.json();
  const { text, source = 'notes' } = body;

  // Fallback: accept user_id from body (voice server with service role key)
  if (!userId && body.user_id) {
    userId = body.user_id;
    console.log(`[ingest-note] Using user_id from request body: ${userId}`);
  }

  // V57.7 — REMOVED user_tokens "first-google-user" fallback. Multi-user
  // safety hole; the auto-tester multi-user matrix caught this 2026-04-29.
  // Without auth + without body user_id, return 401 instead of binding to
  // whoever was first in user_tokens (Hussein in this project's history).

  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing text' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Look up user's name from user_settings for personalized classification
    let userName = 'the user';
    try {
      const nameClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const { data: settings } = await nameClient
        .from('user_settings')
        .select('name')
        .eq('user_id', userId)
        .single();
      if (settings?.name) userName = settings.name;
    } catch (_) { /* ignore */ }

    // 1. Extract fragments via Claude
    const fragments = await extractFragments(text, userName);
    console.log(`[ingest-note] Extracted ${fragments.length} fragments for ${userName}`);

    if (fragments.length === 0) {
      return new Response(JSON.stringify({ fragments: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Generate embeddings + store (non-blocking per fragment)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const stored = [];
    for (const frag of fragments) {
      const embedding = await generateEmbedding(frag.content);

      const { data, error } = await adminClient
        .from('knowledge_fragments')
        .insert({
          user_id:        userId,
          type:           frag.type,
          content:        frag.content,
          classification: frag.classification,
          confidence:     frag.confidence,
          source,
          embedding:      embedding ? JSON.stringify(embedding) : null,
        })
        .select('id, type, content, classification, source, confidence')
        .single();

      if (error) {
        console.error('[ingest-note] Insert failed:', error.message);
      } else {
        stored.push(data);
      }
    }

    console.log(`[ingest-note] Stored ${stored.length} fragments for user ${userId}`);

    return new Response(JSON.stringify({ fragments: stored }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingest-note] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
