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
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { saveApiKey, getApiKey, hasApiKey, saveUserName, getUserNameAsync, syncUserNameToSupabase } from '@/lib/naavi-client';
import { isVoiceEnabledSync, refreshVoicePref, setVoicePref } from '@/lib/voicePref';
import { signOut, supabase } from '@/lib/supabase';
import { queryWithTimeout } from '@/lib/invokeWithTimeout';
import { isCalendarConnected, connectGoogleCalendar, disconnectGoogleCalendar } from '@/lib/calendar';
import { saveNotionToken, getNotionToken, removeNotionToken, hasNotionToken } from '@/lib/notion';
import { isEpicConnected, connectEpic, disconnectEpic } from '@/lib/epic';
import { registerPushNotifications } from '@/lib/push';
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
  const router = useRouter();
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
  const [pushEnabled, setPushEnabled]             = useState(false);
  const [pushLoading, setPushLoading]             = useState(false);
  const [voicePlayback, setVoicePlayback]         = useState(true);
  const [morningCallEnabled, setMorningCallEnabled] = useState(true);
  const [morningCallTime, setMorningCallTime]       = useState('08:00');
  const [morningCallLoading, setMorningCallLoading] = useState(false);
  const [phone, setPhone]                           = useState('');
  const [phoneSaved, setPhoneSaved]                 = useState(false);
  const [phoneLoading, setPhoneLoading]             = useState(false);
  const [homeAddress, setHomeAddress]               = useState('');
  const [homeAddressLoading, setHomeAddressLoading] = useState(false);
  const [workAddress, setWorkAddress]               = useState('');
  const [workAddressLoading, setWorkAddressLoading] = useState(false);

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

  // V57.10.0 — re-check Google connection state every time the Settings
  // screen comes back to the foreground. Without this, the calendarConnected
  // boolean is set ONCE on mount; a transient JWT-refresh race during a
  // foreground transition (e.g. after the user grants "Allow all the time"
  // location and returns to the app) can leave calendarConnected = false
  // forever, displaying "Not connected" even though the row is intact.
  // Diagnostic V57.9.9 captured this on 2026-05-01 — user_tokens row was
  // briefly invisible for ~1 s, never re-checked, UI stayed stale.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        isCalendarConnected().then(setCalendarConnected).catch(() => {});
        isEpicConnected().then(setEpicConnected).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    hasApiKey().then(setApiKeySet);
    isCalendarConnected().then(setCalendarConnected);
    hasNotionToken().then(setNotionConnected);
    isEpicConnected().then(setEpicConnected);
    // Name: read local cache first for instant display, then prefer Supabase
    // (server is canonical). Fixes build 93 regression where getUserName()
    // returned '' on native and the field came up empty.
    (async () => {
      const cached = await getUserNameAsync();
      if (cached) { setUserName(cached); setUserNameSaved(true); }
    })();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
    // Voice playback preference — Supabase-backed, falls back to AsyncStorage.
    refreshVoicePref().then(setVoicePlayback);
    // Load user-scoped settings from Supabase (name + morning call + phone).
    // Server value wins over SecureStore for name — prevents a stale cached
    // name from a previous Google account leaking into the current session.
    if (supabase) {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await queryWithTimeout(
          supabase
            .from('user_settings')
            .select('name, morning_call_enabled, morning_call_time, phone, home_address, work_address')
            .eq('user_id', user.id)
            .maybeSingle(),
          15_000,
          'load-user-settings',
        );
        if (data) {
          if (data.name) {
            setUserName(data.name);
            setUserNameSaved(true);
            // Overwrite local cache so next app-open reads the fresh value.
            saveUserName(data.name);
          }
          if (data.morning_call_enabled !== null && data.morning_call_enabled !== undefined) {
            setMorningCallEnabled(data.morning_call_enabled);
          }
          if (data.morning_call_time) {
            setMorningCallTime(String(data.morning_call_time).substring(0, 5));
          }
          if (data.phone) {
            setPhone(data.phone);
            setPhoneSaved(true);
          }
          if (data.home_address) setHomeAddress(String(data.home_address));
          if (data.work_address) setWorkAddress(String(data.work_address));
        }
      })();
    }
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

  async function handleSaveMorningCall() {
    if (!supabase) return;
    setMorningCallLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMorningCallLoading(false); return; }
      await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id: user.id,
          morning_call_enabled: morningCallEnabled,
          morning_call_time: morningCallTime,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-morning-call',
      );
      Alert.alert('Saved', `Morning call ${morningCallEnabled ? `set for ${morningCallTime}` : 'disabled'}.`);
    } catch (err) {
      Alert.alert('Error', 'Could not save morning call settings.');
    }
    setMorningCallLoading(false);
  }

  async function handleSavePhone() {
    const raw = phone.trim().replace(/[\s\-\(\)]/g, '');
    // E.164 — plus sign, country code, up to 15 digits total (per ITU spec).
    // We require at least 10 digits after the plus.
    if (!/^\+\d{10,15}$/.test(raw)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return;
    }
    if (!supabase) return;
    setPhoneLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPhoneLoading(false); return; }
      const { error } = await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id: user.id,
          phone: raw,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-user-phone',
      );
      if (error) throw error;
      setPhone(raw);
      setPhoneSaved(true);
      Alert.alert(
        'Saved',
        'Phone number saved. Naavi will call this number for your morning brief, and will recognize you when you call back.'
      );
    } catch (err) {
      Alert.alert('Error', 'Could not save phone number. Please try again.');
    }
    setPhoneLoading(false);
  }

  async function handleSaveNotionToken() {
    const token = notionToken.trim();
    if (!token) return;
    await saveNotionToken(token);
    setNotionConnected(true);
    setNotionToken('');
    Alert.alert('Connected', 'Notion integration token saved.');
  }

  async function handleSaveHomeAddress() {
    const addr = homeAddress.trim();
    if (!addr) {
      Alert.alert('Enter an address', 'Type your home address, then Save.');
      return;
    }
    if (!supabase) return;
    setHomeAddressLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setHomeAddressLoading(false); return; }
      const { error } = await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id: user.id,
          home_address: addr,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-home-address',
      );
      if (error) throw error;
      setHomeAddress(addr);
      Alert.alert('Saved', 'Home address saved. Naavi will use this for "home" alerts.');
    } catch (err) {
      Alert.alert('Error', 'Could not save home address. Please try again.');
    }
    setHomeAddressLoading(false);
  }

  async function handleSaveWorkAddress() {
    const addr = workAddress.trim();
    if (!addr) {
      Alert.alert('Enter an address', 'Type your work or office address, then Save.');
      return;
    }
    if (!supabase) return;
    setWorkAddressLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setWorkAddressLoading(false); return; }
      const { error } = await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id: user.id,
          work_address: addr,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-work-address',
      );
      if (error) throw error;
      setWorkAddress(addr);
      Alert.alert('Saved', 'Work address saved. Naavi will use this for "office" alerts.');
    } catch (err) {
      Alert.alert('Error', 'Could not save work address. Please try again.');
    }
    setWorkAddressLoading(false);
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
              ? `Saved as "${userName}". MyNaavi will auto-label you in every conversation.`
              : 'Enter your name once — MyNaavi will recognize you in all conversations automatically.'}
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
            onPress={async () => {
              const name = userName.trim();
              if (!name) return;
              // 1. Cache locally for fast reads on next open.
              saveUserName(name);
              // 2. Sync to Supabase — await so we know it succeeded. On
              //    failure, alert the user and don't claim "Saved".
              try {
                await syncUserNameToSupabase(name);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                Alert.alert('Could not save name', msg);
                return;
              }
              // 3. Re-fetch to confirm the server wrote it and reflect the
              //    canonical value (in case of case/spacing normalization).
              try {
                if (supabase) {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    const { data } = await queryWithTimeout(
                      supabase
                        .from('user_settings')
                        .select('name')
                        .eq('user_id', user.id)
                        .maybeSingle(),
                      15_000,
                      'reload-user-name',
                    );
                    if (data?.name) setUserName(data.name);
                  }
                }
              } catch { /* non-fatal — client already has the value */ }
              setUserNameSaved(true);
              Alert.alert('Saved', `MyNaavi will call you "${name}".`);
            }}
            disabled={!userName.trim()}
          >
            <Text style={styles.saveBtnText}>Save name</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Your Phone Number */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Phone Number</Text>
          <Text style={styles.sectionNote}>
            {phoneSaved
              ? `Saved as ${phone}. Naavi will call this number for your morning brief and will recognize you when you call back.`
              : 'Enter your phone in international format, starting with + and your country code (e.g. +16135551234). Required for morning calls.'}
          </Text>
          <TextInput
            style={styles.keyInput}
            value={phone}
            onChangeText={setPhone}
            placeholder="+16135551234"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Your phone number"
          />
          <TouchableOpacity
            style={[styles.saveBtn, (!phone.trim() || phoneLoading) && styles.saveBtnDisabled]}
            onPress={handleSavePhone}
            disabled={!phone.trim() || phoneLoading}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>
              {phoneLoading ? 'Saving...' : 'Save phone'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Connected services */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connected Services</Text>

          {/* Google sign-in covers Gmail, Calendar, Drive, and Maps with one
              login. We list each as a status row so the user can see what's
              live; there's no per-service Disconnect — to switch accounts,
              sign out from the user profile / 3-dot menu. */}
          {[
            { label: 'Gmail',    on: 'Connected — emails surfaced in brief and search' },
            { label: 'Calendar', on: 'Connected — real events in brief' },
            { label: 'Drive',    on: 'Connected — documents searched for context' },
            { label: 'Maps',     on: 'Connected — travel-time and directions live' },
          ].map(svc => (
            <View key={svc.label} style={styles.toolRow}>
              <View>
                <Text style={styles.toolLabel}>{svc.label}</Text>
                <Text style={styles.toolStatus}>
                  {calendarConnected ? svc.on : 'Not connected — sign in with Google'}
                </Text>
              </View>
              {calendarConnected && (
                <Text style={[styles.connectBtnText, { color: Colors.accent }]}>✓ On</Text>
              )}
            </View>
          ))}

          {/* Voice Playback */}
          <View style={styles.toolRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolLabel}>Voice Playback</Text>
              <Text style={styles.toolStatus}>
                {voicePlayback
                  ? 'On — MyNaavi speaks her replies aloud'
                  : 'Off — replies appear as text only, no audio'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.connectBtn}
              onPress={async () => {
                const next = !voicePlayback;
                setVoicePlayback(next);
                await setVoicePref(next);
              }}
            >
              <Text style={styles.connectBtnText}>{voicePlayback ? 'Turn Off' : 'Turn On'}</Text>
            </TouchableOpacity>
          </View>

          {/* Push Notifications */}
          <View style={styles.toolRow}>
            <View>
              <Text style={styles.toolLabel}>Push Notifications</Text>
              <Text style={styles.toolStatus}>
                {pushEnabled ? 'Enabled — MyNaavi will alert you for reminders' : 'Get alerts for reminders and leave-by warnings'}
              </Text>
            </View>
            {!pushEnabled && (
              <TouchableOpacity
                style={styles.connectBtn}
                disabled={pushLoading}
                onPress={async () => {
                  setPushLoading(true);
                  const ok = await registerPushNotifications();
                  setPushEnabled(ok);
                  setPushLoading(false);
                }}
              >
                <Text style={styles.connectBtnText}>{pushLoading ? '...' : 'Enable'}</Text>
              </TouchableOpacity>
            )}
            {pushEnabled && (
              <Text style={[styles.connectBtnText, { color: Colors.accent }]}>✓ On</Text>
            )}
          </View>

        </View>

        <View style={styles.divider} />

        {/* Morning Call */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Morning Brief Call</Text>
          <Text style={styles.sectionNote}>
            Naavi calls you every morning with your schedule, weather, reminders, and emails.
          </Text>

          <View style={styles.toolRow}>
            <View>
              <Text style={styles.toolLabel}>Morning Call</Text>
              <Text style={styles.toolStatus}>
                {morningCallEnabled ? `Enabled — ${morningCallTime} daily` : 'Disabled'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.connectBtn, morningCallEnabled && styles.connectBtnActive]}
              onPress={() => {
                setMorningCallEnabled(!morningCallEnabled);
              }}
            >
              <Text style={[styles.connectBtnText, morningCallEnabled && styles.connectBtnTextActive]}>
                {morningCallEnabled ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>
          </View>

          {morningCallEnabled && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.toolLabel}>Call Time (24h format)</Text>
              <TextInput
                style={styles.keyInput}
                value={morningCallTime}
                onChangeText={setMorningCallTime}
                placeholder="08:00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                accessibilityLabel="Morning call time"
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, morningCallLoading && styles.saveBtnDisabled]}
            onPress={handleSaveMorningCall}
            disabled={morningCallLoading}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>{morningCallLoading ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Location alerts (Phase 2) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location alerts</Text>
          <Text style={styles.sectionNote}>
            Allow MyNaavi to fire alerts when you arrive at or leave places you care about.
          </Text>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => router.push('/permission-location')}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>Manage location alerts</Text>
          </TouchableOpacity>

          {/* Home & Work addresses — feed the "home" / "office" shortcuts */}
          <Text style={[styles.sectionNote, { marginTop: 20 }]}>
            Your home and work addresses let MyNaavi create alerts when you say "home" or "office".
          </Text>

          <Text style={styles.toolLabel}>Home address</Text>
          <TextInput
            style={styles.keyInput}
            value={homeAddress}
            onChangeText={setHomeAddress}
            placeholder="e.g., 123 Main St, Ottawa, ON"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Home address"
          />
          <TouchableOpacity
            style={[styles.saveBtn, (!homeAddress.trim() || homeAddressLoading) && styles.saveBtnDisabled]}
            onPress={handleSaveHomeAddress}
            disabled={!homeAddress.trim() || homeAddressLoading}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>{homeAddressLoading ? 'Saving…' : 'Save home address'}</Text>
          </TouchableOpacity>

          <Text style={[styles.toolLabel, { marginTop: 12 }]}>Work address</Text>
          <TextInput
            style={styles.keyInput}
            value={workAddress}
            onChangeText={setWorkAddress}
            placeholder="e.g., 55 Elgin St, Ottawa, ON"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Work address"
          />
          <TouchableOpacity
            style={[styles.saveBtn, (!workAddress.trim() || workAddressLoading) && styles.saveBtnDisabled]}
            onPress={handleSaveWorkAddress}
            disabled={!workAddress.trim() || workAddressLoading}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>{workAddressLoading ? 'Saving…' : 'Save work address'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Sign Out — last interactive element, sits at the bottom of Settings. */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => {
            Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/'); } },
            ]);
          }}
        >
          <Text style={styles.signOutBtnText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Version */}
        <Text style={styles.version}>MyNaavi — V57.11.0 (build 142)</Text>

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
  signOutBtn: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(216,90,48,0.15)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(216,90,48,0.3)',
  },
  signOutBtnText: {
    color: Colors.alert,
    fontSize: Typography.body,
    fontWeight: '600',
  },
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.textHint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  sectionNote: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: Typography.lineHeightBody,
  },
  keyInput: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    marginBottom: 12,
    height: 48,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: Colors.accentDark,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 24,
  },
  // ── Provider section
  providerRow: {
    marginBottom: 16,
  },
  providerRowLabel: {
    fontSize: Typography.body,
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
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: Colors.bgElevated,
  },
  chipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.accentDark,
    fontWeight: Typography.semibold,
  },
  chipPhase: {
    fontSize: Typography.caption,
    color: Colors.textHint,
  },
  // ── Connected tools
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 8,
  },
  toolLabel: {
    fontSize: Typography.cardTitle,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  toolStatus: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    marginTop: 2,
  },
  comingSoon: {
    fontSize: Typography.body,
    color: Colors.textHint,
    fontStyle: 'italic',
  },
  connectBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
    justifyContent: 'center',
  },
  connectBtnActive: {
    backgroundColor: Colors.alert,
  },
  connectBtnText: {
    color: Colors.accentDark,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  version: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 8,
  },
});
