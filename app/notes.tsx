/**
 * Notes screen — repository for all notes Robert has created:
 * - 🧠 Memory notes (knowledge_fragments saved via REMEMBER)
 * - 📁 Drive notes (Google Docs saved via SAVE_TO_DRIVE)
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
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
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [driveNotes, setDriveNotes] = useState<DriveNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'memory' | 'drive'>('memory');

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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
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
              {driveNotes.length === 0 ? (
                <Text style={styles.empty}>
                  No Drive notes yet.{'\n'}Say "save a note called…" to Naavi to create one.
                </Text>
              ) : (
                driveNotes.map(note => (
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
                ))
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
