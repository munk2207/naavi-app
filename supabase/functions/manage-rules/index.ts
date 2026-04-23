/**
 * manage-rules Edge Function
 *
 * LIST and DELETE operations for action_rules. Covers:
 *   - The Alerts screen in the mobile app (list + delete).
 *   - Voice / text LIST_RULES / DELETE_RULE actions from Naavi.
 *
 * Request (POST JSON):
 *   { op: 'list',   user_id?: string }            → { rules: [...] }
 *   { op: 'delete', user_id?: string, rule_id: string } → { ok: true|false }
 *
 * User resolution follows CLAUDE.md Rule 4 (3-step chain):
 *   1. Authorization header JWT → supabase.auth.getUser()
 *   2. Request body user_id (voice server / server-side callers)
 *   3. No fallback — returns 401 if neither path yields a user id.
 *     (This function is for user-owned data; we never default to a "first user".)
 *
 * Every DELETE verifies ownership (user_id matches the rule's user_id) before
 * running; a rule_id mismatch returns 404 rather than silently dropping.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ListRequest   { op: 'list';   user_id?: string; }
interface DeleteRequest { op: 'delete'; user_id?: string; rule_id: string; }
type RulesRequest = ListRequest | DeleteRequest;

async function resolveUserId(req: Request, bodyUserId?: string): Promise<string | null> {
  // (a) JWT path — app caller with Authorization header
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const { data: { user } } = await sb.auth.getUser(token);
      if (user?.id) return user.id;
    } catch { /* ignore and try next path */ }
  }
  // (b) Explicit body user_id — voice server / server-side
  if (bodyUserId && typeof bodyUserId === 'string') return bodyUserId;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Partial<RulesRequest>;
    const userId = await resolveUserId(req, body.user_id);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated — pass a Bearer token or user_id.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (body.op === 'list') {
      const { data, error } = await admin
        .from('action_rules')
        .select('id, trigger_type, trigger_config, action_type, action_config, label, one_shot, enabled, created_at')
        .eq('user_id', userId)
        .order('trigger_type', { ascending: true })
        .order('created_at',   { ascending: false });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ rules: data ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.op === 'delete') {
      if (!body.rule_id) {
        return new Response(JSON.stringify({ error: 'rule_id is required for delete' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Verify ownership BEFORE delete — avoid a user deleting another user's row
      // via a crafted request. The service-role key bypasses RLS, so this check
      // is the only enforcement.
      const { data: existing, error: ownErr } = await admin
        .from('action_rules')
        .select('id, user_id')
        .eq('id', body.rule_id)
        .maybeSingle();
      if (ownErr) {
        return new Response(JSON.stringify({ error: ownErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!existing || existing.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Rule not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: delErr } = await admin
        .from('action_rules')
        .delete()
        .eq('id', body.rule_id);
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: "op must be 'list' or 'delete'" }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
