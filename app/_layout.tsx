/**
 * Root layout — wraps every screen in Naavi.
 * Sets up navigation, i18n, and safe area handling.
 */

import { useEffect, useState } from 'react';
import { Platform, View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import '../lib/i18n'; // Initialise i18n before any screen renders
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
import { justForegrounded, msSinceForeground, getLifecycleSession } from '@/lib/appLifecycle';
import { remoteLog, newDiagSession } from '@/lib/remoteLog';
import { syncDeviceTimezone } from '@/lib/location';
import { registerPushNotifications } from '@/lib/push';
import { useGeofencing } from '@/hooks/useGeofencing';

// V57.12.4 Bug H instrumentation — global JS error / unhandled-rejection
// trap. The crash leaves diagnostic silence — no console.error trail and
// no unhandledRejection log. Install global handlers HERE, at the
// outermost layout, so any uncaught throw / rejection is captured before
// the JS engine dies. Each event writes to client_diagnostics.
//
// This must run synchronously at module load so it's installed before
// any other code can throw. We use a separate diag session so events
// don't get interleaved with chat / orchestrator traffic.
(function installGlobalErrorHandlers() {
  const errorDiag = newDiagSession();
  try {
    const ErrUtils = (globalThis as any).ErrorUtils;
    if (ErrUtils && typeof ErrUtils.setGlobalHandler === 'function') {
      const previous = typeof ErrUtils.getGlobalHandler === 'function' ? ErrUtils.getGlobalHandler() : null;
      ErrUtils.setGlobalHandler((err: any, isFatal: boolean) => {
        try {
          remoteLog(errorDiag, 'global-error', {
            isFatal,
            name: String(err?.name ?? ''),
            message: String(err?.message ?? err ?? '').slice(0, 300),
            stack: String(err?.stack ?? '').slice(0, 600),
          });
        } catch { /* never throw inside the handler */ }
        // Chain to React Native's red-box / debug handler.
        if (typeof previous === 'function') {
          try { previous(err, isFatal); } catch { /* swallow */ }
        }
      });
    }
  } catch { /* swallow */ }

  // Unhandled promise rejection. RN's promise polyfill emits this via
  // HermesInternal in newer engines and via the global event in web.
  try {
    if (typeof (globalThis as any).addEventListener === 'function') {
      (globalThis as any).addEventListener('unhandledrejection', (event: any) => {
        try {
          const reason = event?.reason;
          remoteLog(errorDiag, 'unhandled-rejection', {
            name: String(reason?.name ?? ''),
            message: String(reason?.message ?? reason ?? '').slice(0, 300),
            stack: String(reason?.stack ?? '').slice(0, 600),
          });
        } catch { /* never throw */ }
      });
    }
  } catch { /* swallow */ }
})();

// Handle Google OAuth deep link callback (naavi://auth/callback#access_token=...)
// V57.7 — wrapped in try/catch. A throw here was a candidate for the
// blank-screen bug when signing in as mynaavi2207. Auth callback errors
// must not crash the app — fail silently and let the user retry.
async function handleAuthCallback(url: string) {
  try {
    if (!url.includes('auth/callback')) return;
    const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1] ?? '';
    const params = new URLSearchParams(fragment);
    const access_token           = params.get('access_token');
    const refresh_token          = params.get('refresh_token');
    const provider_refresh_token = params.get('provider_refresh_token');

    if (access_token && refresh_token && supabase) {
      // Set the Supabase session so the user is logged in
      await supabase.auth.setSession({ access_token, refresh_token });

      // Get the Google refresh token — first try the URL, then the session object
      // Supabase doesn't always include it in the URL so session is more reliable
      let googleToken = provider_refresh_token;
      if (!googleToken) {
        const session = await getSessionWithTimeout();
        googleToken = session?.provider_refresh_token ?? null;
      }

      if (googleToken) {
        invokeWithTimeout('store-google-token', {
          body: { refresh_token: googleToken },
        }, 15_000).catch((err) => console.error('[layout] store-google-token failed:', err));
      }
    }
  } catch (err) {
    console.error('[layout] handleAuthCallback threw:', err);
  }
}

