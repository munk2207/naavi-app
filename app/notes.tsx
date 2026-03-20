/**
 * Notes screen — repository for all notes Robert has created:
 * - 🧠 Memory notes (knowledge_fragments saved via REMEMBER)
 * - 📁 Drive notes (naavi_notes table + Drive search for older docs)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { searchDriveFiles, type DriveFile } from '@/lib/drive';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryNote {
  id: string;
  type: string;
  content: string;
  source: string;
  classification: string;
  created_at: string;
}

interface DriveNote {
  id: string;
  title: string;
  web_view_link: string | null;
  created_at: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotesScreen() {
  const router = useRouter();
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [driveNotes, setDriveNotes] = useState<DriveNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'memory' | 'drive'>('memory');

  // Drive search state
  const [driveQuery, setDriveQuery] = useState('');
  const [driveSearchResults, setDriveSearchResults] = useState<DriveFile[]>([]);
  const [driveSearching, setDriveSearching] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!supabase) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const [memRes, driveRes] = await Promise.all([
      supabase
        .from('knowledge_fragments')
        .select('id, type, content, source, classification, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('naavi_notes')
        .select('id, title, web_view_link, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (memRes.error)  console.error('[Notes] knowledge_fragments error:', memRes.error.message);
    if (driveRes.error) console.error('[Notes] naavi_notes error:', driveRes.error.message);

    if (memRes.data)   setMemoryNotes(memRes.data);
    if (driveRes.data) setDriveNotes(driveRes.data);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadNotes().finally(() => setLoading(false));
  }, [loadNotes]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadNotes();
    setRefreshing(false);
  }

  async function handleDriveSearch() {
    const q = driveQuery.trim();
    if (!q) return;
    setDriveSearching(true);
    const files = await searchDriveFiles(q);
    setDriveSearchResults(files);
    setDriveSearching(false);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function typeLabel(type: string): string {
    const labels: Record<string, string> = {
      life_story:     'Life story',
      important_date: 'Important date',
      preference:     'Preference',
      relationship:   'Relationship',
      place:          'Place',
      routine:        'Routine',
      concern:        'Concern',
    };
    return labels[type] ?? type;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notes</Text>
        <View style={{ width: 64 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'memory' && styles.tabActive]}
          onPress={() => setActiveTab('memory')}
        >
          <Text style={[styles.tabText, activeTab === 'memory' && styles.tabTextActive]}>
            🧠 Memory ({memoryNotes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'drive' && styles.tabActive]}
          onPress={() => setActiveTab('drive')}
        >
          <Text style={[styles.tabText, activeTab === 'drive' && styles.tabTextActive]}>
            📁 Drive Notes ({driveNotes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
        >
          {/* ── Memory tab ── */}
          {activeTab === 'memory' && (
            <>
              {memoryNotes.length === 0 ? (
                <Text style={styles.empty}>
                  No memory notes yet.{'\n'}Say "remember that…" to Naavi to save something here.
                </Text>
              ) : (
                memoryNotes.map(note => (
                  <View key={note.id} style={styles.memoryCard}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.memoryType}>{typeLabel(note.type)}</Text>
                      <Text style={styles.cardDate}>{formatDate(note.created_at)}</Text>
                    </View>
                    <Text style={styles.memoryContent}>{note.content}</Text>
                    <Text style={styles.cardMeta}>{note.classification} · via {note.source}</Text>
                  </View>
                ))
              )}
            </>
          )}

          {/* ── Drive notes tab ── */}
          {activeTab === 'drive' && (
            <>
              {/* Drive search — find older docs saved before this table existed */}
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  value={driveQuery}
                  onChangeText={setDriveQuery}
                  placeholder="Search your Google Drive…"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="search"
                  onSubmitEditing={handleDriveSearch}
                />
                <TouchableOpacity
                  style={styles.searchBtn}
                  onPress={handleDriveSearch}
                  disabled={driveSearching || !driveQuery.trim()}
                >
                  {driveSearching
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.searchBtnText}>Search</Text>}
                </TouchableOpacity>
              </View>

              {/* Drive search results */}
              {driveSearchResults.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Search Results</Text>
                  {driveSearchResults.map(file => (
                    <TouchableOpacity
                      key={file.id}
                      style={styles.driveCard}
                      onPress={() => Linking.openURL(file.webViewLink)}
                      activeOpacity={0.75}
                      accessibilityLabel={`Open ${file.name} in Google Drive`}
                    >
                      <Text style={styles.driveTitle}>{file.name}</Text>
                      <Text style={styles.cardDate}>
                        Modified {new Date(file.modifiedTime).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                      <Text style={styles.driveLink}>Tap to open ↗</Text>
                    </TouchableOpacity>
                  ))}
                  <View style={styles.divider} />
                </>
              )}

              {/* Saved notes from naavi_notes table */}
              {driveNotes.length === 0 ? (
                <Text style={styles.empty}>
                  No saved notes yet.{'\n\n'}Notes you create going forward ("save a note called…") will appear here.{'\n\n'}Use the search above to find any older notes in your Google Drive.
                </Text>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Saved Notes</Text>
                  {driveNotes.map(note => (
                    <TouchableOpacity
                      key={note.id}
                      style={styles.driveCard}
                      onPress={() => note.web_view_link ? Linking.openURL(note.web_view_link) : undefined}
                      activeOpacity={note.web_view_link ? 0.75 : 1}
                      accessibilityLabel={`Open ${note.title} in Google Docs`}
                    >
                      <View style={styles.cardHeader}>
                        <Text style={styles.driveTitle}>{note.title}</Text>
                      </View>
                      <Text style={styles.cardDate}>{formatDate(note.created_at)}</Text>
                      {note.web_view_link && (
                        <Text style={styles.driveLink}>Tap to open in Google Docs ↗</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 64,
  },
  backText: {
    fontSize: Typography.base,
    color: Colors.primary,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: Typography.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: Typography.sm,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tabTextActive: {
    color: Colors.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  empty: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 48,
    lineHeight: 24,
  },
  sectionLabel: {
    fontSize: Typography.sm,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  searchBtn: {
    backgroundColor: '#4285F4',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: Typography.sm,
  },
  memoryCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#7C3AED',
    padding: 14,
    marginBottom: 10,
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  memoryType: {
    fontSize: Typography.sm,
    fontWeight: '700',
    color: '#7C3AED',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  memoryContent: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBase,
  },
  cardDate: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  cardMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    textTransform: 'capitalize',
  },
  driveCard: {
    backgroundColor: '#F0F7FF',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4285F4',
    padding: 14,
    marginBottom: 10,
    gap: 2,
  },
  driveTitle: {
    fontSize: Typography.base,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  driveLink: {
    fontSize: Typography.sm,
    color: '#4285F4',
    marginTop: 4,
  },
});
