/**
 * Google Contact Adapter
 *
 * Implements ContactAdapter using the existing contacts.ts lib functions.
 * Maps Google Contacts / Naavi contact data into the normalized Contact type.
 */

import {
  lookupContact as googleLookup,
} from '../../../lib/contacts';
import {
  saveContact as supabaseSave,
  supabase,
} from '../../../lib/supabase';

import type { ContactAdapter } from '../interfaces';
import type { Contact } from '../../types';

// ─── Mapping ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawToContact(raw: any): Contact {
  return {
    id:           `contact_${raw.id ?? raw.resourceName ?? Date.now()}`,
    name:         raw.name          ?? '',
    email:        raw.email         ?? undefined,
    phone:        raw.phone         ?? undefined,
    relationship: raw.relationship  ?? undefined,
    photoUrl:     raw.photoUrl      ?? raw.photo_url ?? undefined,
    provider:     'google',
    providerContactId: raw.resourceName ?? raw.id ?? undefined,
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleContactAdapter implements ContactAdapter {

  async lookup(name: string): Promise<Contact | null> {
    const raw = await googleLookup(name);
    if (!raw) return null;
    return rawToContact(raw);
  }

  async save(contact: Partial<Contact>): Promise<Contact> {
    // Save to Naavi's own database
    await supabaseSave({
      name:         contact.name         ?? '',
      email:        contact.email        ?? '',
      phone:        contact.phone        ?? '',
      relationship: contact.relationship ?? '',
    });

    // Also save to Google Contacts via Edge Function
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('create-contact', {
          body: {
            name:  contact.name  ?? '',
            email: contact.email ?? '',
            phone: contact.phone ?? '',
          },
        });
        if (error) {
          console.error('[GoogleContactAdapter] Failed to create Google Contact:', error.message);
        } else {
          console.log('[GoogleContactAdapter] Google Contact created:', data?.resourceName);
        }
      } catch (err) {
        console.error('[GoogleContactAdapter] create-contact error:', err);
      }
    }

    return {
      id:           `contact_${Date.now()}`,
      name:         contact.name  ?? '',
      email:        contact.email,
      phone:        contact.phone,
      relationship: contact.relationship,
      provider:     'google',
    };
  }

  async search(query: string): Promise<Contact[]> {
    // Current implementation: single lookup by name
    // Expand to full search when Google People API search endpoint is added
    const result = await this.lookup(query);
    return result ? [result] : [];
  }
}