export default function RootLayout() {
  // Track the current user id so child hooks (useGeofencing) can re-sync
  // when auth changes.
  const [userId, setUserId] = useState<string | null>(null);

  // Always start at the home screen on cold launch. Expo-router persists
  // navigation state so a previous Settings visit would reopen there.
  useEffect(() => { router.replace('/'); }, []);

  // Wire geofence lifecycle to the current user. Handles auth changes,
  // foreground re-sync, and owns the OS geofence registration.
  useGeofencing(userId);

  useEffect(() => {
    if (!supabase) return;

    // Get the initial session, then subscribe to auth state changes.
    let mounted = true;

    // Fire-and-forget auto-register for push. Only triggers when the native
    // permission status is "undetermined" — i.e., the user hasn't answered
    // the OS prompt yet. On second and later launches, we never re-ask;
    // granted stays granted, denied stays denied until the user manually
    // taps "Enable" in Settings. AAB item #8 — push default ON.
    //
    // V57.9.1 — also re-register when permission is already granted. FCM
    // tokens rotate (app reinstall, OS update, Firebase rotation policy);
    // without this, the DB row carries a stale token forever and every
    // alert delivers 0/N. save-push-subscription upserts by endpoint, so
    // calling it on every launch is idempotent — same token → no-op,
    // fresh token → row updated. Wael testing 2026-04-30 surfaced this
    // class: 6 dead FCM tokens accumulated over weeks of installs.
    const maybeAutoRegisterPush = async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'undetermined' || status === 'granted') {
          await registerPushNotifications();
        }
      } catch { /* silent */ }
    };

    // V57.7 — wrap startup work in try/catch. If any of these throws
    // (network blip, expired token, missing native module), the app
    // must not crash. Defensive against the V57.6 blank-screen-on-
    // sign-in bug Wael hit with the test user mynaavi2207.
    // V57.9.9 diagnostic — log the cold-start session restoration result.
    // This is the moment we discover whether SecureStore handed back a valid
    // session. If session is null here on a cold start AFTER a "Allow all the
    // time" toggle, it means Android killed the activity AND the storage
    // restore did not return the prior session.
    remoteLog(getLifecycleSession(), 'layout-coldstart-session-start');
    getSessionWithTimeout()
      .then((session) => {
        if (!mounted) return;
        const uid = session?.user?.id ?? null;
        remoteLog(getLifecycleSession(), 'layout-coldstart-session-end', {
          has_session: !!session,
          has_user: !!uid,
          has_provider_refresh_token: !!session?.provider_refresh_token,
        });
        setUserId(uid);
        if (uid) {
          syncDeviceTimezone(uid).catch((err) => console.error('[layout] timezone sync failed:', err));
          maybeAutoRegisterPush().catch((err) => console.error('[layout] push register failed:', err));
        }
      })
      .catch((err) => {
        remoteLog(getLifecycleSession(), 'layout-coldstart-session-error', {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
        console.error('[layout] getSession failed:', err);
      });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      try {
        const uid = session?.user?.id ?? null;
        console.log('[layout] onAuthStateChange:', event, 'uid:', uid ?? 'none', 'msSinceFg:', msSinceForeground());
        remoteLog(getLifecycleSession(), 'layout-auth-event', {
          event,
          has_session: !!session,
          has_user: !!uid,
          has_provider_refresh_token: !!session?.provider_refresh_token,
          ms_since_fg: msSinceForeground(),
        });
        // V57.9.8 defensive — same rationale as app/index.tsx. If the
        // SDK fires SIGNED_OUT (uid becomes null) within 5 s of returning
        // from background, don't trust it. Re-poll after 1.5 s and only
        // clear local state if the re-poll also reports no session.
        if (!uid && event === 'SIGNED_OUT' && justForegrounded(5_000)) {
          console.warn('[layout] SIGNED_OUT during foreground window — ignoring + re-polling');
          setTimeout(async () => {
            try {
              const recheck = await getSessionWithTimeout();
              const recheckUid = recheck?.user?.id ?? null;
              if (!recheckUid) {
                console.warn('[layout] re-poll confirms no session — clearing userId');
                setUserId(null);
              } else {
                console.log('[layout] re-poll restored session:', recheckUid);
                setUserId(recheckUid);
              }
            } catch { /* leave userId as-is */ }
          }, 1500);
          return;
        }
        setUserId(uid);
        if (uid) {
          syncDeviceTimezone(uid).catch((err) => console.error('[layout] timezone sync failed:', err));
          maybeAutoRegisterPush().catch((err) => console.error('[layout] push register failed:', err));
        }
      } catch (err) {
        console.error('[layout] onAuthStateChange handler threw:', err);
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  // OTA updates disabled — all deploys go through Google Play builds
  // useEffect(() => {
  //   async function checkForOTA() {
  //     try {
  //       const update = await Updates.checkForUpdateAsync();
  //       if (update.isAvailable) {
  //         await Updates.fetchUpdateAsync();
  //         await Updates.reloadAsync();
  //       }
  //     } catch (e) {
  //       console.log('[OTA] Error:', e);
  //     }
  //   }
  //   checkForOTA();
  // }, []);

  useEffect(() => {
    // Listen for deep links while app is open
    const sub = Linking.addEventListener('url', ({ url }) => handleAuthCallback(url));
    // Handle deep link that launched the app
    Linking.getInitialURL().then(url => { if (url) handleAuthCallback(url); });

    // Android: set up notification channel and handle notification taps
    if (Platform.OS === 'android') {
      // Handle tap on a notification when the app is in the foreground or background
      const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const url = response.notification.request.content.data?.url as string | undefined;
        if (url) {
          // Route to the deep link embedded in the notification (e.g. naavi://brief)
          Linking.openURL(url).catch(() => router.replace('/'));
        }
      });

      return () => {
        sub.remove();
        notifSub.remove();
      };
    }

    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <InsetDiagnostic />
      <StatusBar style="light" backgroundColor={Colors.bgApp} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.bgApp },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '600', fontSize: 17 },
          headerShadowVisible: false, // removes the thin divider line under the header
          // Ensure a visible back chevron on every pushed screen. Some Android
          // builds + the web preview hide the OS default. canGoBack is unreliable
          // in expo-router's headerLeft callback (sometimes undefined) — always
          // render the chevron and let router.back() silently no-op if there's
          // nothing to pop. Root screens (index.tsx) explicitly set
          // headerLeft: () => null.
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
            </TouchableOpacity>
          ),
          contentStyle: { backgroundColor: Colors.bgApp },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerShown: true,
            headerTitle: () => (
              <View style={headerStyles.container}>
                <Image
                  source={require('../assets/mynaavi-logo-transparent.png')}
                  style={headerStyles.logo}
                  resizeMode="contain"
                  accessibilityLabel="MyNaavi logo"
                />
                <Text style={headerStyles.title}>
                  <Text style={headerStyles.white}>My</Text>
                  <Text style={headerStyles.teal}>Naavi</Text>
                </Text>
              </View>
            ),
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings', headerShown: true }}
        />
        <Stack.Screen
          name="notes"
          options={{ title: 'My Notes', headerShown: true }}
        />
        <Stack.Screen
          name="alerts"
          options={{ title: 'Your Alerts', headerShown: true }}
        />
        <Stack.Screen
          name="lists"
          options={{ title: 'Your Lists', headerShown: true }}
        />
        <Stack.Screen
          name="lists/[id]"
          options={{ title: 'List details', headerShown: true }}
        />
        <Stack.Screen
          name="help"
          options={{ title: 'Help', headerShown: true }}
        />
        <Stack.Screen
          name="report"
          options={{ title: 'Report a problem', headerShown: true }}
        />
        <Stack.Screen
          name="contact"
          options={{ title: 'Contact support', headerShown: true }}
        />
        <Stack.Screen
          name="about"
          options={{ title: 'Terms & Legal', headerShown: true }}
        />
        <Stack.Screen
          name="permission-location"
          options={{ title: 'Location alerts', headerShown: true }}
        />
        {/* Google Assistant App Action deep link screens — transient, no header */}
        <Stack.Screen name="brief"    options={{ headerShown: false }} />
        <Stack.Screen name="calendar" options={{ headerShown: false }} />
        <Stack.Screen name="contacts" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}

// V57.19 — instruments the inset-leak bug Wael reported ("screen draws behind
// the nav bar until I force-stop the app"). Logs every inset change to
// client_diagnostics so we can identify which UI event corrupts the state.
// Renders nothing. Must be a child of SafeAreaProvider.
function InsetDiagnostic() {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    remoteLog(getLifecycleSession(), 'inset-snapshot', {
      top:    insets.top,
      bottom: insets.bottom,
      left:   insets.left,
      right:  insets.right,
    });
  }, [insets.top, insets.bottom, insets.left, insets.right]);
  return null;
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 28,
    height: 28,
  },
  title: {
    fontWeight: '600',
    fontSize: 17,
  },
  white: {
    color: Colors.textPrimary,
  },
  teal: {
    color: '#5DCAA5',
  },
});
