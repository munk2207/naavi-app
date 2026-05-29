/**
 * Deterministic SHA-256 hash for community member contact data.
 *
 * Input: the contact_data object stored in community_members
 *   { names: [...], emailAddresses: [...], phoneNumbers: [...] }
 *
 * Keys are sorted recursively before stringifying so the hash is identical
 * regardless of JSON key order returned by the People API. No field values
 * are modified — the raw API arrays are hashed as-is.
 *
 * The same personFields query ("names,emailAddresses,phoneNumbers") MUST be
 * used at write-time and at refresh-time to guarantee the input structure
 * is identical on both sides.
 */

function sortKeysRecursive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysRecursive);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysRecursive((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export async function computeContactHash(contactData: object): Promise<string> {
  const canonical = JSON.stringify(sortKeysRecursive(contactData));
  const encoded   = new TextEncoder().encode(canonical);
  const hashBuf   = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Fields requested from People API — must be identical at write and refresh.
export const COMMUNITY_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers';
