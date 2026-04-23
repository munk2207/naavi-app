/**
 * About & Legal screen
 *
 * Version info + links to Privacy Policy and Terms on the marketing site.
 * Accessed from Help → About & Legal.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors } from '@/constants/Colors';

const PRIVACY_URL = 'https://mynaavi.com/privacy';
const TERMS_URL   = 'https://mynaavi.com/terms';

export default function AboutScreen() {
  const version    = Constants.expoConfig?.version ?? '?';
  const buildCode  = Constants.expoConfig?.android?.versionCode ?? '?';
  const platformLine = `${Platform.OS === 'android' ? 'Android' : Platform.OS === 'ios' ? 'iOS' : Platform.OS} ${Platform.Version}`;

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', `Please visit ${url} in your browser.`);
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            <Text style={{ color: Colors.textPrimary }}>My</Text>
            <Text style={{ color: Colors.accent }}>Naavi</Text>
          </Text>
          <Text style={styles.heroSub}>Your life, orchestrated.</Text>
        </View>

        <View style={styles.versionCard}>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Version</Text>
            <Text style={styles.versionValue}>V{version} (build {buildCode})</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Platform</Text>
            <Text style={styles.versionValue}>{platformLine}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Legal</Text>

        <TouchableOpacity style={styles.row} onPress={() => openUrl(PRIVACY_URL)} activeOpacity={0.75}>
          <View style={styles.rowIcon}>
            <Ionicons name="lock-closed" size={22} color={Colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <Text style={styles.rowSub}>How your data is handled</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => openUrl(TERMS_URL)} activeOpacity={0.75}>
          <View style={styles.rowIcon}>
            <Ionicons name="document-text" size={22} color={Colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Terms of Service</Text>
            <Text style={styles.rowSub}>Conditions of use</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.copyright}>
          © 2026 MyNaavi.{'\n'}Made with care for active seniors.
        </Text>
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
    paddingTop: 32,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 28,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroSub: {
    color: Colors.textSecondary,
    fontSize: 15,
    marginTop: 6,
    fontStyle: 'italic',
  },
  versionCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 28,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  versionLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  versionValue: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(93,202,165,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
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
  copyright: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 40,
  },
});
