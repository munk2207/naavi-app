/**
 * manage.tsx — Authenticated in-app WebView for management screens.
 *
 * Design principle (Wael 2026-05-30):
 *   Mobile = conversation. Web = management.
 *   This screen is the bridge — it opens any management URL inside the app,
 *   passing the user's Supabase session token silently so the web page is
 *   already authenticated. Robert never sees a browser, never types a URL,
 *   never logs in separately.
 *
 * Usage (from any screen):
 *   router.push({ pathname: '/manage', params: { url: 'settings', title: 'Settings' } });
 *
 * The `url` param is a short key ('settings' | 'alerts' | 'lists' | 'notes').
 * This screen resolves it to the full https://mynaavi.com/manage/<key> URL
 * and appends #token=<access_token> as a fragment (fragments never appear
 * in server logs — safer than query params).
 *
 * The web page reads window.location.hash, extracts the token, and calls
 * supabase.auth.setSession({ access_token, refresh_token }) to authenticate.
 *
 * Offline handling: if the page fails to load, a clean "Can't load" screen
 * is shown with a Retry button — no blank white page.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';

const BASE_URL = 'https://mynaavi.com/manage';

// Short key → full URL. Add new management pages here.
const MANAGED_URLS: Record<string, string> = {
  settings: `${BASE_URL}/settings`,
  alerts:   `${BASE_URL}/alerts`,
  lists:    `${BASE_URL}/lists`,
  notes:    `${BASE_URL}/notes`,
};

export default function ManageScreen() {
  const router = useRouter();
  const { url: urlKey, title = 'Settings' } = useLocalSearchParams<{ url: string; title: string }>();

  const [loading, setLoading]   = useState(true);
  const [offline, setOffline]   = useState(false);
  const [webUrl,  setWebUrl]    = useState<string | null>(null);
  const webRef = useRef<WebView>(null);

  // Build the authenticated URL on first render.
  React.useEffect(() => {
    (async () => {
      const target = urlKey ? (MANAGED_URLS[urlKey] ?? `${BASE_URL}/${urlKey}`) : MANAGED_URLS.settings;
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken  = data?.session?.access_token;
        const refreshToken = data?.session?.refresh_token;
        if (accessToken) {
          // Pass tokens in the fragment — never sent to the server.
          const fragment = `#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken ?? '')}`;
          setWebUrl(target + fragment);
        } else {
          // No session — open unauthenticated (web page will show a sign-in prompt).
          setWebUrl(target);
        }
      } catch {
        setWebUrl(target);
      }
    })();
  }, [urlKey]);

  const handleLoadEnd = useCallback(() => setLoading(false), []);
  const handleError   = useCallback(() => { setLoading(false); setOffline(true); }, []);

  const retry = useCallback(() => {
    setOffline(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.accent} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Loading overlay */}
      {loading && !offline && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      )}

      {/* Offline screen */}
      {offline && (
        <View style={styles.offlineScreen}>
          <Ionicons name="cloud-offline-outline" size={52} color={Colors.textHint} />
          <Text style={styles.offlineTitle}>Can't load settings</Text>
          <Text style={styles.offlineSub}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={retry} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* WebView */}
      {webUrl && !offline && (
        <WebView
          ref={webRef}
          source={{ uri: webUrl }}
          style={styles.webview}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          onHttpError={handleError}
          // Allow the web page to use localStorage for Supabase client session.
          domStorageEnabled
          // Keep the web page from opening external links inside this WebView.
          onShouldStartLoadWithRequest={(req: WebViewNavigation) => {
            // Allow mynaavi.com pages only; open anything else in system browser.
            if (req.url.startsWith('https://mynaavi.com')) return true;
            return false;
          }}
          // Android: render above the keyboard correctly.
          androidLayerType="hardware"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    alignItems: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 60, // below header
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgApp,
    zIndex: 10,
  },
  offlineScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  offlineTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  offlineSub: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  retryText: {
    color: Colors.accentDark,
    fontSize: 16,
    fontWeight: '700',
  },
  webview: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
});
