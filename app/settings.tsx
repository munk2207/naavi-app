/**
 * Settings screen
 *
 * Robert controls his preferences here:
 * - His name (used to auto-label conversation transcripts)
 * - Anthropic API key (entered once, stored securely)
 * - Provider selection (calendar, email, storage, maps)
 * - Connected services status
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { saveApiKey, getApiKey, hasApiKey, saveUserName, getUserName } from '@/lib/naavi-client';
import { isCalendarConnected, connectGoogleCalendar, disconnectGoogleCalendar } from '@/lib/calendar';
import { saveNotionToken, getNotionToken, removeNotionToken, hasNotionToken } from '@/lib/notion';
import { isEpicConnected, connectEpic, disconnectEpic } from '@/lib/epic';
import { registry } from '@/lib/adapters/registry';
import type { UserProfile } from '@/lib/types';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

// ─── Provider options ─────────────────────────────────────────────────────────

const CALENDAR_PROVIDERS: Array<{ value: UserProfile['defaultCalendarProvider']; label: string; phase?: string }> = [
  { value: 'google',  label: 'Google Calendar' },
  { value: 'outlook', label: 'Outlook',         phase: 'Phase 8' },
  { value: 'apple',   label: 'Apple Calendar',  phase: 'Phase 8' },
];

const EMAIL_PROVIDERS: Array<{ value: UserProfile['defaultEmailProvider']; label: string; phase?: string }> = [
  { value: 'gmail',   label: 'Gmail' },
  { value: 'outlook', label: 'Outlook',         phase: 'Phase 8' },
];

const STORAGE_PROVIDERS: Array<{ value: UserProfile['defaultStorageProvider']; label: string; phase?: string }> = [
  { value: 'gdrive',   label: 'Google Drive' },
  { value: 'onedrive', label: 'OneDrive',    phase: 'Phase 8' },
  { value: 'dropbox',  label: 'Dropbox',     phase: 'Phase 8' },
];

const MAPS_PROVIDERS: Array<{ value: UserProfile['defaultMapsProvider']; label: string; phase?: string }> = [
  { value: 'google_maps', label: 'Google Maps' },
  { value: 'apple_maps',  label: 'Apple Maps', phase: 'Phase 8' },
  { value: 'waze',        label: 'Waze',        phase: 'Phase 8' },
];

// ─── Provider chip component ──────────────────────────────────────────────────

function ProviderChip({
  label,
  active,
  phase,
  onPress,
}: {
  label: string;
  active: boolean;
  phase?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive, !!phase && styles.chipDisabled]}
      onPress={!phase ? onPress : undefined}
      disabled={!!phase}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled: !!phase }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
      {phase && <Text style={styles.chipPhase}>{phase}</Text>}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [userName, setUserName]           = useState('');
  const [userNameSaved, setUserNameSaved] = useState(false);
  const [apiKey, setApiKey]               = useState('');
  const [apiKeySet, setApiKeySet]         = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarLoading, setCalendarLoading]     = useState(false);
  const [notionToken, setNotionToken]             = useState('');
  const [notionConnected, setNotionConnected]     = useState(false);
  const [epicConnected, setEpicConnected]         = useState(false);
  const [epicLoading, setEpicLoading]             = useState(false);

  // Provider selections — all default to Google for Phase 7
  const [calendarProvider, setCalendarProvider] =
    useState<UserProfile['defaultCalendarProvider']>('google');
  const [emailProvider, setEmailProvider] =
    useState<UserProfile['defaultEmailProvider']>('gmail');
  const [storageProvider, setStorageProvider] =
    useState<UserProfile['defaultStorageProvider']>('gdrive');
  const [mapsProvider, setMapsProvider] =
    useState<UserProfile['defaultMapsProvider']>('google_maps');

  // ── Load saved state ────────────────────────────────────────────────────────

  useEffect(() => {
    hasApiKey().then(setApiKeySet);
    isCalendarConnected().then(setCalendarConnected);
    hasNotionToken().then(setNotionConnected);
    isEpicConnected().then(setEpicConnected);
    const saved = getUserName();
    if (saved) { setUserName(saved); setUserNameSaved(true); }
  }, []);

  // Keep registry in sync whenever provider selections change
  useEffect(() => {
    registry.setProfile({
      defaultCalendarProvider: calendarProvider,
      defaultEmailProvider:    emailProvider,
      defaultStorageProvider:  storageProvider,
      defaultMapsProvider:     mapsProvider,
      language:                'en',
    });
  }, [calendarProvider, emailProvider, storageProvider, mapsProvider]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleSaveApiKey() {
    const key = apiKey.trim();
    if (!key.startsWith('sk-ant-')) {
      Alert.alert(
        'Invalid key',
        'Anthropic API keys start with "sk-ant-". Please check and try again.'
      );
      return;
    }
    await saveApiKey(key);
    setApiKeySet(true);
    setApiKey('');
    Alert.alert('Saved', 'API key saved securely.');
  }

  async function handleSaveNotionToken() {
    const token = notionToken.trim();
    if (!token) return;
    await saveNotionToken(token);
    setNotionConnected(true);
    setNotionToken('');
    Alert.alert('Connected', 'Notion integration token saved.');
  }

  async function handleDisconnectNotion() {
    await removeNotionToken();
    setNotionConnected(false);
    Alert.alert('Disconnected', 'Notion token removed.');
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* Your Name */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Name</Text>
          <Text style={styles.sectionNote}>
            {userNameSaved
              ? `Saved as "${userName}". Naavi will auto-label you in every conversation.`
              : 'Enter your name once — Naavi will recognize you in all conversations automatically.'}
          </Text>
          <TextInput
            style={styles.keyInput}
            value={userName}
            onChangeText={setUserName}
            placeholder="e.g. Robert"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Your name"
          />
          <TouchableOpacity
            style={[styles.saveBtn, !userName.trim() && styles.saveBtnDisabled]}
            onPress={() => {
              const name = userName.trim();
              if (!name) return;
              saveUserName(name);
              setUserNameSaved(true);
            }}
            disabled={!userName.trim()}
          >
            <Text style={styles.saveBtnText}>Save name</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Providers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Providers</Text>
          <Text style={styles.sectionNote}>
            Naavi routes through whichever provider you select. Additional providers unlock in Phase 8.
          </Text>

          <ProviderRow label="Calendar">
            {CALENDAR_PROVIDERS.map(p => (
              <ProviderChip
                key={p.value}
                label={p.label}
                active={calendarProvider === p.value}
                phase={p.phase}
                onPress={() => setCalendarProvider(p.value)}
              />
            ))}
          </ProviderRow>

          <ProviderRow label="Email">
            {EMAIL_PROVIDERS.map(p => (
              <ProviderChip
                key={p.value}
                label={p.label}
                active={emailProvider === p.value}
                phase={p.phase}
                onPress={() => setEmailProvider(p.value)}
              />
            ))}
          </ProviderRow>

          <ProviderRow label="Storage">
            {STORAGE_PROVIDERS.map(p => (
              <ProviderChip
                key={p.value}
                label={p.label}
                active={storageProvider === p.value}
                phase={p.phase}
                onPress={() => setStorageProvider(p.value)}
              />
            ))}
          </ProviderRow>

          <ProviderRow label="Maps">
            {MAPS_PROVIDERS.map(p => (
              <ProviderChip
                key={p.value}
                label={p.label}
                active={mapsProvider === p.value}
                phase={p.phase}
                onPress={() => setMapsProvider(p.value)}
              />
            ))}
          </ProviderRow>
        </View>

        <View style={styles.divider} />

        {/* Connected services */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connected Services</Text>

          {/* Calendar */}
          <View style={styles.toolRow}>
            <View>
              <Text style={styles.toolLabel}>Calendar</Text>
              <Text style={styles.toolStatus}>
                {calendarConnected ? 'Connected — real events in brief' : 'Not connected'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.connectBtn, calendarConnected && styles.connectBtnActive]}
              disabled={calendarLoading}
              onPress={async () => {
                if (calendarLoading) return;
                setCalendarLoading(true);
                try {
                  if (calendarConnected) {
                    await disconnectGoogleCalendar();
                    setCalendarConnected(false);
                  } else {
                    await connectGoogleCalendar();
                    setCalendarConnected(true);
                  }
                } finally {
                  setCalendarLoading(false);
                }
              }}
            >
              <Text style={styles.connectBtnText}>
                {calendarLoading ? '...' : calendarConnected ? 'Disconnect' : 'Connect'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Notion */}
          <View style={styles.toolRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.toolLabel}>Notion</Text>
              <Text style={styles.toolStatus}>
                {notionConnected ? 'Connected — pages searched for context' : 'Paste your integration token below'}
              </Text>
            </View>
            {notionConnected && (
              <TouchableOpacity
                style={[styles.connectBtn, styles.connectBtnActive]}
                onPress={handleDisconnectNotion}
              >
                <Text style={styles.connectBtnText}>Disconnect</Text>
              </TouchableOpacity>
            )}
          </View>
          {!notionConnected && (
            <View style={{ marginBottom: 8 }}>
              <TextInput
                style={styles.keyInput}
                value={notionToken}
                onChangeText={setNotionToken}
                placeholder="secret_..."
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.saveBtn, !notionToken.trim() && styles.saveBtnDisabled]}
                onPress={handleSaveNotionToken}
                disabled={!notionToken.trim()}
              >
                <Text style={styles.saveBtnText}>Connect Notion</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* MyChart (Epic FHIR) */}
          <View style={styles.toolRow}>
            <View>
              <Text style={styles.toolLabel}>MyChart (Health Records)</Text>
              <Text style={styles.toolStatus}>
                {epicConnected
                  ? 'Connected — medications, appointments & vitals in brief'
                  : 'Connect your Epic MyChart to share health records with Naavi'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.connectBtn, epicConnected && styles.connectBtnActive]}
              disabled={epicLoading}
              onPress={async () => {
                if (epicLoading) return;
                setEpicLoading(true);
                try {
                  if (epicConnected) {
                    disconnectEpic();
                    setEpicConnected(false);
                  } else {
                    await connectEpic();
                    // page will redirect to Epic; status updates on return via isEpicConnected
                  }
                } finally {
                  setEpicLoading(false);
                }
              }}
            >
              <Text style={styles.connectBtnText}>
                {epicLoading ? '...' : epicConnected ? 'Disconnect' : 'Connect'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Coming soon */}
          {[
            { label: 'Health Wearables' },
            { label: 'Smart Home' },
          ].map(tool => (
            <View key={tool.label} style={styles.toolRow}>
              <Text style={styles.toolLabel}>{tool.label}</Text>
              <Text style={styles.comingSoon}>Phase 8</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* API key */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anthropic API Key</Text>
          <Text style={styles.sectionNote}>
            {apiKeySet
              ? 'Key is saved. Enter a new one below to replace it.'
              : 'Enter your API key to enable Naavi. Get one at console.anthropic.com.'}
          </Text>
          <TextInput
            style={styles.keyInput}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-ant-..."
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Anthropic API key input"
          />
          <TouchableOpacity
            style={[styles.saveBtn, !apiKey.trim() && styles.saveBtnDisabled]}
            onPress={handleSaveApiKey}
            disabled={!apiKey.trim()}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>Save key</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Version */}
        <Text style={styles.version}>Naavi — Phase 7 build</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── ProviderRow wrapper ──────────────────────────────────────────────────────

function ProviderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.providerRow}>
      <Text style={styles.providerRowLabel}>{label}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  sectionNote: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 22,
  },
  keyInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: Typography.touchTargetIdeal,
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: Colors.textOnDark,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: 24,
  },
  // ── Provider section
  providerRow: {
    marginBottom: 16,
  },
  providerRowLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  chipTextActive: {
    color: Colors.textOnDark,
    fontWeight: Typography.semibold,
  },
  chipPhase: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  // ── Connected tools
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: Typography.touchTargetIdeal,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    paddingVertical: 8,
  },
  toolLabel: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  toolStatus: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: 2,
  },
  comingSoon: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  connectBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
    justifyContent: 'center',
  },
  connectBtnActive: {
    backgroundColor: Colors.error,
  },
  connectBtnText: {
    color: Colors.textOnDark,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  version: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
