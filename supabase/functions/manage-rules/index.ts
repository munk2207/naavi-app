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

interface ListRequest        { op: 'list';        user_id?: string; }
interface DeleteRequest      { op: 'delete';      user_id?: string; rule_id: string; }
interface ReactivateRequest  { op: 'reactivate';  user_id?: string; rule_id: string; }
interface MergeTasksRequest   { op: 'merge_tasks';   user_id?: string; rule_id: string; tasks?: string[]; list_name?: string; }
interface ReplaceTasksRequest { op: 'replace_tasks'; user_id?: string; rule_id: string; tasks: string[]; }
interface CreateRuleRequest   { op: 'create'; user_id?: string; trigger_type: string; trigger_config: Record<string, unknown>; action_type: string; action_config: Record<string, unknown>; label: string; one_shot: boolean; }
type RulesRequest = ListRequest | DeleteRequest | ReactivateRequest | MergeTasksRequest | ReplaceTasksRequest | CreateRuleRequest;

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
      // 2026-05-22 (Wael) — F2e revised design REVERTS the 2026-05-21 Phase A
      // enabled=true filter. Disabled (fired one-shot) rules must appear in
      // the Alerts list so the mobile UI can render them greyed-out with a
      // Reactivate button. The voice LIST_RULES read-aloud path filters to
      // active-only at the read layer (so the list doesn't balloon when
      // spoken), but the raw list returns everything for the mobile UI.
      const { data, error } = await admin
        .from('action_rules')
        .select('id, trigger_type, trigger_config, action_type, action_config, label, one_shot, enabled, last_fired_at, created_at')
        .eq('user_id', userId)
        .order('enabled',      { ascending: false }) // active first
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

    if (body.op === 'reactivate') {
      // 2026-05-22 (Wael) — F2e reactivate. Flips enabled=true and clears
      // last_fired_at so the rule re-arms immediately. one_shot stays as
      // configured. Ownership check identical to delete.
      if (!body.rule_id) {
        return new Response(JSON.stringify({ error: 'rule_id is required for reactivate' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
      const { error: updErr } = await admin
        .from('action_rules')
        .update({ enabled: true, last_fired_at: null, last_entered_at: null, last_exited_at: null })
        .eq('id', body.rule_id);
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.op === 'merge_tasks') {
      if (!body.rule_id) {
        return new Response(JSON.stringify({ error: 'rule_id is required for merge_tasks' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: existing, error: ownErr } = await admin
        .from('action_rules')
        .select('id, user_id, action_config')
        .eq('id', body.rule_id)
        .maybeSingle();
      if (ownErr || !existing || existing.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Rule not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const existingConfig = existing.action_config ?? {};
      const mergedConfig: Record<string, unknown> = { ...existingConfig };
      const newTasks: string[] = Array.isArray(body.tasks) ? body.tasks : [];
      if (newTasks.length > 0) {
        const existingTasks = Array.isArray(existingConfig.tasks) ? existingConfig.tasks : [];
        mergedConfig.tasks = [...new Set([...existingTasks, ...newTasks])];
      }
      if (body.list_name) mergedConfig.list_name = body.list_name;
      const { error: updErr } = await admin
        .from('action_rules')
        .update({ action_config: mergedConfig })
        .eq('id', body.rule_id);
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action_config: mergedConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.op === 'replace_tasks') {
      if (!body.rule_id) {
        return new Response(JSON.stringify({ error: 'rule_id is required for replace_tasks' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: existing, error: ownErr } = await admin
        .from('action_rules')
        .select('id, user_id, action_config')
        .eq('id', body.rule_id)
        .maybeSingle();
      if (ownErr || !existing || existing.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Rule not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const updatedConfig = { ...(existing.action_config ?? {}), tasks: body.tasks };
      const { error: updErr } = await admin
        .from('action_rules')
        .update({ action_config: updatedConfig })
        .eq('id', body.rule_id);
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action_config: updatedConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.op === 'create') {
      // Service-role insert — bypasses RLS that blocks direct client writes.
      // Used by useOrchestrator for non-location SET_ACTION_RULE actions
      // (time, weather, calendar, contact_silence triggers).
      const { data: inserted, error: insErr } = await admin
        .from('action_rules')
        .insert({
          user_id:        userId,
          trigger_type:   body.trigger_type,
          trigger_config: body.trigger_config ?? {},
          action_type:    body.action_type,
          action_config:  body.action_config ?? {},
          label:          body.label ?? 'Action rule',
          one_shot:       body.one_shot ?? true,
          enabled:        true,
        })
        .select('id')
        .single();
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, id: (inserted as any)?.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: "op must be 'list', 'delete', 'reactivate', 'merge_tasks', 'replace_tasks', or 'create'" }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
