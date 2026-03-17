/**
 * Settings screen
 *
 * Robert controls his preferences here:
 * - Language (English / French)
 * - Anthropic API key (entered once, stored securely)
 * - Connected tools status
 * - Response detail preference
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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { saveApiKey, getApiKey, hasApiKey } from '@/lib/naavi-client';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [language, setLanguage] = useState<'en' | 'fr'>(
    (i18n.language as 'en' | 'fr') ?? 'en'
  );

  useEffect(() => {
    hasApiKey().then(setApiKeySet);
  }, []);

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

  function handleLanguageToggle(value: boolean) {
    const newLang = value ? 'fr' : 'en';
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>English</Text>
            <Switch
              value={language === 'fr'}
              onValueChange={handleLanguageToggle}
              trackColor={{ false: Colors.border, true: Colors.primaryMid }}
              thumbColor={Colors.surface}
              accessibilityLabel="Toggle language"
            />
            <Text style={styles.rowLabel}>Français</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* API key */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anthropic API Key</Text>
          <Text style={styles.sectionNote}>
            {apiKeySet
              ? '✓ Key is saved. Enter a new one below to replace it.'
              : 'Enter your API key to enable Naavi. Get one at console.anthropic.com.'}
          </Text>
          <TextInput
            style={styles.keyInput}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-ant-..."
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Anthropic API key input"
          />
          <TouchableOpacity
            style={[styles.saveBtn, !apiKey.trim() && styles.saveBtnDisabled]}
            onPress={handleSaveApiKey}
            disabled={!apiKey.trim()}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>Save key</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Connected tools */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.connected')}</Text>
          {[
            { label: t('settings.calendar'),  status: 'coming' },
            { label: t('settings.health'),    status: 'coming' },
            { label: t('settings.smartHome'), status: 'coming' },
          ].map(tool => (
            <View key={tool.label} style={styles.toolRow}>
              <Text style={styles.toolLabel}>{tool.label}</Text>
              <Text style={styles.comingSoon}>Phase 8</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* Version */}
        <Text style={styles.version}>Naavi — Phase 7 build</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  sectionNote: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: Typography.touchTargetIdeal,
  },
  rowLabel: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  keyInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: Typography.touchTargetIdeal,
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: Colors.textOnDark,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: 24,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: Typography.touchTargetIdeal,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  toolLabel: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  comingSoon: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  version: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
