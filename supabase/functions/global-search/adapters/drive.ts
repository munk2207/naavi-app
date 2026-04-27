/**
 * Drive adapter — hybrid of two sources:
 *
 *   1. Our own `documents` table (attachments Naavi harvested from emails,
 *      with rich metadata: document_type, linked email_actions vendor +
 *      summary + reference).
 *   2. Google Drive API live search (fullText + name across the user's
 *      entire Drive — covers text-layer PDFs, Docs, Sheets, Slides).
 *
 * Results are deduped on drive_file_id. When the same file shows up in
 * both sources, the documents-table row wins (richer metadata).
 *
 * Multi-variant aware — honours ctx.queryVariants so "payments" and "pay"
 * both find the same files.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL   = 'https://www.googleapis.com/drive/v3/files';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Common English stop words. Drive's fullText search splits a phrase into
// words and matches ANY, so a query like "tell me about my upcoming week in
// detail" returns every document containing "week" or "about" — pure noise.
// Filtering out stop words keeps only signal-bearing terms (proper nouns,
// vendor names, document keywords). Time-of-day / calendar phrases drop to
// zero usable tokens after this filter, so we skip the Drive API call.
const STOP_WORDS = new Set<string>([
  'a','about','after','all','also','am','an','and','any','are','around','as','at',
  'be','been','before','between','both','but','by',
  'can','could',
  'detail','details','did','do','does','doing','done',
  'each','every',
  'for','from',
  'had','has','have','having','he','her','here','him','his','how',
  'i','if','in','into','is','it','its','itself',
  'just',
  'know',
  'like','list',
  'me','might','more','most','my','myself',
  'no','nor','not','now',
  'of','off','on','once','only','or','our','ours','out','over','own',
  'past',
  'really',
  'same','she','should','so','some','such',
  'tell','than','that','the','their','them','then','there','these','they','this','those','through','to','today','tomorrow','too',
  'under','until','up','upcoming','us',
  'very',
  'was','we','week','weekend','were','what','when','where','which','while','who','whom','why','will','with','would',
  'yes','you','your','yours','yourself',
]);

function filterStopWords(variant: string): string {
  const tokens = variant.toLowerCase().split(/\s+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t));
  return tokens.join(' ');
}

// Convert ISO date "2025-09-02..." → "September 2, 2025" so TTS reads it
// naturally instead of "twenty twenty five dash zero nine dash zero two".
function formatHumanDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year  = m[1];
  const month = MONTHS[parseInt(m[2], 10) - 1] || '';
  const day   = String(parseInt(m[3], 10));
  return `${month} ${day}, ${year}`;
}

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[drive-adapter] token refresh failed:', err);
    return null;
  }
}

type DocRow = {
  id: string;
  gmail_message_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  document_type: string | null;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  created_at: string | null;
  extracted_summary: string | null;
  extracted_amount_cents: number | null;
  extracted_currency: string | null;
  extracted_date: string | null;
  extracted_reference: string | null;
  extracted_expiry: string | null;
  email_action: {
    vendor: string | null;
    summary: string | null;
    reference: string | null;
    action_type: string | null;
  } | null;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
};

function escapeForDriveQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function iconForMime(mime: string | null | undefined): string {
  if (!mime) return 'document';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/vnd.google-apps.document') return 'google-doc';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'google-sheet';
  if (mime === 'application/vnd.google-apps.presentation') return 'google-slides';
  return 'document';
}

export const driveAdapter: SearchAdapter = {
  name: 'drive',
  label: 'Drive',
  icon: 'cloud',
  privacyTag: 'general',

  // Connected means the user has a Google refresh token AND we can reach
  // either of the two sources. We check the cheap Supabase lookup and let
  // the Drive-side call no-op on token failure.
  isConnected: async (ctx: SearchContext) => {
    const { data } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();
    return !!data?.refresh_token;
  },

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];
    const variants = ctx.queryVariants;

    // ── Source 1 — documents table (harvested attachments) ─────────────────
    const docsOr: string[] = [];
    for (const v of variants) {
      const pat = `%${v}%`;
      docsOr.push(
        `file_name.ilike.${pat}`,
        `document_type.ilike.${pat}`,
        `extracted_summary.ilike.${pat}`,
        `extracted_reference.ilike.${pat}`,
      );
    }
    const { data: docsData, error: docsErr } = await ctx.supabase
      .from('documents')
      .select(`
        id, gmail_message_id, file_name, mime_type, size_bytes, document_type,
        drive_file_id, drive_web_view_link, created_at,
        extracted_summary, extracted_amount_cents, extracted_currency,
        extracted_date, extracted_reference, extracted_expiry,
        email_action:email_actions(vendor, summary, reference, action_type)
      `)
      .eq('user_id', ctx.userId)
      .or(docsOr.join(','))
      .order('created_at', { ascending: false })
      .limit(ctx.limit);

    if (docsErr) {
      console.error('[drive-adapter] documents fetch error:', docsErr.message);
    }
    const docs = (docsData ?? []) as unknown as DocRow[];

    // Also pull documents whose LINKED email_action matches a variant (vendor,
    // summary, reference). Supabase .or() can't traverse an fk in one clause,
    // so we do a cheap second query via email_actions → document.
    const actionOr: string[] = [];
    for (const v of variants) {
      const pat = `%${v}%`;
      actionOr.push(
        `vendor.ilike.${pat}`,
        `summary.ilike.${pat}`,
        `reference.ilike.${pat}`,
      );
    }
    const { data: linkedActions } = await ctx.supabase
      .from('email_actions')
      .select('id, vendor, summary, reference, action_type')
      .eq('user_id', ctx.userId)
      .eq('dismissed', false)
      .or(actionOr.join(','))
      .limit(ctx.limit);
    const actionIds = (linkedActions ?? []).map((a: { id: string }) => a.id);

    let linkedDocs: DocRow[] = [];
    if (actionIds.length > 0) {
      const { data: ld } = await ctx.supabase
        .from('documents')
        .select(`
          id, gmail_message_id, file_name, mime_type, size_bytes, document_type,
          drive_file_id, drive_web_view_link, created_at,
          email_action:email_actions(vendor, summary, reference, action_type)
        `)
        .eq('user_id', ctx.userId)
        .in('email_action_id', actionIds)
        .limit(ctx.limit);
      linkedDocs = (ld ?? []) as unknown as DocRow[];
    }

    // Dedupe docs on id
    const docById = new Map<string, DocRow>();
    for (const d of [...docs, ...linkedDocs]) {
      if (d.id && !docById.has(d.id)) docById.set(d.id, d);
    }

    // ── Source 2 — live Google Drive API search ────────────────────────────
    let driveFiles: DriveFile[] = [];
    const { data: tokenRow } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();
    if (tokenRow?.refresh_token) {
      const accessToken = await getAccessToken(tokenRow.refresh_token);
      if (accessToken) {
        // Strip common English stop words and short tokens from each variant
        // so broad calendar/personal queries don't pull every document that
        // contains "week" or "about". If no signal-bearing terms remain,
        // skip the Drive API entirely.
        const filteredVariants = variants
          .map(filterStopWords)
          .filter(v => v.length > 0);
        const clauses: string[] = [];
        for (const v of filteredVariants) {
          const e = escapeForDriveQ(v);
          clauses.push(`fullText contains '${e}'`);
          clauses.push(`name contains '${e}'`);
        }
        if (clauses.length > 0) {
        const driveQ = `(${clauses.join(' or ')}) and trashed=false`;
        const url =
          `${DRIVE_FILES_URL}?q=${encodeURIComponent(driveQ)}` +
          `&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)` +
          `&pageSize=${ctx.limit * 2}`;
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (res.ok) {
            const data = await res.json();
            driveFiles = (data?.files ?? []) as DriveFile[];
          } else {
            console.warn('[drive-adapter] Drive fullText returned', res.status);
          }
        } catch (err) {
          console.error('[drive-adapter] Drive fullText error:', err);
        }
        } // end if (clauses.length > 0)
      }
    }

    // ── Merge ──────────────────────────────────────────────────────────────
    // Prefer documents-table rows when the same drive_file_id appears in
    // both sources — the documents row carries richer metadata.
    const seenDriveIds = new Set<string>();
    const hits: SearchResult[] = [];

    for (const d of docById.values()) {
      if (d.drive_file_id) seenDriveIds.add(d.drive_file_id);

      const ea = d.email_action;
      const fileNameLower = d.file_name.toLowerCase();
      const docType = (d.document_type ?? '').toLowerCase();
      const vendorLower = (ea?.vendor ?? '').toLowerCase();
      const summaryLower = (ea?.summary ?? '').toLowerCase();
      const referenceLower = (ea?.reference ?? '').toLowerCase();
      const extractedSummaryLower = (d.extracted_summary ?? '').toLowerCase();
      const extractedRefLower = (d.extracted_reference ?? '').toLowerCase();

      let score = 0.6;
      if (variants.some(v => fileNameLower.includes(v))) score = 0.95;
      else if (variants.some(v => vendorLower.includes(v))) score = 0.85;
      else if (variants.some(v => (referenceLower.includes(v) || extractedRefLower.includes(v)) && v.length >= 3)) score = 0.8;
      else if (variants.some(v => extractedSummaryLower.includes(v))) score = 0.75;
      else if (variants.some(v => summaryLower.includes(v))) score = 0.72;
      else if (variants.some(v => docType.includes(v))) score = 0.7;

      // Snippet prefers the PDF's own extracted summary when present — it
      // tends to be more specific than the email-body summary. Also surface
      // the structured extracted_date / amount / expiry so Claude has the
      // actual answer in the prompt without having to re-read the PDF
      // (voice channel can't attach PDFs to Claude calls; this lets the
      // voice answer include the same dates that mobile gets via the
      // PDF-attachment path in naavi-chat::fetchCalendarPdfBlock).
      const snippetBits: string[] = [];
      if (d.extracted_summary) {
        snippetBits.push(d.extracted_summary);
      } else {
        if (d.document_type) snippetBits.push(d.document_type);
        if (ea?.vendor)       snippetBits.push(ea.vendor);
        if (ea?.reference)    snippetBits.push(ea.reference);
      }
      if (d.extracted_date)   snippetBits.push(`key date ${formatHumanDate(d.extracted_date)}`);
      if (d.extracted_expiry) snippetBits.push(`expires ${formatHumanDate(d.extracted_expiry)}`);
      if (typeof d.extracted_amount_cents === 'number' && d.extracted_amount_cents > 0) {
        const amt = (d.extracted_amount_cents / 100).toFixed(2);
        snippetBits.push(`amount ${d.extracted_currency || ''}${amt}`.trim());
      }
      const snippet = snippetBits.filter(Boolean).join(', ') || (ea?.summary ?? '');

      hits.push({
        source: 'drive',
        title: d.file_name,
        snippet,
        score,
        createdAt: d.created_at ?? undefined,
        url: d.drive_web_view_link ?? undefined,
        metadata: {
          drive_file_id: d.drive_file_id,
          mime_type: d.mime_type,
          size_bytes: d.size_bytes,
          document_type: d.document_type,
          source_kind: 'harvested',
          icon: iconForMime(d.mime_type),
          gmail_message_id: d.gmail_message_id,
          vendor: ea?.vendor ?? null,
          action_type: ea?.action_type ?? null,
          reference: d.extracted_reference ?? ea?.reference ?? null,
          extracted_summary: d.extracted_summary ?? null,
          extracted_amount_cents: d.extracted_amount_cents ?? null,
          extracted_currency: d.extracted_currency ?? null,
          extracted_date: d.extracted_date ?? null,
          extracted_expiry: d.extracted_expiry ?? null,
        },
      });
    }

    // Look up documents rows for any live Drive hits — even when the docs
    // branch didn't match the query (e.g. extracted_summary too generic to
    // contain "first day of school"), the row may still hold structured
    // fields (extracted_date, document_type, extracted_summary) that turn
    // an empty-snippet live hit into a useful one. Without this, voice
    // channels that depend on snippet text get nothing actionable.
    const liveIdsNeedingEnrichment = driveFiles
      .map(f => f.id)
      .filter(id => !seenDriveIds.has(id));
    let liveDocMap = new Map<string, DocRow>();
    if (liveIdsNeedingEnrichment.length > 0) {
      const { data: liveDocs } = await ctx.supabase
        .from('documents')
        .select(`
          id, gmail_message_id, file_name, mime_type, size_bytes, document_type,
          drive_file_id, drive_web_view_link, created_at,
          extracted_summary, extracted_amount_cents, extracted_currency,
          extracted_date, extracted_reference, extracted_expiry,
          email_action:email_actions(vendor, summary, reference, action_type)
        `)
        .eq('user_id', ctx.userId)
        .in('drive_file_id', liveIdsNeedingEnrichment);
      for (const d of (liveDocs ?? []) as unknown as DocRow[]) {
        if (d.drive_file_id) liveDocMap.set(d.drive_file_id, d);
      }
    }

    for (const f of driveFiles) {
      if (seenDriveIds.has(f.id)) continue; // already covered by harvested row
      const nameLower = f.name.toLowerCase();

      // Two scoring tiers — name match is high-confidence, body-only match is
      // lower-confidence-but-still-useful. An earlier version dropped body-only
      // hits outright to kill a condo-AGM false-positive on the word "warranty",
      // but that also dropped legitimate hits like "first day" inside a PDF
      // named "2025-2026 School Calendar". Let Claude apply a relevance check
      // against the title at presentation time (prompt rule v15+) instead —
      // it suppresses the junk without starving the useful matches.
      const nameHit = variants.some(v => nameLower.includes(v));
      const score = nameHit ? 0.85 : 0.55;

      // If this live-Drive file is also in our documents table, enrich the
      // snippet with extracted fields so voice/text Claude can answer with
      // the actual date / amount instead of just "I have a PDF in your Drive".
      const enrich = liveDocMap.get(f.id);
      const enrichBits: string[] = [];
      if (enrich) {
        if (enrich.extracted_summary)  enrichBits.push(enrich.extracted_summary);
        else if (enrich.document_type) enrichBits.push(enrich.document_type);
        if (enrich.extracted_date)     enrichBits.push(`key date ${formatHumanDate(enrich.extracted_date)}`);
        if (enrich.extracted_expiry)   enrichBits.push(`expires ${formatHumanDate(enrich.extracted_expiry)}`);
        if (typeof enrich.extracted_amount_cents === 'number' && enrich.extracted_amount_cents > 0) {
          const amt = (enrich.extracted_amount_cents / 100).toFixed(2);
          enrichBits.push(`amount ${enrich.extracted_currency || ''}${amt}`.trim());
        }
      }
      const enrichedSnippet = enrichBits.filter(Boolean).join(', ');

      hits.push({
        source: 'drive',
        title: f.name,
        snippet: enrichedSnippet,
        score,
        createdAt: f.modifiedTime,
        url: f.webViewLink,
        metadata: {
          drive_file_id: f.id,
          mime_type: f.mimeType,
          size_bytes: f.size ? Number(f.size) : null,
          document_type: enrich?.document_type ?? undefined,
          source_kind: enrich ? 'drive_live_enriched' : 'drive_live',
          icon: iconForMime(f.mimeType),
          extracted_date: enrich?.extracted_date ?? null,
          extracted_expiry: enrich?.extracted_expiry ?? null,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
