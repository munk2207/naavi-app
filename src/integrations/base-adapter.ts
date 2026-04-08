/**
 * Naavi — Base Adapter
 *
 * Every integration adapter extends this class.
 * It enforces the four-method contract and handles shared concerns:
 * SQLite cache reads/writes, status tracking, and error logging.
 *
 * Nothing outside this file should write directly to SQLite —
 * adapters use the protected helpers below.
 */

import type { IntegrationId, IntegrationMeta, IntegrationStatus } from '../../schema/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE INTERFACE
// Abstracted so we can swap SQLite implementations without touching adapters.
// In production: Expo SQLite. In tests: in-memory mock.
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalDB {
  get(table: string, key: string): Promise<unknown>;
  set(table: string, key: string, value: unknown, expiresAt?: Date): Promise<void>;
  delete(table: string, key: string): Promise<void>;
  getMany(table: string, predicate: Record<string, unknown>): Promise<unknown[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN STORE INTERFACE
// Abstracted so OAuth tokens are managed through Supabase, not SQLite.
// Tokens are sensitive — they live in the cloud store, encrypted at rest.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenStore {
  getToken(integrationId: IntegrationId): Promise<OAuthToken | null>;
  saveToken(integrationId: IntegrationId, token: OAuthToken): Promise<void>;
  deleteToken(integrationId: IntegrationId): Promise<void>;
}

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: string;           // ISO datetime
  scope: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC RESULT — returned by every sync() call
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  integration_id: IntegrationId;
  success: boolean;
  records_updated: number;
  synced_at: string;            // ISO datetime
  error?: SyncError;
}

export interface SyncError {
  type: 'auth' | 'network' | 'api_error' | 'parse_error' | 'unknown';
  message: string;              // Human-readable, for logging
  retryable: boolean;
  http_status?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseAdapter {
  protected readonly integrationId: IntegrationId;
  protected readonly db: LocalDB;
  protected readonly tokenStore: TokenStore;
  protected readonly staleThresholdMinutes: number;

  constructor(
    integrationId: IntegrationId,
    db: LocalDB,
    tokenStore: TokenStore,
    staleThresholdMinutes: number,
  ) {
    this.integrationId = integrationId;
    this.db = db;
    this.tokenStore = tokenStore;
    this.staleThresholdMinutes = staleThresholdMinutes;
  }

  // ── Abstract methods — each adapter must implement these ──────────────────

  /**
   * One-time setup: handles OAuth consent flow or API key storage.
   * Returns true if connection was established successfully.
   */
  abstract connect(): Promise<boolean>;

  /**
   * Fetch fresh data from the external API and write to SQLite.
   * Called by the sync scheduler — never during a conversation.
   */
  abstract sync(): Promise<SyncResult>;

  /**
   * Return normalised data from SQLite.
   * Must never make a network call.
   */
  abstract read(): Promise<unknown>;

  // ── Shared methods — available to all adapters ────────────────────────────

  async status(): Promise<IntegrationMeta> {
    const meta = await this.db.get('integration_meta', this.integrationId) as IntegrationMeta | null;
    if (!meta) {
      return {
        id: this.integrationId,
        status: 'disconnected',
        last_synced_at: null,
        stale_threshold_minutes: this.staleThresholdMinutes,
      };
    }
    return meta;
  }

  /**
   * Check if the current token is valid and refresh it if it is about to expire.
   * Called at the start of every sync(). Returns false if auth is broken.
   */
  protected async ensureValidToken(): Promise<boolean> {
    const token = await this.tokenStore.getToken(this.integrationId);
    if (!token) return false;

    const expiresAt = new Date(token.expires_at);
    const oneMinuteFromNow = new Date(Date.now() + 60_000);

    if (expiresAt <= oneMinuteFromNow) {
      return await this.refreshToken(token);
    }

    return true;
  }

  /**
   * Exchange a refresh token for a new access token.
   * Each OAuth adapter overrides this with provider-specific logic.
   */
  protected async refreshToken(_token: OAuthToken): Promise<boolean> {
    // Default: adapters that don't use OAuth (weather, Apple Health) override this to return true
    return false;
  }

  protected async updateStatus(
    status: IntegrationStatus,
    error_message?: string,
  ): Promise<void> {
    const meta: IntegrationMeta = {
      id: this.integrationId,
      status,
      last_synced_at: status === 'connected' ? new Date().toISOString() : null,
      stale_threshold_minutes: this.staleThresholdMinutes,
      error_message,
    };
    await this.db.set('integration_meta', this.integrationId, meta);
  }

  protected buildSyncError(
    type: SyncError['type'],
    message: string,
    retryable: boolean,
    http_status?: number,
  ): SyncError {
    return { type, message, retryable, http_status };
  }

  protected failedSync(error: SyncError): SyncResult {
    return {
      integration_id: this.integrationId,
      success: false,
      records_updated: 0,
      synced_at: new Date().toISOString(),
      error,
    };
  }

  protected successfulSync(records_updated: number): SyncResult {
    return {
      integration_id: this.integrationId,
      success: true,
      records_updated,
      synced_at: new Date().toISOString(),
    };
  }
}
