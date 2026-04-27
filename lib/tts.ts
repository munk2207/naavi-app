/**
 * Cloud TTS helper for short voice cues.
 *
 * Hands-free cues ("I'm listening", "Goodbye Robert", "Tap Resume when you
 * need me") must use the SAME voice as Naavi's main replies and phone calls —
 * Deepgram aura-hera-en — otherwise Robert hears two different voices during
 * one interaction. This helper calls the text-to-speech Edge Function and
 * plays the returned base64 MP3 via expo-av. On failure it falls back to
 * expo-speech so a cue is never silent.
 *
 * Main conversation replies continue to use useOrchestrator.speakResponse —
 * same underlying stack but scoped to that hook's stop/reset state.
 */

import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { isVoiceEnabledSync } from './voicePref';

async function fetchCueAudio(text: string): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data, error } = await supabase.functions.invoke('text-to-speech', {
      body: { text, voice: 'shimmer' }, // voice param ignored server-side; always aura-hera-en
    });
    if (error || !data?.audio) return null;
    return data.audio as string;
  } catch {
    return null;
  }
}

async function playCueNative(base64: string): Promise<void> {
  const tempUri = (FileSystem.cacheDirectory ?? '') + `cue_${Date.now()}.mp3`;
  try {
    await FileSystem.writeAsStringAsync(tempUri, base64, {
      encoding: 'base64' as any,
    });
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    const sound = new Audio.Sound();
    await new Promise<void>((resolve, reject) => {
      // Safety — resolve after 10s if playback never reports finish
      const safety = setTimeout(() => resolve(), 10000);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          clearTimeout(safety);
          sound.unloadAsync().then(() => {
            FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
            resolve();
          });
        }
        if (!status.isLoaded && (status as any).error) {
          clearTimeout(safety);
          reject(new Error((status as any).error));
        }
      });
      sound
        .loadAsync({ uri: tempUri })
        .then(() => sound.playAsync())
        .catch((err) => {
          clearTimeout(safety);
          reject(err);
        });
    });
  } finally {
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
  }
}

function fallbackExpoSpeech(text: string, language: 'en' | 'fr'): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      language: language === 'fr' ? 'fr-CA' : 'en-CA',
      rate: 0.85,
      pitch: 1.05,
      onDone: () => resolve(),
      onError: () => resolve(),
      onStopped: () => resolve(),
    });
    setTimeout(resolve, 5000);
  });
}

/**
 * Speak a short cue using the cloud voice that matches Naavi's main replies.
 * Falls back to native TTS if the network is unavailable.
 */
export async function speakCue(
  text: string,
  language: 'en' | 'fr' = 'en',
): Promise<void> {
  if (!text?.trim()) return;
  // Honor the global voice-playback toggle (Settings → Voice).
  if (!isVoiceEnabledSync()) return;

  // Web: use browser speech synthesis. Cues on web are rare; skip the round-trip.
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.88;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  try {
    const base64 = await fetchCueAudio(text);
    if (!base64) throw new Error('No cloud audio');
    await playCueNative(base64);
  } catch {
    await fallbackExpoSpeech(text, language);
  }
}
