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
} from '../../../lib/gmail';

import type { EmailAdapter } from '../interfaces';
import type { Email, EmailDraft } from '../../types';

// ─── Mapping ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawToEmail(raw: any): Email {
  return {
    id:          `email_${raw.id ?? raw.message_id ?? Date.now()}`,
    from: {
      name:  raw.sender_name  ?? raw.from_name  ?? '',
      email: raw.sender_email ?? raw.from_email ?? '',
    },
    to: raw.to
      ? (Array.isArray(raw.to) ? raw.to : [{ name: '', email: raw.to }])
      : [],
    subject:     raw.subject    ?? '',
    bodyText:    raw.body_text  ?? raw.body ?? raw.snippet ?? '',
    summary:     raw.summary    ?? raw.snippet ?? '',
    isImportant: raw.is_important ?? raw.important ?? false,
    isRead:      raw.is_read    ?? raw.read ?? false,
    receivedAt:  raw.received_at ?? raw.date ?? new Date().toISOString(),
    threadId:    raw.thread_id,
    provider:    'gmail',
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleEmailAdapter implements EmailAdapter {

  async fetchImportant(userId: string): Promise<Email[]> {
    const raw = await gmailFetchImportant(userId);
    return raw.map(rawToEmail);
  }

  async fetchFromPerson(name: string, userId: string): Promise<Email[]> {
    const raw = await gmailFetchFromPerson(name, userId);
    return raw.map(rawToEmail);
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
