/**
 * Help hub screen
 *
 * Accessed from the 3-dot menu → Help on the home screen. Lists the
 * support paths available to Robert: how to use MyNaavi, FAQ, report a
 * problem, contact support, about/legal. Each row routes to a dedicated
 * screen or opens a mailto: link.
 *
 * Content for How-to / FAQ is a placeholder for now — the frame ships
 * so Report-a-problem is reachable; real copy fills in later.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

const HOW_TO_URL = 'https://mynaavi.com/how-to-use';
const FAQ_URL    = 'https://mynaavi.com/faq';

type Row = {
  icon:        React.ComponentProps<typeof Ionicons>['name'];
  label:       string;
  sub:         string;
  onPress:     () => void;
};

export default function HelpScreen() {
  const router = useRouter();

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', `Please visit ${url} in your browser.`);
    });
  };

  const rows: Row[] = [
    {
      icon: 'help-circle',
      label: 'How to use MyNaavi',
      sub: 'The basics — speaking, setting alerts, organising notes',
      onPress: () => openUrl(HOW_TO_URL),
    },
    {
      icon: 'document-text',
      label: 'Frequently asked',
      sub: 'Common questions, answered',
      onPress: () => openUrl(FAQ_URL),
    },
    {
      icon: 'bug',
      label: 'Report a problem',
      sub: 'Something broken or wrong? Tell us.',
      onPress: () => router.push('/report'),
    },
    {
      icon: 'mail',
      label: 'Contact support',
      sub: 'Questions, feedback, anything else',
      onPress: () => router.push('/contact'),
    },
    {
      icon: 'information-circle',
      label: 'About & Legal',
      sub: 'Version, privacy, terms',
      onPress: () => router.push('/about'),
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>We're here to help.</Text>
        <Text style={styles.sub}>
          Pick the option that fits what you need. Every message reaches the MyNaavi team directly.
        </Text>

        <View style={styles.rowList}>
          {rows.map(row => (
            <TouchableOpacity
              key={row.label}
              style={styles.row}
              onPress={row.onPress}
              activeOpacity={0.75}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={row.icon} size={26} color={Colors.accent} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowSub}>{row.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  heading: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  sub: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 24,
  },
  rowList: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(93,202,165,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: { flex: 1 },
  rowLabel: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  rowSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
});
