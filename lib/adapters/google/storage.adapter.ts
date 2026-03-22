/**
 * Google Storage Adapter (Google Drive)
 *
 * Implements StorageAdapter using the existing drive.ts lib functions.
 * Maps Google Drive file data into the normalized StorageFile type.
 */

import {
  searchDriveFiles as googleSearch,
  saveToDrive as googleSave,
  sendDriveFileAsEmail as googleSendAttachment,
} from '../../../lib/drive';

import type { StorageAdapter } from '../interfaces';
import type { StorageFile } from '../../types';

// ─── MIME type label map ──────────────────────────────────────────────────────

const MIME_LABELS: Record<string, string> = {
  'application/vnd.google-apps.document':     'Google Doc',
  'application/vnd.google-apps.spreadsheet':  'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.folder':       'Folder',
  'application/pdf':                          'PDF',
  'application/msword':                       'Word',
  'text/plain':                               'Text file',
  'image/jpeg':                               'Image',
  'image/png':                                'Image',
};

function mimeLabel(mimeType: string): string {
  return MIME_LABELS[mimeType] ?? 'File';
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawToStorageFile(raw: any): StorageFile {
  return {
    id:               raw.id           ?? '',
    name:             raw.name         ?? '',
    mimeType:         raw.mimeType     ?? '',
    mimeTypeLabel:    mimeLabel(raw.mimeType ?? ''),
    webViewLink:      raw.webViewLink  ?? '',
    modifiedAt:       raw.modifiedTime ?? new Date().toISOString(),
    parentFolderId:   raw.parentFolderId   ?? undefined,
    parentFolderName: raw.parentFolderName ?? undefined,
    provider:         'gdrive',
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleStorageAdapter implements StorageAdapter {

  async search(query: string, _userId: string): Promise<StorageFile[]> {
    const raw = await googleSearch(query);
    return raw.map(rawToStorageFile);
  }

  async save(title: string, content: string, _userId: string): Promise<StorageFile> {
    const result = await googleSave({ title, content });
    return {
      id:            result.fileId      ?? `gdrive_${Date.now()}`,
      name:          title,
      mimeType:      'application/vnd.google-apps.document',
      mimeTypeLabel: 'Google Doc',
      webViewLink:   result.webViewLink ?? '',
      modifiedAt:    new Date().toISOString(),
      provider:      'gdrive',
    };
  }

  async sendAsEmailAttachment(params: {
    fileId: string;
    fileName: string;
    mimeType: string;
    to: string;
  }): Promise<{ success: boolean; error?: string }> {
    return googleSendAttachment(params);
  }
}
