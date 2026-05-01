/**
 * Naavi Chat — Supabase Edge Function
 *
 * Proxies requests to the Anthropic API using a server-side key.
 * The key never lives on Robert's device.
 *
 * Also intercepts email alert requests server-side so Claude's
 * model refusal never reaches the user.
 *
 * Contact disambiguation:
 *   - 0 contacts match → save rule with from_name (broad)
 *   - 1 contact matches → save rule with exact from_email
 *   - 2+ contacts match → ask Robert which one, save pending_disambig,
 *     resolve on next message
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.79.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Phone numbers are looked up per-user from user_settings.phone — no hardcoding.

function formatPhoneForSpeech(phone: string): string {
  // Convert "+16137697957" → "+1 613 769 7957" so TTS reads it correctly
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

async function getUserPhone(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('phone')
      .eq('user_id', userId)
      .single();
    if (data?.phone) return data.phone;
  } catch (_) { /* ignore */ }
  return ''; // empty — callers handle gracefully
}

// ── V57.9.8 phantom-action server-side backstop ────────────────────────────
//
// Mirrors hooks/useOrchestrator.ts::phantomCommitChecks. Mobile already has
// this check on the client (since V57.9), but the server-side check ensures
// the same guarantee for every caller — voice server, future surfaces, and
// the auto-tester (which goes straight to naavi-chat without the mobile
// orchestrator).
//
// Each entry: a regex over Claude's `speech` for a commit verb, the action
// type that MUST exist for that verb to be honest, and the honest-fallback
// speech to substitute when the action is missing.
//
// Keep IN SYNC with the mobile-side regex set when changing.
const PHANTOM_CHECKS: Array<{ verbRe: RegExp; needsType: string; honestSpeech: string }> = [
  { verbRe: /\b(?:i['']?ve\s+(?:scheduled|added|booked|put)|i['']?ll\s+(?:schedule|add|book|put)|added it to (?:your|the) calendar|put (?:it|that) on (?:your|the) calendar|booked it for you|scheduled it for you)\b/i,
    needsType: 'CREATE_EVENT',
    honestSpeech: "I tried to add that to your calendar but my system didn't run it. Can you say it again?" },
  { verbRe: /\b(?:i['']?ve\s+(?:drafted|sent)|i['']?ll\s+(?:draft|send)|drafted (?:a|the) (?:message|email|text)|sent (?:a|the) (?:message|email|text))\b/i,
    needsType: 'DRAFT_MESSAGE',
    honestSpeech: "I tried to draft that message but my system didn't run it. Can you say it again?" },
  { verbRe: /\b(?:i['']?ve\s+saved|saved to memory|i['']?ll\s+remember|noted that|got it[,.]?\s+(?:i['']?ve\s+)?saved|i['']?ve\s+remembered)\b/i,
    needsType: 'REMEMBER',
    honestSpeech: "I tried to save that to memory but my system didn't run it. Can you say it again?" },
  { verbRe: /\b(?:i['']?ll\s+(?:alert|let you know|notify|text|tell)\s+you\s+when|i['']?ll\s+(?:alert|let you know|notify|text|tell)\s+you\s+(?:as soon|the moment|if)|alert is set|i['']?ve\s+set\s+(?:the|that|up)\s+(?:up\s+)?(?:the\s+)?alert)\b/i,
    needsType: 'SET_ACTION_RULE',
    honestSpeech: "I tried to set that alert but my system didn't run it. Can you say it again?" },
];

