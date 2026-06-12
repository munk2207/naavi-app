/**
 * add-staffer Edge Function — F6a staffer management (2026-06-12)
 *
 * Actions (passed as ?action= or body.action):
 *   list       — list all staffers (admin + superadmin)
 *   add        — add new staffer as role=staff (admin + superadmin)
 *   deactivate — set active=false (admin + superadmin)
 *   reactivate — set active=true (admin + superadmin)
 *   promote    — set role=admin (superadmin only)
 *   demote     — set role=staff (superadmin only)
 *
 * Caller identity: JWT bearer token, verified via check-staff logic inline.
 * Superadmin is hardcoded — never stored in DB.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPERADMIN = 'wael@mynaavi.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function getCallerEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email ?? '';
  } catch { return ''; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verify JWT and resolve caller role
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user?.email) return json({ error: 'unauthorized' }, 401);

  const callerEmail = user.email;
  let callerRole: 'superadmin' | 'admin' | null = null;

  if (callerEmail === SUPERADMIN) {
    callerRole = 'superadmin';
  } else {
    const { data: staffRow } = await admin
      .from('support_staff')
      .select('role')
      .eq('email', callerEmail)
      .eq('active', true)
      .maybeSingle();
    if (staffRow?.role === 'admin') callerRole = 'admin';
  }

  if (!callerRole) return json({ error: 'forbidden' }, 403);

  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
  const action = String(body.action ?? '').trim();

  // ── list ────────────────────────────────────────────────────────────
  if (action === 'list') {
    const { data, error } = await admin
      .from('support_staff')
      .select('id, email, name, role, active, created_at')
      .order('created_at', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ staffers: data, caller_role: callerRole });
  }

  // ── add ─────────────────────────────────────────────────────────────
  if (action === 'add') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const name  = String(body.name  ?? '').trim();
    if (!email || !/@/.test(email)) return json({ error: 'valid email required' }, 400);
    if (!name)                       return json({ error: 'name required' }, 400);
    if (email === SUPERADMIN)        return json({ error: 'cannot add superadmin as staffer' }, 400);

    const { data, error } = await admin
      .from('support_staff')
      .insert({ email, name, role: 'staff', active: true })
      .select('id, email, name, role, active')
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, staffer: data });
  }

  // ── deactivate / reactivate ──────────────────────────────────────────
  if (action === 'deactivate' || action === 'reactivate') {
    const targetEmail = String(body.email ?? '').trim().toLowerCase();
    if (!targetEmail) return json({ error: 'email required' }, 400);
    if (targetEmail === SUPERADMIN) return json({ error: 'cannot modify superadmin' }, 400);

    const { error } = await admin
      .from('support_staff')
      .update({ active: action === 'reactivate' })
      .eq('email', targetEmail);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, action, email: targetEmail });
  }

  // ── promote / demote — superadmin only ──────────────────────────────
  if (action === 'promote' || action === 'demote') {
    if (callerRole !== 'superadmin') return json({ error: 'forbidden — superadmin only' }, 403);

    const targetEmail = String(body.email ?? '').trim().toLowerCase();
    if (!targetEmail) return json({ error: 'email required' }, 400);
    if (targetEmail === SUPERADMIN) return json({ error: 'cannot modify superadmin' }, 400);

    const newRole = action === 'promote' ? 'admin' : 'staff';
    const { error } = await admin
      .from('support_staff')
      .update({ role: newRole })
      .eq('email', targetEmail);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, action, email: targetEmail, role: newRole });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
