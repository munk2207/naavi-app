import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ authorized: false }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Verify the JWT and get the user's email
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user?.email) return new Response(JSON.stringify({ authorized: false }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const SUPERADMIN = 'wael@mynaavi.com';

  // Superadmin is hardcoded — never needs a DB row
  if (user.email === SUPERADMIN) {
    return new Response(JSON.stringify({ authorized: true, email: user.email, role: 'superadmin' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Check if this email is in support_staff
  const { data } = await admin.from('support_staff').select('email, role').eq('email', user.email).eq('active', true).maybeSingle();
  return new Response(JSON.stringify({ authorized: !!data, email: user.email, role: data?.role ?? null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
