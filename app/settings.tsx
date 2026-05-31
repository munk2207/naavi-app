/**
 * Settings screen
 *
 * Robert controls his preferences here:
 * - His name (used to auto-label conversation transcripts)
 * - Anthropic API key (entered once, stored securely)
 * - Provider selection (calendar, email, storage, maps)
 * - Connected services status
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  AppState,
  Modal,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
  // F1a Wave 2 Phase E refinement #5 — inline edit-in-place for backup rows.
  // editingPhoneIdx >=1 means the row at that index is in edit mode; null
  // means no row is being edited. editingPhoneValue holds the in-progress
  // text. Primary (index 0) is edited via the dedicated TextInput above.
  const [editingPhoneIdx, setEditingPhoneIdx]       = useState<number | null>(null);
  const [editingPhoneValue, setEditingPhoneValue]   = useState('');
  // V57.27.0 build 203 — Primary phone is now also pretty-printed by default
  // and switches to a TextInput only when the user taps it (matches the
  // backup row pattern, fixes Test 5 inconsistency where Primary stayed raw
  // while Backup was pretty).
  const [editingPrimary, setEditingPrimary]         = useState(false);
  const [editingPrimaryValue, setEditingPrimaryValue] = useState('');
  // V57.15.5 — Voice PIN UI (Wael 2026-05-14). Backed by manage-voice-pin
  // Edge Function. We only ever read voice_pin_set_at (timestamp) — never
  // the bcrypt hash itself. pinSetAt === null means "no PIN set"; non-null
  // ISO string means "PIN set on <date>".
  const [pinSetAt, setPinSetAt]                     = useState<string | null>(null);
  const [pinLoading, setPinLoading]                 = useState(false);
  const [pinModalVisible, setPinModalVisible]       = useState(false);
  const [pinModalMode, setPinModalMode]             = useState<'set' | 'change'>('set');
  const [newPin, setNewPin]                         = useState('');
  const [confirmPin, setConfirmPin]                 = useState('');
  const [pinError, setPinError]                     = useState<string | null>(null);
  // Ref so the new-PIN field's keyboard "Done" can focus the confirm field
  // without the user reaching back to tap it (V57.27.0 build 203 polish).
  const confirmPinInputRef                          = useRef<TextInput>(null);
  const [homeAddress, setHomeAddress]               = useState('');
  const [homeAddressLoading, setHomeAddressLoading] = useState(false);
  const [workAddress, setWorkAddress]               = useState('');
  const [workAddressLoading, setWorkAddressLoading] = useState(false);

  // 2026-05-22 — F2g Phase 2. Per-user channel preferences for self-alerts.
  // The 5 channels mirror evaluate-rules + check-reminders fan-out: SMS,
  // WhatsApp, Email, Push, Voice Call. DB enforces an at-least-one floor
  // via CHECK (array_length >= 1) — mobile mirrors the floor so the user
  // can't toggle the last channel off (the toggle is greyed out instead).
  type AlertChannel = 'sms' | 'whatsapp' | 'email' | 'push' | 'voice_call';
  const DEFAULT_CHANNELS: AlertChannel[] = ['sms', 'whatsapp', 'email', 'push', 'voice_call'];
  const [alertChannels, setAlertChannels] = useState<AlertChannel[]>(DEFAULT_CHANNELS);
  const [alertChannelsLoading, setAlertChannelsLoading] = useState(false);

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
            .select('name, morning_call_enabled, morning_call_time, phone, phone_numbers, home_address, work_address, voice_pin_set_at, alert_channels_enabled')
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
          // Voice PIN — null when no PIN set, ISO string when set.
          setPinSetAt(data.voice_pin_set_at ? String(data.voice_pin_set_at) : null);
          // 2026-05-22 — F2g Phase 2. Load saved channel preferences. The
          // DB default (set by migration) is all 5 channels enabled, so
          // any existing user gets the all-on baseline until they touch
          // a toggle.
          if (Array.isArray((data as any).alert_channels_enabled)) {
            const valid: AlertChannel[] = ['sms', 'whatsapp', 'email', 'push', 'voice_call'];
            const saved = ((data as any).alert_channels_enabled as string[])
              .filter((c): c is AlertChannel => valid.includes(c as AlertChannel));
            if (saved.length >= 1) {
              setAlertChannels(saved);
            }
          }
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

  // 2026-05-22 — F2g Phase 2. Toggle a single channel on/off and persist
  // to user_settings.alert_channels_enabled. Enforces the at-least-one
  // floor on the client side (matches the DB CHECK constraint) — the last
  // enabled channel's toggle silently no-ops with a friendly alert.
  async function toggleAlertChannel(channel: AlertChannel) {
    const isOn = alertChannels.includes(channel);
    if (isOn && alertChannels.length === 1) {
      Alert.alert(
        'Keep at least one channel on',
        "You need at least one alert channel enabled so Naavi can reach you. Turn another channel on first, then you can switch this one off.",
      );
      return;
    }
    const next = isOn
      ? alertChannels.filter(c => c !== channel)
      : [...alertChannels, channel];
    setAlertChannels(next);
    if (!supabase) return;
    setAlertChannelsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAlertChannelsLoading(false); return; }
      await queryWithTimeout(
        supabase.from('user_settings').upsert({
          user_id: user.id,
          alert_channels_enabled: next,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }),
        15_000,
        'upsert-alert-channels',
      );
    } catch (err) {
      // Revert the optimistic update on error.
      setAlertChannels(alertChannels);
      Alert.alert('Error', 'Could not save your alert channel choice.');
    }
    setAlertChannelsLoading(false);
  }

  // E.164 validator — plus, country code, 10-15 digits total.
  function normalizePhone(s: string): string {
    return s.trim().replace(/[\s\-\(\)]/g, '');
  }
  function isValidE164(s: string): boolean {
    return /^\+\d{10,15}$/.test(s);
  }

  // V57.15.5 refinement #4 — pretty-print E.164 for DISPLAY only. Used in
  // the backup row labels and the "Primary: ..." note line. Editable
  // TextInputs continue to show the raw E.164 so editing keystrokes don't
  // fight the formatter. North-American (+1) numbers get "+1 (XXX) XXX-XXXX";
  // any other country code falls back to "+CC XXXXXXXXXX" with one space.
  function prettyPhone(raw: string): string {
    if (!isValidE164(raw)) return raw;
    if (raw.startsWith('+1') && raw.length === 12) {
      return `+1 (${raw.slice(2,5)}) ${raw.slice(5,8)}-${raw.slice(8,12)}`;
    }
    // Best-effort for non-NA: split off "+CC" then re-join.
    const m = raw.match(/^(\+\d{1,3})(\d+)$/);
    return m ? `${m[1]} ${m[2]}` : raw;
  }

  // V57.15.5 refinement #7 — cap the total phone count. Primary + 4 backups
  // is plenty for the "borrowed family phone" use case; runaway lists are
  // both a UX and a verification-cost concern.
  const MAX_PHONES = 5;

  // V57.27.0 build 203 — auto-persist on add. Local state + DB write fire
  // together; "Save phones" button removed.
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
    if (phoneNumbers.length >= MAX_PHONES) {
      Alert.alert(
        'Phone limit reached',
        `You can have up to ${MAX_PHONES} phone numbers (1 primary + ${MAX_PHONES - 1} backups). Remove one before adding another.`
      );
      return;
    }
    const newNumbers = [...phoneNumbers, raw];
    setPhoneNumbers(newNumbers);
    setNewPhoneInput('');
    void persistPhoneNumbers(newNumbers, phone);
  }

  // V57.15.5 refinement #5 — start editing a backup row in place.
  function handleStartEditPhone(idx: number) {
    if (idx === 0) return;       // primary edited via the dedicated input
    setEditingPhoneIdx(idx);
    setEditingPhoneValue(phoneNumbers[idx] ?? '');
  }
  function handleCancelEditPhone() {
    setEditingPhoneIdx(null);
    setEditingPhoneValue('');
  }
  function handleSaveEditPhone() {
    if (editingPhoneIdx == null) return;
    const raw = normalizePhone(editingPhoneValue);
    if (!isValidE164(raw)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return;
    }
    // Reject if the new value collides with another row (allow no-op on the
    // same row where the user just retyped the same number).
    if (phoneNumbers.some((n, i) => n === raw && i !== editingPhoneIdx)) {
      Alert.alert('Already added', 'That number is already on your list.');
      return;
    }
    const newNumbers = phoneNumbers.map((n, i) => (i === editingPhoneIdx ? raw : n));
    setPhoneNumbers(newNumbers);
    setEditingPhoneIdx(null);
    setEditingPhoneValue('');
    void persistPhoneNumbers(newNumbers, phone);
  }

  // V57.27.0 build 203 — Primary phone tap-to-edit + auto-persist. Tap row
  // → swap to TextInput + ✓/× buttons. Saving updates local state AND
  // persists to DB immediately (no separate "Save phones" button).
  function handleStartEditPrimary() {
    setEditingPrimary(true);
    setEditingPrimaryValue(phone);
  }
  function handleCancelEditPrimary() {
    setEditingPrimary(false);
    setEditingPrimaryValue('');
  }
  function handleSaveEditPrimary() {
    const raw = normalizePhone(editingPrimaryValue);
    if (!isValidE164(raw)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return;
    }
    // If the new primary collides with an existing backup, demote/promote:
    // remove that backup row so the primary takes its place. Same-as-current
    // is a no-op exit.
    if (raw === phone) {
      setEditingPrimary(false);
      setEditingPrimaryValue('');
      return;
    }
    const filtered = phoneNumbers.filter(n => n !== raw);  // drop dup if any
    const newNumbers = filtered.length > 0
      ? [raw, ...filtered.slice(1)]               // replace index 0
      : [raw];
    setPhone(raw);
    setPhoneNumbers(newNumbers);
    setEditingPrimary(false);
    setEditingPrimaryValue('');
    void persistPhoneNumbers(newNumbers, raw);
  }

  // V57.27.0 build 203 — Remove + auto-persist. Primary (index 0) cannot
  // be removed via this path — user changes primary by tapping the primary
  // row to edit it.
  function handleRemovePhone(idx: number) {
    if (idx === 0) return;   // primary protected
    if (phoneNumbers.length <= 1) return;
    const newNumbers = phoneNumbers.filter((_, i) => i !== idx);
    setPhoneNumbers(newNumbers);
    void persistPhoneNumbers(newNumbers, phone);
  }

  // V57.27.0 build 203 — silent auto-persist helper. Replaces the explicit
  // "Save phones" button. Each phone-list mutation (add / remove / edit)
  // calls this immediately so the entry lands in the DB right away. No
  // success alert — the absence of an error IS the success signal. Errors
  // (validation, conflict, network) still alert. Reverts local state on
  // failure so the UI stays consistent with the DB.
  async function persistPhoneNumbers(numbers: string[], primary: string): Promise<boolean> {
    if (!supabase) return false;
    if (!isValidE164(primary)) {
      Alert.alert(
        'Invalid phone',
        'Use international format starting with +, then country code and number.\nExample: +16135551234'
      );
      return false;
    }
    // Compose final list — primary first, then the rest with any dup
    // of the primary stripped.
    const tail = numbers.filter(n => n !== primary);
    const finalNumbers = [primary, ...tail];

    setPhoneLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPhoneLoading(false); return false; }
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
        const msg = String(error.message || '');
        if (msg.includes('phone_number_already_registered')) {
          const conflict = msg.split(':').slice(1).join(':').trim();
          Alert.alert(
            'Phone already in use',
            `${conflict} is already registered to another MyNaavi account. Each number can only belong to one user.`
          );
        } else {
          Alert.alert('Error', 'Could not save phone changes. Please try again.');
        }
        setPhoneLoading(false);
        return false;
      }
      setPhoneSaved(true);
      setPhoneLoading(false);
      return true;
    } catch (err) {
      Alert.alert('Error', 'Could not save phone changes. Please try again.');
      setPhoneLoading(false);
      return false;
    }
  }

  // ── Voice PIN handlers (V57.15.5, Wael 2026-05-14) ─────────────────────
  // Backed by manage-voice-pin Edge Function (op: 'set' | 'remove').
  // Hash never leaves the server. Mobile only ever knows whether a PIN
  // is set (via voice_pin_set_at) and when.

  function openSetPinModal() {
    setPinModalMode('set');
    setNewPin('');
    setConfirmPin('');
    setPinError(null);
    setPinModalVisible(true);
  }

  function openChangePinModal() {
    setPinModalMode('change');
    setNewPin('');
    setConfirmPin('');
    setPinError(null);
    setPinModalVisible(true);
  }

  async function handleSavePin() {
    setPinError(null);
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('Must be exactly 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("Doesn't match. Try again.");
      return;
    }
    if (!supabase) return;
    setPinLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-voice-pin', {
        body: { op: 'set', pin: newPin },
      });
      if (error || !data?.success) {
        setPinError("Couldn't save PIN. Check your connection and try again.");
        setPinLoading(false);
        return;
      }
      setPinSetAt(new Date().toISOString());
      setPinModalVisible(false);
      setNewPin('');
      setConfirmPin('');
      Alert.alert(
        'Voice PIN saved',
        pinModalMode === 'set'
          ? "When you call from a phone that isn't on your account, Naavi will ask for this PIN."
          : 'Your PIN has been changed.'
      );
    } catch (_) {
      setPinError("Couldn't save PIN. Check your connection and try again.");
    }
    setPinLoading(false);
  }

  function handleRemovePin() {
    Alert.alert(
      'Remove voice PIN?',
      "After this, calls from any phone not saved on your account won't be able to reach you.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!supabase) return;
            setPinLoading(true);
            try {
              const { data, error } = await supabase.functions.invoke('manage-voice-pin', {
                body: { op: 'remove' },
              });
              if (error || !data?.success) {
                Alert.alert('Error', "Couldn't remove PIN. Check your connection and try again.");
                setPinLoading(false);
                return;
              }
              setPinSetAt(null);
              Alert.alert('Voice PIN removed', 'You can set a new one anytime.');
            } catch (_) {
              Alert.alert('Error', "Couldn't remove PIN. Check your connection and try again.");
            }
            setPinLoading(false);
          },
        },
      ]
    );
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
      {/* V57.27.0 build 203 — wrap ScrollView in KAV so soft keyboard pushes
          the content up cleanly. Fixes the Primary-edit screen-shift bug
          where tapping ✓ would miss because the button moved when the
          keyboard appeared. KAV applies to ALL inputs in the Settings
          screen (Name, Primary phone edit, Backup phone edit, Add backup,
          Home/Work address) — consistent behavior. The PIN modal lives
          outside this KAV (modal overlays bypass parent KAV) and has its
          own KAV restructure above. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
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
              ? `Primary: ${prettyPhone(phone)}. Used for the morning brief. Backup numbers below let Naavi recognize you when you call from a spouse or family phone.`
              : 'Enter your primary phone in international format (e.g. +16135551234). Required for morning calls. You can add backup numbers below after saving.'}
          </Text>
          <Text style={styles.fieldLabel}>Primary</Text>
          {/* V57.27.0 build 203 — Primary now follows the same tap-to-edit
              pattern as the Backup rows. Display mode shows the pretty-
              printed text + ✏ icon; tap either to enter edit mode (raw
              TextInput + ✓/× buttons). Resolves Test 5 inconsistency where
              Primary stayed raw while Backup was pretty. If no primary is
              set yet, fall through directly to edit mode (so a new user
              isn't stuck looking at an empty text row). */}
          {editingPrimary || !phone.trim() ? (
            <View style={styles.phoneBackupRow}>
              <TextInput
                style={[styles.keyInput, styles.phoneAddInput, { marginRight: 6 }]}
                value={editingPrimary ? editingPrimaryValue : phone}
                onChangeText={editingPrimary ? setEditingPrimaryValue : setPhone}
                placeholder="+16135551234"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={editingPrimary}
                returnKeyType="done"
                onSubmitEditing={editingPrimary ? handleSaveEditPrimary : undefined}
                accessibilityLabel="Your primary phone number"
              />
              {editingPrimary && (
                <>
                  <TouchableOpacity
                    onPress={handleSaveEditPrimary}
                    style={[styles.phoneRemoveBtn, { marginRight: 4 }]}
                    accessibilityLabel="Save primary edit"
                  >
                    <Ionicons name="checkmark" size={18} color={Colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEditPrimary}
                    style={styles.phoneRemoveBtn}
                    accessibilityLabel="Cancel primary edit"
                  >
                    <Ionicons name="close" size={18} color={Colors.error} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={styles.phoneBackupRow}
              onPress={handleStartEditPrimary}
              accessibilityLabel={`Edit primary phone ${phone}`}
            >
              <Text style={[styles.phoneBackupText, { flex: 1 }]}>{prettyPhone(phone)}</Text>
              <View style={styles.phoneRemoveBtn}>
                <Ionicons name="pencil" size={16} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
          )}

          {/* Backup phones list — only shows entries 1..N (primary is the
              TextInput above). Each row supports tap-to-edit + an X to
              remove. When editingPhoneIdx === this row, the row swaps to
              an inline TextInput + ✓/× buttons. */}
          {phoneNumbers.length > 1 && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Backup phones</Text>
              {phoneNumbers.slice(1).map((num, i) => {
                const idx = i + 1;
                const isEditing = editingPhoneIdx === idx;
                return (
                  <View key={`${num}:${i}`} style={styles.phoneBackupRow}>
                    {isEditing ? (
                      <>
                        <TextInput
                          style={[styles.keyInput, styles.phoneAddInput, { marginRight: 6 }]}
                          value={editingPhoneValue}
                          onChangeText={setEditingPhoneValue}
                          placeholder="+16135551234"
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="phone-pad"
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={handleSaveEditPhone}
                          accessibilityLabel={`Edit ${num}`}
                        />
                        <TouchableOpacity
                          onPress={handleSaveEditPhone}
                          style={[styles.phoneRemoveBtn, { marginRight: 4 }]}
                          accessibilityLabel="Save edit"
                        >
                          <Ionicons name="checkmark" size={18} color={Colors.accent} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleCancelEditPhone}
                          style={styles.phoneRemoveBtn}
                          accessibilityLabel="Cancel edit"
                        >
                          <Ionicons name="close" size={18} color={Colors.error} />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => handleStartEditPhone(idx)}
                          accessibilityLabel={`Edit ${num}`}
                        >
                          <Text style={styles.phoneBackupText}>{prettyPhone(num)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRemovePhone(idx)}
                          style={styles.phoneRemoveBtn}
                          accessibilityLabel={`Remove ${num}`}
                        >
                          <Ionicons name="close" size={18} color={Colors.error} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* Add-backup input row — disabled when at MAX_PHONES cap. */}
          {phoneNumbers.length >= MAX_PHONES ? (
            <Text style={[styles.sectionNote, { marginTop: 14, fontStyle: 'italic' }]}>
              You've reached the limit of {MAX_PHONES} numbers. Remove one before adding another.
            </Text>
          ) : (
            <>
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
                  returnKeyType="done"
                  onSubmitEditing={handleAddPhone}
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
            </>
          )}

          {/* V57.27.0 build 203 — "Save phones" button removed. Each
              add / remove / edit auto-persists to DB immediately. The brief
              `phoneLoading` flicker on the section indicates the in-flight
              upsert. Eliminates the "I added a phone, navigated away, came
              back, the new entry disappeared" failure mode. */}
          {phoneLoading && (
            <Text style={[styles.fieldLabel, { marginTop: 10, textAlign: 'center' }]}>
              Saving...
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        {/* Voice PIN — V57.15.5 (Wael 2026-05-14). Identifies caller when they
            phone Naavi from a number not in their phone_numbers[]. Backed by
            the manage-voice-pin Edge Function. Hash never leaves the server. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Voice PIN</Text>
          <Text style={styles.sectionNote}>
            A 4-digit code so Naavi recognizes you when you call from a phone
            that isn't saved on your account.
          </Text>
          {pinSetAt ? (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 6 }]}>
                ✓ PIN set on {new Date(pinSetAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </Text>
              <View style={[styles.phoneAddRow, { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[styles.saveBtn, { flex: 1, marginRight: 8 }, pinLoading && styles.saveBtnDisabled]}
                  onPress={openChangePinModal}
                  disabled={pinLoading}
                  accessibilityRole="button"
                >
                  <Text style={styles.saveBtnText}>Change PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, styles.pinRemoveBtn, { flex: 1 }, pinLoading && styles.saveBtnDisabled]}
                  onPress={handleRemovePin}
                  disabled={pinLoading}
                  accessibilityRole="button"
                >
                  <Text style={styles.saveBtnText}>{pinLoading ? '...' : 'Remove PIN'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.saveBtn, pinLoading && styles.saveBtnDisabled, { marginTop: 10 }]}
              onPress={openSetPinModal}
              disabled={pinLoading}
              accessibilityRole="button"
            >
              <Text style={styles.saveBtnText}>Set a 4-digit PIN</Text>
            </TouchableOpacity>
          )}
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
              style={[styles.connectBtn, !morningCallEnabled && styles.connectBtnInactive]}
              onPress={() => {
                setMorningCallEnabled(!morningCallEnabled);
              }}
            >
              <Text style={[styles.connectBtnText, !morningCallEnabled && styles.connectBtnTextInactive]}>
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

        {/* F2g Phase 2 (2026-05-22) — Per-user alert channel preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alert channels</Text>
          <Text style={styles.sectionNote}>
            Choose how Naavi reaches you when your alerts fire. Defaults to all five so you never miss an important alert. At least one channel must stay on.
          </Text>

          {([
            { key: 'sms',        label: 'Text message (SMS)',      detail: 'Standard text to your phone.' },
            { key: 'whatsapp',   label: 'WhatsApp',                detail: 'WhatsApp message (works on Wi-Fi).' },
            { key: 'email',      label: 'Email',                   detail: 'Email to your account.' },
            { key: 'push',       label: 'Push notification',       detail: 'Pop-up on this phone.' },
            { key: 'voice_call', label: 'Voice call',              detail: 'Naavi calls you and speaks the alert.' },
          ] as Array<{ key: AlertChannel; label: string; detail: string }>).map(({ key, label, detail }) => {
            const isOn = alertChannels.includes(key);
            const isLastOn = isOn && alertChannels.length === 1;
            return (
              <View key={key} style={styles.toolRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toolLabel}>{label}</Text>
                  <Text style={styles.toolStatus}>{detail}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.connectBtn, !isOn && styles.connectBtnInactive, isLastOn && { opacity: 0.6 }]}
                  onPress={() => toggleAlertChannel(key)}
                  disabled={alertChannelsLoading}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: ${isOn ? 'on' : 'off'} ${isLastOn ? '(last enabled channel, cannot turn off)' : ''}`}
                >
                  <Text style={[styles.connectBtnText, !isOn && styles.connectBtnTextInactive]}>
                    {isOn ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          <Text style={[styles.sectionNote, { marginTop: 10, fontStyle: 'italic' }]}>
            You'll receive alerts on: {alertChannels.map(c =>
              c === 'sms' ? 'SMS'
              : c === 'whatsapp' ? 'WhatsApp'
              : c === 'email' ? 'Email'
              : c === 'push' ? 'Push'
              : 'Voice Call'
            ).join(', ')}.
          </Text>
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
        <Text style={styles.version}>MyNaavi — V57.33.6 (build 216)</Text>

      </ScrollView>
      </KeyboardAvoidingView>

      {/* Voice PIN modal — set OR change. Two PIN fields, popup-style. */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !pinLoading && setPinModalVisible(false)}
      >
        {/* V57.27.0 build 203 — KAV restructure. KAV is now the OUTERMOST
            child of Modal (was nested inside centered backdrop, which fought
            its layout). Backdrop is now anchored from the top with
            paddingTop:60, so the card sits near the top of the screen
            regardless of keyboard state — bulletproof against any keyboard
            quirk. Replaces the V57.27.0 build 203 wrap which only hid the
            title behind the keyboard. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <Pressable style={styles.pinModalBackdrop} onPress={() => !pinLoading && setPinModalVisible(false)}>
            <Pressable style={styles.pinModalCard} onPress={e => e.stopPropagation()}>
            <Text style={styles.pinModalTitle}>
              {pinModalMode === 'change' ? 'Change your voice PIN' : 'Set your voice PIN'}
            </Text>
            <Text style={styles.pinModalLabel}>Choose a 4-digit PIN</Text>
            <TextInput
              style={styles.pinModalInput}
              value={newPin}
              onChangeText={(t) => { setNewPin(t.replace(/\D/g, '').slice(0, 4)); if (pinError) setPinError(null); }}
              placeholder="••••"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => confirmPinInputRef.current?.focus()}
              accessibilityLabel="New voice PIN"
            />
            <Text style={[styles.pinModalLabel, { marginTop: 14 }]}>Type it again to confirm</Text>
            <TextInput
              ref={confirmPinInputRef}
              style={styles.pinModalInput}
              value={confirmPin}
              onChangeText={(t) => { setConfirmPin(t.replace(/\D/g, '').slice(0, 4)); if (pinError) setPinError(null); }}
              placeholder="••••"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              returnKeyType="done"
              onSubmitEditing={handleSavePin}
              accessibilityLabel="Confirm voice PIN"
            />
            {pinError && <Text style={styles.pinModalError}>{pinError}</Text>}
            <View style={styles.pinModalBtnRow}>
              <TouchableOpacity
                style={[styles.pinModalBtn, styles.pinModalBtnSecondary]}
                onPress={() => setPinModalVisible(false)}
                disabled={pinLoading}
              >
                <Text style={styles.pinModalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinModalBtn, styles.pinModalBtnPrimary, pinLoading && styles.saveBtnDisabled]}
                onPress={handleSavePin}
                disabled={pinLoading}
              >
                {pinLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.pinModalBtnPrimaryText}>Save PIN</Text>}
              </TouchableOpacity>
            </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
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
    // 2026-05-22 — On/Off color convention (Wael):
    //   On  state / action button (default) = teal (Colors.accent).
    //   Off state on a STATE TOGGLE         = muted (connectBtnInactive overlay).
    // Action buttons ("Turn On", "Enable", "✓ On") use connectBtn alone
    // and stay teal as call-to-action. State toggles (morning call,
    // alert channels) apply connectBtnInactive when the state is OFF
    // so On reads green/teal (correct) and Off reads muted (correct).
    // Previously connectBtnActive made the ON state orange/red, which
    // inverted the standard On=green / Off=red convention.
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
    justifyContent: 'center',
  },
  connectBtnInactive: {
    backgroundColor: Colors.bgElevated,
  },
  connectBtnText: {
    color: Colors.accentDark,
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
  },
  connectBtnTextInactive: {
    color: Colors.textMuted,
  },
  version: {
    fontSize: Typography.caption,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 8,
  },


  // ── Voice PIN section + modal (V57.15.5) ─────────────────────────────────
  pinRemoveBtn: {
    backgroundColor: Colors.alert,
  },
  pinModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  pinModalCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 22,
    maxWidth: 380,
    width: '100%',
  },
  pinModalTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 14,
  },
  pinModalLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 6,
  },
  pinModalInput: {
    backgroundColor: Colors.bgElevated,
    color: Colors.textPrimary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  pinModalError: {
    color: Colors.alert,
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  pinModalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  pinModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinModalBtnSecondary:     { backgroundColor: Colors.bgElevated },
  pinModalBtnSecondaryText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pinModalBtnPrimary:       { backgroundColor: Colors.accent },
  pinModalBtnPrimaryText:   { color: '#fff', fontSize: 15, fontWeight: '600' },
});
