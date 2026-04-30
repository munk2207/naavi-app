/**
 * init-drive-tree Edge Function
 *
 * One-shot helper that creates the entire MyNaavi folder structure in the
 * user's Google Drive and drops a README explaining each folder. Run once
 * per user via:
 *   POST /functions/v1/init-drive-tree
 *   { "user_id": "<uuid>" }
 *
 * Idempotent — re-running just confirms folders exist.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const NAAVI_FOLDER_NAME = 'MyNaavi';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Folder tree definition. Each entry = (path, README content).
// Top-level entries fall under MyNaavi/. Documents subfolders fall under
// MyNaavi/Documents/.
const TREE: Array<{ path: string[]; readme: string }> = [
  {
    path: ['Documents'],
    readme:
      'MyNaavi / Documents\n\nWhat lives here:\n- Email attachments harvested by Naavi, sorted into by-type subfolders (invoice, receipt, warranty, contract, medical, statement, tax, ticket, notice, calendar, other).\n\nAuto-populated by the harvest-attachment pipeline whenever a new attachment arrives in your inbox.',
  },
  { path: ['Documents', 'invoice'],   readme: 'MyNaavi / Documents / invoice\n\nBills awaiting payment.' },
  { path: ['Documents', 'receipt'],   readme: 'MyNaavi / Documents / receipt\n\nProof of payment completed.' },
  { path: ['Documents', 'warranty'],  readme: 'MyNaavi / Documents / warranty\n\nCoverage with an expiry date.' },
  { path: ['Documents', 'contract'],  readme: 'MyNaavi / Documents / contract\n\nSigned agreements.' },
  { path: ['Documents', 'medical'],   readme: 'MyNaavi / Documents / medical\n\nLab results, prescriptions, referrals.' },
  { path: ['Documents', 'statement'], readme: 'MyNaavi / Documents / statement\n\nBank, credit card, utility monthly summaries.' },
  { path: ['Documents', 'tax'],       readme: 'MyNaavi / Documents / tax\n\nT4, CRA correspondence, tax-year docs.' },
  { path: ['Documents', 'ticket'],    readme: 'MyNaavi / Documents / ticket\n\nTravel tickets, boarding passes.' },
  { path: ['Documents', 'notice'],    readme: 'MyNaavi / Documents / notice\n\ngov.ca, condo AGM, institutional notices.' },
  { path: ['Documents', 'calendar'],  readme: 'MyNaavi / Documents / calendar\n\nRecurring schedules (school year, sports season).' },
  { path: ['Documents', 'other'],     readme: 'MyNaavi / Documents / other\n\nDocumentary but uncategorized.' },
  {
    path: ['Briefs'],
    readme:
      'MyNaavi / Briefs\n\nWhat lives here:\n- Morning brief text saves when you missed the morning call.\n- Each file: today\'s calendar, key emails, reminders, weather.\n\nFiled here automatically when the briefing call goes unanswered.',
  },
  {
    path: ['Notes'],
    readme:
      'MyNaavi / Notes\n\nWhat lives here:\n- Notes saved via the SAVE_TO_DRIVE voice action ("save this to Drive")\n- Quick text notes you ask Naavi to remember as a Drive document.\n\nNot here: prescription PDFs (Documents/medical), morning brief saves (Briefs).',
  },
  {
    path: ['Transcripts'],
    readme:
      'MyNaavi / Transcripts\n\nWhat lives here:\n- Conversation summaries from Record-a-visit (the people icon on the home screen)\n- Each file contains: full transcript with speaker names, action items extracted, draft emails.\n\nNaming: "Conversation — <date>" by default; you can override the title in the speaker-labeling modal.',
  },
  {
    path: ['Lists'],
    readme:
      'MyNaavi / Lists\n\nWhat lives here:\n- Voice-managed list documents (grocery, packing, to-do, etc.)\n- Each list is a single Google Doc Naavi appends to / removes from when you say "add X to my grocery list" or "remove milk from grocery list"',
  },
];

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function findFolder(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const escName = name.replace(/'/g, "\\'");
  const q = `name='${escName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data.files) && data.files.length > 0) return data.files[0].id as string;
  return null;
}

async function createFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const res = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!res.ok) throw new Error(`Failed to create folder ${name}: ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function ensureFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(accessToken, name, parentId);
  return existing ?? createFolder(accessToken, name, parentId);
}

async function findFile(accessToken: string, name: string, parentId: string): Promise<boolean> {
  const escName = name.replace(/'/g, "\\'");
  const q = `name='${escName}' and '${parentId}' in parents and trashed=false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return false;
  const data = await res.json();
  return Array.isArray(data.files) && data.files.length > 0;
}

async function uploadReadme(accessToken: string, parentId: string, title: string, content: string): Promise<void> {
  const exists = await findFile(accessToken, title, parentId);
  if (exists) return;

  const boundary = `naavi_boundary_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: title,
    parents: [parentId],
    mimeType: 'application/vnd.google-apps.document',
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Failed to upload README ${title}: ${await res.text()}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const userId = body?.user_id as string | undefined;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tokenRow, error: tokenErr } = await admin
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();
    if (tokenErr || !tokenRow?.refresh_token) {
      return new Response(JSON.stringify({ error: 'No Google token found for user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getAccessToken(tokenRow.refresh_token);

    // Find or create MyNaavi root in user's Drive root.
    const rootQ = `name='${NAAVI_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const rootSearchRes = await fetch(
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(rootQ)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    let rootId: string | null = null;
    if (rootSearchRes.ok) {
      const rootData = await rootSearchRes.json();
      if (Array.isArray(rootData.files) && rootData.files.length > 0) {
        rootId = rootData.files[0].id as string;
      }
    }
    if (!rootId) {
      const createRes = await fetch(DRIVE_FILES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: NAAVI_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      });
      if (!createRes.ok) throw new Error('Failed to create MyNaavi root');
      rootId = (await createRes.json()).id as string;
    }

    // Walk the tree.
    const created: string[] = [];
    for (const node of TREE) {
      let parent = rootId;
      for (const segment of node.path) {
        parent = await ensureFolder(accessToken, segment, parent);
      }
      const readmeTitle = `README — ${node.path[node.path.length - 1]}`;
      await uploadReadme(accessToken, parent, readmeTitle, node.readme);
      created.push(node.path.join('/'));
    }

    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[init-drive-tree] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
