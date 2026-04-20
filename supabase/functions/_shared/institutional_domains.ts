/**
 * Institutional sender domain list. Senders worth Robert's attention even
 * when not in his personal contacts — government, banks, insurance,
 * utilities, telecoms, healthcare, couriers.
 *
 * Matching rules:
 *   - Entries starting with '.' are suffix matches (e.g., '.gc.ca' matches
 *     cra.gc.ca AND servicecanada.gc.ca).
 *   - Entries without leading '.' match the full domain OR any subdomain
 *     (e.g., 'rbc.com' matches rbc.com and email.rbc.com).
 *
 * Canada-centric seed (Wael / Robert are in Ontario). Extend as Robert
 * encounters new institutional senders. For anything this list misses,
 * extract-email-actions (Claude) also classifies sender_type per email and
 * writes back to signal_strength = 'institutional' post-hoc.
 */

export const INSTITUTIONAL_DOMAINS: string[] = [
  // Canadian government
  '.gc.ca',
  '.canada.ca',
  'cra-arc.gc.ca',
  'servicecanada.gc.ca',
  'cic.gc.ca',
  'ontario.ca',
  'ottawa.ca',
  '.gov.on.ca',

  // US government (dual citizens / snowbirds)
  '.gov',
  '.mil',

  // Canadian banks
  'rbc.com',
  'rbcroyalbank.com',
  'td.com',
  'tdcanadatrust.com',
  'scotiabank.com',
  'bmo.com',
  'cibc.com',
  'nationalbank.ca',
  'tangerine.ca',
  'simplii.com',
  'desjardins.com',

  // Insurance
  'manulife.com',
  'manulife.ca',
  'sunlife.ca',
  'sunlife.com',
  'tdinsurance.com',
  'intact.ca',
  'intactinsurance.com',
  'belairdirect.com',
  'cooperators.ca',
  'squareone.ca',
  'aviva.ca',
  'economical.com',

  // Utilities & telecom
  'hydroone.com',
  'enbridge.com',
  'enbridgegas.com',
  'bell.ca',
  'rogers.com',
  'telus.com',
  'telus.net',
  'shaw.ca',
  'videotron.com',
  'fido.ca',
  'koodomobile.com',

  // Canada Post
  'canadapost.ca',
  'canadapost-postescanada.ca',

  // Healthcare (partial; add per user as learned)
  'ontariohealth.ca',
  'ehealthontario.ca',
];

export function isInstitutionalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const atIdx = lower.lastIndexOf('@');
  if (atIdx < 0) return false;
  const domain = lower.slice(atIdx + 1);
  for (const entry of INSTITUTIONAL_DOMAINS) {
    const d = entry.toLowerCase();
    if (d.startsWith('.')) {
      if (domain === d.slice(1) || domain.endsWith(d)) return true;
    } else {
      if (domain === d || domain.endsWith('.' + d)) return true;
    }
  }
  return false;
}