function rewritePhantomActionSpeech(rawText: string): string {
  if (typeof rawText !== 'string' || rawText.length === 0) return rawText;
  // Strip ```json fences Haiku sometimes adds.
  const fenced = /^```(?:json)?\s*/i.test(rawText) || /\s*```\s*$/.test(rawText);
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch {
    return rawText; // not JSON — nothing to rewrite
  }
  const speech = typeof parsed?.speech === 'string' ? parsed.speech : '';
  if (!speech) return rawText;

  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  for (const check of PHANTOM_CHECKS) {
    if (!check.verbRe.test(speech)) continue;
    const has = actions.some((a: any) => a?.type === check.needsType);
    if (!has) {
      console.warn(`[naavi-chat] phantom-action detected: speech promised ${check.needsType} but no matching action. Rewriting speech.`);
      const rewritten = { ...parsed, speech: check.honestSpeech };
      const out = JSON.stringify(rewritten);
      return fenced ? '```json\n' + out + '\n```' : out;
    }
  }
  return rawText;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function speechResponse(speech: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({
    rawText: JSON.stringify({ speech, actions: [], pendingThreads: [], ...extra }),
  });
}

// ── Email alert detection ─────────────────────────────────────────────────────

function detectEmailAlert(msg: string): { fromName: string | null; subjectKeyword: string | null } | null {
  const isAlert = /\b(alert|notify|text|sms|let me know|send me)\b.{0,80}\bemail/i.test(msg);
  if (!isAlert) return null;

  const subjectMatch =
    msg.match(/\b(?:subject|title)\b.{0,25}?\b([a-z0-9_\-]+)\b/i) ??
    msg.match(/\bwith\b\s+['"]?([a-z0-9_\-]+)['"]?\s+in\s+(?:the\s+)?(?:subject|title)\b/i) ??
    msg.match(/\b(?:containing|contains|saying|about|word)\b\s+['"]?([a-z0-9_\-]+)['"]?/i);
  const subjectKeyword = subjectMatch ? subjectMatch[1] : null;

  const fromMatch = msg.match(/\bfrom\b\s+([A-Za-z0-9][A-Za-z0-9\s._@-]{1,50}?)(?:\s*$|\s+(?:or|and|with|about|when|if|that|in))/i);
  const fromName = fromMatch ? fromMatch[1].trim() : null;

  if (!subjectKeyword && !fromName) return null;
  return { fromName, subjectKeyword };
}

// ── Calendar PDF ask-time reader ──────────────────────────────────────────────
//
// When Robert asks a calendar-shaped question ("when is the first day of
// school", "next PA day", etc.) AND he has a document_type='calendar' PDF
// harvested, we download that PDF binary at ask-time and pass it to Claude
// as a `document` content block so Claude reads the actual calendar grid
// and answers with the specific date.
//
// Only fires when the regex matches AND a calendar PDF exists. No cost
// otherwise.

const CALENDAR_INTENT_RE =
  /\b(when|what\s+(date|day|time)|how\s+many\s+days|next|first|last|upcoming)\b[\s\S]{0,80}\b(school|pa\s*day|holiday|break|semester|term|class|practice|game|tournament|match|concert|report\s*card|parent\s*teacher|exam|final)\b/i;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchCalendarPdfBlock(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userText: string,
): Promise<{ type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } } | null> {
  if (!CALENDAR_INTENT_RE.test(userText)) return null;

  // Find the user's most recent calendar PDF.
  const { data: calDoc } = await supabase
    .from('documents')
    .select('drive_file_id, file_name, size_bytes, mime_type')
    .eq('user_id', userId)
    .eq('document_type', 'calendar')
    .eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!calDoc?.drive_file_id) return null;
  // 20 MB guard — Claude PDF input cap is around 32 MB; leave headroom.
  if (typeof calDoc.size_bytes === 'number' && calDoc.size_bytes > 20 * 1024 * 1024) return null;

  // Exchange refresh token for access token
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();
  if (!tokenRow?.refresh_token) return null;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: tokenRow.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return null;

    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(calDoc.drive_file_id)}?alt=media`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!dlRes.ok) return null;
    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    if (bytes.length === 0) return null;

    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: bytesToBase64(bytes) },
    };
  } catch (err) {
    console.error('[naavi-chat] calendar pdf fetch failed:', err);
    return null;
  }
}

// ── Google Contacts lookup ────────────────────────────────────────────────────

async function lookupContactsByName(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  name: string
): Promise<{ name: string; email: string }[]> {
  try {
    // Get Google refresh token
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenRow?.refresh_token) return [];

    // Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: tokenRow.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return [];

    const accessToken = tokenData.access_token;

    // Search Google Contacts
    const url = new URL('https://people.googleapis.com/v1/people:searchContacts');
    url.searchParams.set('query', name.trim());
    url.searchParams.set('readMask', 'names,emailAddresses');
    url.searchParams.set('pageSize', '5');

    const peopleRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!peopleRes.ok) return [];

    const peopleData = await peopleRes.json();
    let results = peopleData.results ?? [];

    // Fallback: other contacts (people emailed before)
    if (results.length === 0) {
      const url2 = new URL('https://people.googleapis.com/v1/otherContacts:search');
      url2.searchParams.set('query', name.trim());
      url2.searchParams.set('readMask', 'names,emailAddresses');
      url2.searchParams.set('pageSize', '5');
      const res2 = await fetch(url2.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res2.ok) results = (await res2.json()).results ?? [];
    }

    return results
      .map((r: { person: { names?: { displayName: string }[]; emailAddresses?: { value: string }[] } }) => ({
        name:  r.person.names?.[0]?.displayName ?? '',
        email: r.person.emailAddresses?.[0]?.value ?? '',
      }))
      .filter((c: { name: string; email: string }) => c.name && c.email);

  } catch (err) {
    console.error('[naavi-chat] Google Contacts lookup failed:', err);
    return [];
  }
}

// ── V57.9.3 server-side prompt assembly ──────────────────────────────────────
//
// Mobile V57.9.3+ sends a lean body without the system prompt to avoid
// shipping 57 KB of text over the wire on every turn (caused 60 s body-
// upload stalls on sluggish networks). When `system` is missing we
// assemble the prompt here using:
//   1. user_settings (server-side DB lookup) for user_name + user_phone
//   2. get-naavi-prompt Edge Function (in-region, fast, prompt cached)
//   3. The mobile-supplied context (brief items, health, knowledge)
//
// Output mirrors what mobile sendToNaavi previously assembled — same
// CACHE_BOUNDARY / END_STABLE_RULES markers preserved so the prompt-cache
// 3-block split below still works.

interface MobileBriefItem {
  id?: string;
  category?: string;
  title?: string;
  detail?: string;
  urgent?: boolean;
}

async function assembleSystemPromptServerSide(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  opts: {
    channel: string;
    language: 'en' | 'fr';
    briefItems: MobileBriefItem[];
    healthContext: string;
    knowledgeContext: string;
  },
): Promise<string | null> {
  // 1. user_settings → user name + phone (drives prompt personalization)
  let userName = 'there';
  let userPhone = '';
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('name, phone')
      .eq('user_id', userId)
      .single();
    if (data?.name)  userName  = String(data.name);
    if (data?.phone) userPhone = String(data.phone);
  } catch (err) {
    console.warn('[assembleSystemPrompt] user_settings lookup failed:', (err as Error)?.message);
  }

  // 2. get-naavi-prompt → base canonical prompt (channel-tailored)
  let base: string | null = null;
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const promptRes = await fetch(`${supaUrl}/functions/v1/get-naavi-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        channel: opts.channel === 'voice' ? 'voice' : 'app',
        userName,
        userPhone,
      }),
    });
    if (promptRes.ok) {
      const promptData = await promptRes.json();
      if (typeof promptData?.prompt === 'string' && promptData.prompt.length > 100) {
        base = promptData.prompt;
      }
    } else {
      console.warn('[assembleSystemPrompt] get-naavi-prompt non-200:', promptRes.status);
    }
  } catch (err) {
    console.error('[assembleSystemPrompt] get-naavi-prompt fetch failed:', (err as Error)?.message);
  }

  if (!base) return null;

  // 3. Append mobile-supplied per-query context (brief / health / knowledge).
  //    Layout mirrors the previous mobile-side assembly so the prompt-cache
  //    3-block split downstream still finds the END_STABLE marker (it's
  //    embedded in the base) and partitions correctly.
  const languageNote = opts.language === 'fr'
    ? `\n${userName} speaks French. Respond in Canadian French.`
    : '';

  const briefContext = (opts.briefItems && opts.briefItems.length > 0)
    ? `\n\n## ${userName}'s upcoming schedule (next 7 days)\n` +
      opts.briefItems
        .map(item => `- [${item.category ?? 'task'}] ${item.title ?? ''}${item.detail ? ` — ${item.detail}` : ''}`)
        .join('\n')
    : `\n\n## ${userName}'s upcoming schedule (next 7 days)\n- No events found for the next 7 days.`;

  const healthSuffix    = opts.healthContext    ? `\n\n${opts.healthContext}`    : '';
  const knowledgeSuffix = opts.knowledgeContext ? `\n\n${opts.knowledgeContext}` : '';

  return base + languageNote + briefContext + healthSuffix + knowledgeSuffix;
}

