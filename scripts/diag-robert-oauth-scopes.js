const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/seed-demo-email-james';
// Reuse the deployed function's own token-refresh path indirectly isn't possible for
// tokeninfo, so instead check via a tiny inline function deploy-free approach:
// we can't read GOOGLE_CLIENT_ID/SECRET locally, so instead check token scopes
// by calling Google's tokeninfo endpoint using the access token minted by an
// Edge Function. Simplest: extend nothing — just inspect via a direct DB read
// of user_tokens (scopes may be stored) first.
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await sb.from('user_tokens').select('*').eq('user_id', 'f1bc46b8-a478-43ad-bf09-e138099c8847').eq('provider', 'google').maybeSingle();
  console.log('error:', error);
  console.log('columns:', data ? Object.keys(data) : null);
  console.log(JSON.stringify({ ...data, refresh_token: data?.refresh_token ? '[present, redacted]' : null, access_token: data?.access_token ? '[present, redacted]' : null }, null, 2));
})();
