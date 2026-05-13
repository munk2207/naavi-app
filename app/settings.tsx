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
import { Ionicons } from '@expo/vector-icons';
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
  // F1a Wave 2 Phase E — multi-phone identity (Wael 2026-05-13).
  // phoneNumbers[0] is the primary (used for morning call); subsequent
  // entries are backup recognitions (spouse, family) so the voice server
  // identifies the same user from any of them. At least one is required.
  const [phoneNumbers, setPhoneNumbers]             = useState<string[]>([]);
  const [newPhoneInput, setNewPhoneInput]           = useState('');
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
            .select('name, morning_call_enabled, morning_call_time, phone, phone_numbers, home_address, work_address')
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
          // Prefer phone_numbers[] (canonical post-migration). Fall back
          // to the single `phone` column for users whose row predates
          // the multi-phone migration and hasn't been resaved yet.
          if (Array.isArray(data.phone_numbers) && data.phone_numbers.length > 0) {
            setPhoneNumbers(data.phone_numbers.map(String));
          } else if (data.phone) {
            setPhoneNumbers([String(data.phone)]);
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

  // E.164 validator — plus, country code, 10-15 digits total.
  function normalizePhone(s: string): string {
    return s.trim().replace(/[\s\-\(\)]/g, '');
  }
  function isValidE164(s: string): boolean {
    return /^\+\d{10,15}$/.test(s);
  }

  // F1a Wave 2 Phase E — add a backup phone number locally. Persists on Save.
  function handleAddPhone() {
    const raw = normalizePhone(newPhoneInput);
    if (!isValidE164(raw)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return;
    }
    if (phoneNumbers.includes(raw)) {
      Alert.alert('Already added', 'That number is already on your list.');
      return;
    }
    setPhoneNumbers(prev => [...prev, raw]);
    setNewPhoneInput('');
  }

  // Remove a non-primary phone. Primary (index 0) cannot be removed via
  // this path — user changes primary by editing the legacy single-phone
  // input above and re-saving (which will also rewrite phone_numbers[0]).
  function handleRemovePhone(idx: number) {
    if (idx === 0) return;   // primary protected
    if (phoneNumbers.length <= 1) return;
    setPhoneNumbers(prev => prev.filter((_, i) => i !== idx));
  }

  // Save the WHOLE phone_numbers list. Dual-writes `phone` (= primary) so
  // legacy code that reads the single column keeps working through the
  // dual-write release.
  async function handleSavePhone() {
    const primary = normalizePhone(phone);
    if (!isValidE164(primary)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return;
    }
    // Compose the final phone_numbers list — primary first, then the
    // rest of the current list with any duplicate of the primary stripped.
    const tail = phoneNumbers.filter(n => n !== primary);
    const finalNumbers = [primary, ...tail];

    if (!supabase) return;
    setPhoneLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPhoneLoading(false); return; }
      const { error } = await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id:       user.id,
          phone:         primary,
          phone_numbers: finalNumbers,
          updated_at:    new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-user-phone',
      );
      if (error) {
        // Trigger raises 23505 with a "phone_number_already_registered:
        // <conflict_phone>" message when another user has the same number.
        const msg = String(error.message || '');
        if (msg.includes('phone_number_already_registered')) {
          const conflict = msg.split(':').slice(1).join(':').trim();
          Alert.alert(
            'Phone already in use',
            `${conflict} is already registered to another MyNaavi account. Each number can only belong to one user.`
          );
        } else {
          throw error;
        }
        return;
      }
      setPhone(primary);
      setPhoneNumbers(finalNumbers);
      setPhoneSaved(true);
      Alert.alert(
        'Saved',
        finalNumbers.length === 1
          ? 'Phone number saved. Naavi will call this number for your morning brief, and will recognize you when you call back.'
          : `Saved ${finalNumbers.length} numbers. Naavi will call the primary for your morning brief and will recognize you when you call from any of them.`
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

        {/* Your Phone Number — primary + backup numbers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Phone Numbers</Text>
          <Text style={styles.sectionNote}>
            {phoneSaved
              ? `Primary: ${phone}. Used for the morning brief. Backup numbers below let Naavi recognize you when you call from a spouse or family phone.`
              : 'Enter your primary phone in international format (e.g. +16135551234). Required for morning calls. You can add backup numbers below after saving.'}
          </Text>
          <Text style={styles.fieldLabel}>Primary</Text>
          <TextInput
            style={styles.keyInput}
            value={phone}
            onChangeText={setPhone}
            placeholder="+16135551234"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Your primary phone number"
          />

          {/* Backup phones list — only shows entries 1..N (primary is the
              TextInput above). Each row has an X to remove. */}
          {phoneNumbers.length > 1 && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Backup phones</Text>
              {phoneNumbers.slice(1).map((num, i) => (
                <View key={`${num}:${i}`} style={styles.phoneBackupRow}>
                  <Text style={styles.phoneBackupText}>{num}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemovePhone(i + 1)}
                    style={styles.phoneRemoveBtn}
                    accessibilityLabel={`Remove ${num}`}
                  >
                    <Ionicons name="close" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}

          {/* Add-backup input row */}
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Add a backup phone</Text>
          <View style={styles.phoneAddRow}>
            <TextInput
              style={[styles.keyInput, styles.phoneAddInput]}
              value={newPhoneInput}
              onChangeText={setNewPhoneInput}
              placeholder="+16135551234"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Add a backup phone number"
            />
            <TouchableOpacity
              style={[styles.phoneAddBtn, !newPhoneInput.trim() && styles.saveBtnDisabled]}
              onPress={handleAddPhone}
              disabled={!newPhoneInput.trim()}
              accessibilityRole="button"
              accessibilityLabel="Add backup phone"
            >
              <Ionicons name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!phone.trim() || phoneLoading) && styles.saveBtnDisabled]}
            onPress={handleSavePhone}
            disabled={!phone.trim() || phoneLoading}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>
              {phoneLoading ? 'Saving...' : phoneNumbers.length > 1 ? 'Save phones' : 'Save phone'}
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
        <Text style={styles.version}>MyNaavi — V57.15.1 (build 172)</Text>

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
  // F1a Wave 2 Phase E — multi-phone identity UI.
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  phoneBackupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  phoneBackupText: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  phoneRemoveBtn: {
    padding: 6,
  },
  phoneAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  phoneAddInput: {
    flex: 1,
    marginBottom: 0,
  },
  phoneAddBtn: {
    width: 44,
    height: 44,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