// ── Resolve user ID ───────────────────────────────────────────────────────────

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  token: string,
  bodyUserId?: string | null,
): Promise<string | null> {
  // Attempt 1: JWT (mobile app path)
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) return user.id;
  } catch (_) { /* ignore */ }

  // Attempt 2: explicit body user_id (voice server / server-side caller path).
  // CLAUDE.md Rule 4 — required step (b) in the user-resolution chain.
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    return bodyUserId;
  }

  // V57.7 — REMOVED the user_tokens "first-google-user" fallback.
  // CLAUDE.md Rule 4 calls it "last resort, single-user apps only".
  // Naavi is multi-user; the fallback was a safety hole that bound any
  // unauthenticated caller (external webhook, attacker, broken test) to
  // whoever happened to be first in user_tokens. The auto-tester multi-
  // user matrix caught this 2026-04-29.
  return null;
}

// ── Save email alert rule ─────────────────────────────────────────────────────

async function saveAlertRule(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  phone: string,
  opts: { fromName?: string | null; fromEmail?: string | null; subjectKeyword?: string | null }
) {
  const label = opts.fromName
    ? `Emails from ${opts.fromName}`
    : `Emails with "${opts.subjectKeyword}" in subject`;

  // Writes go to action_rules (unified trigger/action framework).
  // email_watch_rules has been retired; evaluate-rules cron reads action_rules.
  const triggerConfig: Record<string, string> = {};
  if (opts.fromName)       triggerConfig.from_name = opts.fromName;
  if (opts.fromEmail)      triggerConfig.from_email = opts.fromEmail;
  if (opts.subjectKeyword) triggerConfig.subject_keyword = opts.subjectKeyword;

  const { error } = await supabase.from('action_rules').insert({
    user_id:        userId,
    trigger_type:   'email',
    trigger_config: triggerConfig,
    action_type:    'sms',
    action_config:  { to_phone: phone, body: `New email alert: ${label}` },
    label,
    one_shot:       false,
    enabled:        true,
  });

  if (error) console.error('[naavi-chat] action_rules insert error:', error.message);
  else       console.log('[naavi-chat] Alert rule saved to action_rules:', label);
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Timing diagnostics (Session 16) — remove once chat latency root cause is found.
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;

  try {
    const body = await req.json();
    const {
      system: rawSystem,
      messages,
      max_tokens: rawMaxTokens,
      user_id: bodyUserId,
      // V57.9.3 — new lean-body fields. Mobile no longer ships the 57 KB
      // system prompt over the wire (caused 60 s upload stall on slow
      // networks). Instead it sends user_id + channel + small mobile
      // context, and naavi-chat assembles the prompt server-side via
      // an in-region call to get-naavi-prompt.
      channel: bodyChannel,
      language: bodyLanguage,
      brief_items: bodyBriefItems,
      health_context: bodyHealthContext,
      knowledge_context: bodyKnowledgeContext,
    } = body;
    // V57.7 cost audit — cap output at 1024 tokens (was 2048). Naavi
    // replies are short by design ("3 sentences unless asked for more"),
    // so 1024 is plenty. 2048 was unused headroom inflating cost.
    // 100 beta users × 50 chat turns/day × 2x output = $$ savings.
    const max_tokens = Math.min(rawMaxTokens ?? 1024, 1024);

    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const hasInlineSystem = typeof rawSystem === 'string' && rawSystem.length > 0;
    console.log(
      `[timing] ${elapsed()} | request parsed | inline_system=${hasInlineSystem ? rawSystem.length : 0} chars | ` +
      `lean_body=${!hasInlineSystem} | messages=${messageCount}`
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace('Bearer ', '').trim();

    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
    const userText    = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const userPreview = userText.slice(0, 80).replace(/\s+/g, ' ');
    console.log(`[timing] ${elapsed()} | userText preview: "${userPreview}"`);
    console.log(`[TRACE-3 naavi-chat] userText full:`, JSON.stringify(userText), `length:`, userText.length);

    // ── Step 1: check for pending disambiguation ──────────────────────────────
    const userId = await resolveUserId(supabase, token, bodyUserId);
    console.log(`[timing] ${elapsed()} | resolveUserId done | userId=${userId ?? 'null'}`);

    // V57.7 — reject unauthenticated calls. Without this, naavi-chat acted
    // as a free Claude proxy for any unauthenticated caller (the attacker
    // surface auto-tester multi-user matrix surfaced 2026-04-29).
    if (!userId) {
      return jsonResponse({ error: 'Unauthorized — provide a JWT or user_id' }, 401);
    }

    if (userId) {
      const { data: pending } = await supabase
        .from('pending_disambig')
        .select('*')
        .eq('user_id', userId)
        .eq('action', 'email_alert')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log(`[timing] ${elapsed()} | pending_disambig check done | pending=${pending ? 'yes' : 'no'}`);

      if (pending) {
        const options: { name: string; email: string }[] = pending.payload.options;
        const reply = userText.toLowerCase();

        // Match "John Smith", "Smith", "the first", "1", etc.
        const numberWords = ['one','two','three','four','five'];
        const chosen = options.find((opt, i) => {
          const firstName = opt.name.split(' ')[0].toLowerCase();
          const lastName  = opt.name.split(' ').slice(1).join(' ').toLowerCase();
          const num       = String(i + 1);
          const word      = numberWords[i];
          return (
            reply.includes(opt.name.toLowerCase()) ||
            reply.includes(firstName) ||
            (lastName && reply.includes(lastName)) ||
            reply.includes(opt.email.toLowerCase()) ||
            reply === num ||
            reply === word ||
            reply.includes(`number ${num}`) ||
            reply.includes(`number ${word}`) ||
            (reply.includes('first')  && i === 0) ||
            (reply.includes('second') && i === 1) ||
            (reply.includes('third')  && i === 2) ||
            (reply.includes('fourth') && i === 3) ||
            (reply.includes('fifth')  && i === 4)
          );
        });

        if (chosen) {
          // Delete pending record and save confirmed rule
          await supabase.from('pending_disambig').delete().eq('id', pending.id);
          const userPhone = await getUserPhone(supabase, userId);
          await saveAlertRule(supabase, userId, userPhone, {
            fromName:  chosen.name,
            fromEmail: chosen.email,
          });

          const phoneSpeak = userPhone ? ` at ${formatPhoneForSpeech(userPhone)}` : '';
          return speechResponse(
            `Done — I'll text you${phoneSpeak} as soon as an email from ${chosen.name} arrives.`
          );
        }

        // Could not match — re-ask
        const names = options.map(o => o.name).join(' or ');
        return speechResponse(`I didn't catch that — which one: ${names}?`);
      }
    }

    // ── Step 2: detect new email alert intent ─────────────────────────────────
    const alertRule = detectEmailAlert(userText);
    console.log(`[timing] ${elapsed()} | detectEmailAlert done | alert=${alertRule ? 'yes' : 'no'}`);

    if (alertRule && userId) {
      let fromName  = alertRule.fromName;
      let fromEmail: string | null = null;

      // Contact lookup via Google Contacts when a name was given
      if (fromName) {
        const contacts = await lookupContactsByName(supabase, userId, fromName);

        if (contacts.length === 1) {
          const c = contacts[0];
          // Only accept the resolved email if the contact name or email actually contains
          // the search term — prevents false positives from Google's fuzzy matching
          const isGenuineMatch =
            c.name.toLowerCase().includes(fromName.toLowerCase()) ||
            c.email.toLowerCase().includes(fromName.toLowerCase());
          if (isGenuineMatch) {
            fromEmail = c.email;
            console.log('[naavi-chat] Contact resolved:', c.name, fromEmail);
          } else {
            console.log('[naavi-chat] Contact fuzzy match rejected:', c.name, c.email, '— saving name-only rule');
          }

        } else if (contacts.length > 1) {
          // Multiple matches — ask Robert to pick
          const nameList = contacts.map(c => c.name).join(', or ');

          await supabase.from('pending_disambig').insert({
            user_id: userId,
            action:  'email_alert',
            payload: { fromName, options: contacts },
          });

          const numberedList = contacts.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
          return speechResponse(
            `I found ${contacts.length} contacts named ${fromName}:\n${numberedList}\n\nJust say the number.`
          );
        }
        // 0 matches → fall through, save with from_name only (broad match)
      }

      const userPhone = await getUserPhone(supabase, userId);
      await saveAlertRule(supabase, userId, userPhone, {
        fromName:       fromName,
        fromEmail:      fromEmail,
        subjectKeyword: alertRule.subjectKeyword,
      });

      const confirmLabel = fromName
        ? `an email from ${fromName}`
        : `an email with "${alertRule.subjectKeyword}" in the subject`;

      const phoneSpeak = userPhone ? ` at ${formatPhoneForSpeech(userPhone)}` : '';
      return speechResponse(
        `Done — I'll text you${phoneSpeak} as soon as ${confirmLabel} arrives.`
      );
    }

    // ── Step 3: forward to Claude ─────────────────────────────────────────────

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

    const client   = new Anthropic({ apiKey });

    // V57.9.3 lean-body path — when mobile didn't ship `system` over the wire,
    // build it here from user_settings + get-naavi-prompt + the small mobile
    // context. Falls through with `system = rawSystem` (legacy V57.9.2 mobile
    // and any voice-server-style caller that already builds the prompt).
    let system: any = rawSystem;
    if (!hasInlineSystem) {
      const assembled = await assembleSystemPromptServerSide(supabase, userId, {
        channel: typeof bodyChannel === 'string' ? bodyChannel : 'app',
        language: bodyLanguage === 'fr' ? 'fr' : 'en',
        briefItems: Array.isArray(bodyBriefItems) ? bodyBriefItems : [],
        healthContext: typeof bodyHealthContext === 'string' ? bodyHealthContext : '',
        knowledgeContext: typeof bodyKnowledgeContext === 'string' ? bodyKnowledgeContext : '',
      });
      if (!assembled) {
        console.error('[naavi-chat] server-side prompt assembly failed; cannot proceed');
        return jsonResponse({ error: 'Prompt assembly failed; try again' }, 503);
      }
      system = assembled;
      console.log(`[timing] ${elapsed()} | server-assembled system | len=${assembled.length}`);
    }

    // Calendar ask-time PDF injection — when the user asks a date question
    // and has a calendar-typed PDF harvested, pass that PDF to Claude as a
    // document block so Claude reads the actual calendar grid and answers.
    // Only fires for calendar-shaped queries; otherwise no-op.
    let augmentedMessages = messages;
    if (userId) {
      const calBlock = await fetchCalendarPdfBlock(supabase, userId, userText);
      if (calBlock) {
        console.log(`[timing] ${elapsed()} | calendar PDF attached for Claude`);
        // Append the PDF to the last user message's content. If content is a
        // plain string, upgrade to an array so we can mix text + document.
        const copy = [...messages];
        const lastIdx = copy.map((m: { role: string }) => m.role).lastIndexOf('user');
        if (lastIdx !== -1) {
          const lastMsg = copy[lastIdx];
          const existingContent = typeof lastMsg.content === 'string'
            ? [{ type: 'text', text: lastMsg.content }]
            : (Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: String(lastMsg.content) }]);
          copy[lastIdx] = { ...lastMsg, content: [calBlock, ...existingContent] };
          augmentedMessages = copy;
        }
      }
    }

    const claudeStart = Date.now();
    // V57.7 — kept on Haiku 4.5. We briefly switched to Sonnet to chase
    // the OCLCC phantom-action bug, but it turned out the bug was a
    // multi-user resolution issue in resolveUserId() (missing body
    // user_id fallback). Once user resolution was fixed, Haiku works
    // fine — naavi-chat's server-side saveAlertRule() pipeline handles
    // "alert me when X" without going through Claude at all.
    console.log(`[timing] ${elapsed()} | Claude call starting | model=claude-haiku-4-5-20251001 | max_tokens=${max_tokens ?? 2048}`);
    // Prompt caching — the system prompt has two markers from get-naavi-prompt:
    //   CACHE_BOUNDARY  — separates dynamic prefix (date/time, per-request) from stable rules.
    //   END_STABLE      — separates the cacheable rules from mobile-appended per-query
    //                     context (brief items, knowledge fragments, health). That per-query
    //                     context is attached by the client AFTER the end-marker.
    //
    // We build a 3-block system array:
    //   [ dynamic, stable-with-cache_control, mobile-context-no-cache ]
    // Only the middle block is cached. Repeat calls within 5 min hit the cache for
    // the 6K+ token rules, while clock drift and per-query context don't break it.
    const CACHE_BOUNDARY = '\n---CACHE_BOUNDARY---\n';
    const END_STABLE     = '\n---END_STABLE_RULES---\n';
    let cachedSystem: any;
    if (typeof system === 'string' && system.includes(CACHE_BOUNDARY)) {
      const idx = system.indexOf(CACHE_BOUNDARY);
      const dynamicPart = system.slice(0, idx);
      const afterBoundary = system.slice(idx + CACHE_BOUNDARY.length);
      const endIdx = afterBoundary.indexOf(END_STABLE);
      let stablePart: string;
      let tailPart = '';
      if (endIdx !== -1) {
        stablePart = afterBoundary.slice(0, endIdx);
        tailPart   = afterBoundary.slice(endIdx + END_STABLE.length);
      } else {
        stablePart = afterBoundary;
      }
      // IMPORTANT: put the cached block FIRST. Anthropic's cache key includes
      // every content block preceding the cache_control breakpoint — so if the
      // dynamic prefix (which changes every minute) sits in front of the stable
      // rules, each call produces a new cache key and never hits. By putting the
      // stable rules as block 0, cache hits become order-independent of the
      // time/context that follows. Claude reads the blocks in order as one
      // system message; rules-first-then-date is semantically fine.
      cachedSystem = [
        { type: 'text', text: stablePart, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicPart },
      ];
      if (tailPart.length > 0) cachedSystem.push({ type: 'text', text: tailPart });
      console.log(`[timing] ${elapsed()} | cache split | stable=${stablePart.length} | dynamic=${dynamicPart.length} | tail=${tailPart.length}`);
    } else {
      // Legacy fallback: cache the whole string. Effective only if caller's prompt is stable.
      cachedSystem = typeof system === 'string'
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;
    }
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens ?? 2048,
      system: cachedSystem as any,
      messages: augmentedMessages,
    });
    const claudeMs = Date.now() - claudeStart;

    let rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    const usage = (response as any).usage ?? {};
    console.log(`[timing] ${elapsed()} | Claude call done | Claude=${claudeMs}ms | rawTextLen=${rawText.length}`);
    console.log(`[cache-debug] usage=${JSON.stringify(usage)}`);

    // V57.9.8 — server-side phantom-action backstop. Mirrors the V57.9
    // client-side check in hooks/useOrchestrator.ts. Catches the case
    // where Haiku speaks a commit verb ("I've drafted...", "I've
    // scheduled...") with empty actions[]. Without this, the server
    // returns a misleading reply that makes the user think an action
    // happened when it didn't. Speech is rewritten to an honest version;
    // actions[] is left untouched (the "fix" is to admit the failure,
    // not to fabricate the missing action).
    rawText = rewritePhantomActionSpeech(rawText);

    return jsonResponse({ rawText });

  } catch (err) {
    console.error('[naavi-chat] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
