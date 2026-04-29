/**
 * Voice playback preference helper.
 *
 * Reads user_settings.voice_playback. When false, mobile mutes ALL TTS
 * (chat replies, hands-free cues, every speak path) AND hides the orange
 * Stop button that would otherwise appear during playback.
 *
 * Cached in module memory + AsyncStorage so toggling the Settings switch
 * takes effect immediately without a roundtrip per TTS call.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { queryWithTimeout } from './invokeWithTimeout';

const CACHE_KEY = 'naavi.voice_playback';
let cached: boolean | null = null;

/** Read the cached flag synchronously. Returns true (enabled) until the
 *  first refresh completes — preserves existing behavior for cold starts. */
export function isVoiceEnabledSync(): boolean {
  return cached ?? true;
}

/** Refresh from Supabase. Call after sign-in and whenever the toggle changes. */
export async function refreshVoicePref(): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      const local = await AsyncStorage.getItem(CACHE_KEY);
      cached = local === 'false' ? false : true;
      return cached;
    }
    const { data, error } = await queryWithTimeout(
      supabase
        .from('user_settings')
        .select('voice_playback')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      15_000,
      'select-voice-playback',
    );
    if (error) {
      const local = await AsyncStorage.getItem(CACHE_KEY);
      cached = local === 'false' ? false : true;
      return cached;
    }
    cached = data?.voice_playback !== false;
    await AsyncStorage.setItem(CACHE_KEY, cached ? 'true' : 'false');
    return cached;
  } catch {
    cached = true;
    return true;
  }
}

/** Persist a new toggle value. Updates cache + AsyncStorage + Supabase. */
export async function setVoicePref(enabled: boolean): Promise<void> {
  cached = enabled;
  await AsyncStorage.setItem(CACHE_KEY, enabled ? 'true' : 'false');
  if (!supabase) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    await queryWithTimeout(
      supabase
        .from('user_settings')
        .upsert(
          { user_id: session.user.id, voice_playback: enabled },
          { onConflict: 'user_id' },
        ),
      15_000,
      'upsert-voice-playback',
    );
  } catch {
    /* keep local cache; will reconcile on next refresh */
  }
}

/** Hydrate the in-memory cache from AsyncStorage at app startup, before the
 *  first network refresh resolves. Avoids a brief "voice plays then mutes"
 *  flash on cold start when the user has voice disabled. */
export async function hydrateVoicePref(): Promise<void> {
  try {
    const local = await AsyncStorage.getItem(CACHE_KEY);
    if (local === 'false') cached = false;
    else if (local === 'true') cached = true;
  } catch {
    /* ignore */
  }
}
