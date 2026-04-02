/**
 * Google Email Adapter (Gmail)
 *
 * Implements EmailAdapter using the existing gmail.ts lib functions.
 * Maps Gmail-specific data into the normalized Email type.
 */

import {
  fetchImportantEmails as gmailFetchImportant,
  fetchEmailsFromPerson as gmailFetchFromPerson,
  sendEmail as gmailSend,
  triggerGmailSync,
  type GmailMessageRow,
} from '../../../lib/gmail';

import type { EmailAdapter } from '../interfaces';
import type { Email, EmailDraft } from '../../types';

// ─── Mapping ──────────────────────────────────────────────────────────────────

function rawToEmail(raw: GmailMessageRow): Email {
  return {
    id:          `email_${raw.gmail_message_id}`,
    from: {
      name:  raw.sender_name  ?? '',
      email: raw.sender_email ?? '',
    },
    to:          [],
    subject:     raw.subject    ?? '',
    bodyText:    raw.snippet    ?? '',
    summary:     raw.snippet    ?? '',
    isImportant: raw.is_important ?? false,
    isRead:      !raw.is_unread,
    receivedAt:  raw.received_at ?? new Date().toISOString(),
    threadId:    undefined,
    provider:    'gmail',
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleEmailAdapter implements EmailAdapter {

  async fetchImportant(userId: string): Promise<Email[]> {
    const rows = await gmailFetchImportant(userId);
    return rows.map(rawToEmail);
  }

  async fetchFromPerson(name: string, userId: string): Promise<Email[]> {
    const raw = await gmailFetchFromPerson(name, userId);
    return raw.map(r => ({
      id:          `email_${Date.now()}`,
      from:        { name: r.sender_name ?? '', email: r.sender_email ?? '' },
      to:          [],
      subject:     r.subject    ?? '',
      bodyText:    r.snippet    ?? '',
      summary:     r.snippet    ?? '',
      isImportant: false,
      isRead:      !r.is_unread,
      receivedAt:  r.received_at ?? new Date().toISOString(),
      provider:    'gmail' as const,
    }));
  }

  async send(draft: EmailDraft): Promise<{ success: boolean; error?: string }> {
    const to = draft.to[0];
    return gmailSend({
      to:      to.email,
      toName:  to.name,
      subject: draft.subject,
      body:    draft.body,
    });
  }

  async sync(userId: string): Promise<void> {
    await triggerGmailSync();
  }
}
