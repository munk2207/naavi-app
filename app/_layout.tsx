/**
 * Root layout — wraps every screen in Naavi.
 * Sets up navigation, i18n, and safe area handling.
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/i18n'; // Initialise i18n before any screen renders
import { Colors } from '@/constants/Colors';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={Colors.primary} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.textOnDark,
          headerTitleStyle: { fontWeight: '600', fontSize: 18 },
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'Naavi', headerShown: true }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings', headerShown: true }}
        />
        <Stack.Screen
          name="notes"
          options={{ title: 'My Notes', headerShown: true }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
