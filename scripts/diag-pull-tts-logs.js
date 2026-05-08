/**
 * Pull recent TTS-related rows from client_diagnostics so we can see why
 * cloud TTS keeps falling back to expo-speech on V57.11.5 build 147.
 *
 * Run: node scripts/diag-pull-tts-logs.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Pull all rows from the last 60 minutes that look TTS-related.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  const ttsRows = (data ?? []).filter((r) => {
    const e = String(r.event ?? r.event_name ?? '').toLowerCase();
    return e.startsWith('tts-') || e.includes('voice-') || e.includes('expo');
  });

  console.log(`\nFound ${ttsRows.length} TTS-related rows in the last 60 min (out of ${data?.length ?? 0} total)\n`);

  for (const r of ttsRows) {
    const ts = r.created_at?.replace('T', ' ').slice(0, 19) ?? '?';
    const sess = (r.diag_session ?? r.session_id ?? '?').toString().slice(0, 8);
    const event = r.event ?? r.event_name ?? '?';
    const data = r.data ?? r.payload ?? null;
    const dataStr = data ? JSON.stringify(data).slice(0, 200) : '';
    console.log(`${ts}  [${sess}]  ${event}  ${dataStr}`);
  }

  // Also count how many "tts-fallback-expo" or "tts-all-null-fallback" we've seen
  const fallbacks = ttsRows.filter((r) => {
    const e = String(r.event ?? r.event_name ?? '');
    return e === 'tts-fallback-expo' || e === 'tts-all-null-fallback' || e === 'tts-chunk-null';
  });

  console.log(`\nFallback/error events: ${fallbacks.length}`);
  for (const f of fallbacks) {
    const ts = f.created_at?.replace('T', ' ').slice(0, 19) ?? '?';
    const event = f.event ?? f.event_name ?? '?';
    console.log(`  ${ts}  ${event}  ${JSON.stringify(f.data ?? f.payload ?? {})}`);
  }
})();
