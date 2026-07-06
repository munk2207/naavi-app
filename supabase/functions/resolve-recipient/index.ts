/**
 * resolve-recipient Edge Function (F12 Phase 4, 2026-07-05)
 *
 * The Recipient Resolver — see docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md §1.
 * `lookup-contact` remains the People API adapter; this function is the
 * sole consumer-facing resolution service — literal vs. named, single vs.
 * ambiguous. Mirrors the existing resolve-place split (decision layer vs.
 * raw Google API).
 *
 * NOT YET WIRED to any caller as of this commit. Mobile (`hooks/useOrchestrator.ts`),
 * voice (`naavi-voice-server/src/index.js`), and `evaluate-rules` all still use
 * their pre-existing resolution paths. This function exists standalone, tested
 * in isolation — zero effect on any live behavior until a caller is switched
 * over, which is a separate, deliberate step (Phase 2 §5/§6 risk classification).
 *
 * Request body — one of:
 *   Create mode: { mode: 'create', to: string, user_id: string }
 *   Fire mode:   { mode: 'fire', contact_id: string, user_id: string, to_name?: string }
 *
 * `mode` defaults to 'create' if omitted.
 *
 * Response — exactly one of:
 *   { kind: 'literal_email', value: string }
 *   { kind: 'literal_phone', value: string }
 *   { kind: 'resolved_contact', name: string, email: string|null, phone: string|null, contact_id: string|null }
 *   { kind: 'ambiguous', candidates: Array<{name, email, phone, contact_id}> }
 *   { kind: 'not_found' }
 *   { kind: 'invalid' }
 *
 * Identity hierarchy (docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md §1):
 * contact_id is canonical identity; to_name is a display label and the
 * fire-mode fallback key; email/phone are transient, always re-derived.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Same literal-detection shape as naavi-voice-server's executeDraft()
// (src/index.js — the DRAFT_MESSAGE resolver). Ported here as the single
// implementation rather than a third independent copy (Phase 1 §3/§4
// duplication concern — once callers switch over, executeDraft's inline
// checks should be replaced with a call to this function, not kept as a
// second copy of the same regex).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function looksLikePhone(s: string): boolean {
  const cleaned = s.replace(/[\s\-()]/g, '');
  return cleaned.startsWith('+') || /^\d{7,}$/.test(cleaned);
}

interface Contact {
  name: string;
  email: string | null;
  phone: string | null;
  contact_id: string | null;
}

interface LookupContactResponse {
  contact: Contact | null;
  contacts: Contact[];
}

async function callLookupContact(payload: Record<string, unknown>): Promise<LookupContactResponse | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lookup-contact`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.log(`[resolve-recipient] lookup-contact returned status=${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[resolve-recipient] lookup-contact call failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function toResolvedShape(c: Contact) {
  return { name: c.name, email: c.email, phone: c.phone, contact_id: c.contact_id };
}

function classifyContacts(result: LookupContactResponse | null): Record<string, unknown> {
  if (!result || !Array.isArray(result.contacts) || result.contacts.length === 0) {
    return { kind: 'not_found' };
  }
  if (result.contacts.length === 1) {
    return { kind: 'resolved_contact', ...toResolvedShape(result.contacts[0]) };
  }
  // 2+ matches, no single confident pick. At create-mode, the caller should
  // surface these as a picker (reusing the existing DRAFT_MESSAGE picker
  // pattern — Phase 2 §2). At fire-mode, ambiguous is a terminal failure
  // state, same as not_found — never silently pick "whichever came first."
  return { kind: 'ambiguous', candidates: result.contacts.map(toResolvedShape) };
}

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond({ kind: 'invalid', error: 'Malformed JSON body' }, 400);
  }

  const mode   = body.mode === 'fire' ? 'fire' : 'create';
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!userId) return respond({ kind: 'invalid', error: 'user_id is required' }, 400);

  if (mode === 'fire') {
    const contactId = typeof body.contact_id === 'string' ? body.contact_id.trim() : '';
    const toName     = typeof body.to_name === 'string' ? body.to_name.trim() : '';
    if (!contactId && !toName) {
      return respond({ kind: 'invalid', error: 'contact_id or to_name is required in fire mode' }, 400);
    }
    // Canonical identity first — contact_id survives a rename that would
    // break a name-only lookup.
    if (contactId) {
      const result = await callLookupContact({ contact_id: contactId, user_id: userId });
      if (result?.contact) {
        return respond({ kind: 'resolved_contact', ...toResolvedShape(result.contact) });
      }
      console.log(`[resolve-recipient] fire-mode contact_id lookup miss for "${contactId}" — falling back to to_name`);
    }
    // Fallback key, per the identity hierarchy — only reached if contact_id
    // was absent, or the ID-based lookup came back empty (deleted contact,
    // or a transient error indistinguishable from deletion at this layer).
    if (toName) {
      const result = await callLookupContact({ name: toName, user_id: userId });
      return respond(classifyContacts(result));
    }
    return respond({ kind: 'not_found' });
  }

  // create mode
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!to) return respond({ kind: 'invalid', error: 'to is required in create mode' }, 400);

  if (EMAIL_RE.test(to))     return respond({ kind: 'literal_email', value: to });
  if (looksLikePhone(to))    return respond({ kind: 'literal_phone', value: to });

  const result = await callLookupContact({ name: to, user_id: userId });
  return respond(classifyContacts(result));
});
