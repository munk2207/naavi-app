/**
 * Notes screen — Memory and Drive Notes with select & delete
 *
 * Memory tab:     items from knowledge_fragments (what Naavi has learned about Robert)
 * Drive Notes tab: files saved by MyNaavi to Google Drive (naavi_notes table)
 *
 * Both tabs support:
 *  - Select All checkbox at the top
 *  - Individual checkboxes on each item
 *  - Delete button that removes selected items
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
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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

// ─── Checkbox component ───────────────────────────────────────────────────────

function Checkbox({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={cbStyles.box} accessibilityRole="checkbox">
      {checked && <Text style={cbStyles.tick}>✓</Text>}
    </TouchableOpacity>
  );
}

const cbStyles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.accent,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  tick: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [memoryNotes, setMemoryNotes]   = useState<MemoryNote[]>([]);
  const [driveNotes,  setDriveNotes]    = useState<DriveNote[]>([]);
  const [loading,     setLoading]       = useState(true);
  const [refreshing,  setRefreshing]    = useState(false);
  const [activeTab,   setActiveTab]     = useState<'memory' | 'drive'>('memory');
  const [deleting,    setDeleting]      = useState(false);

  // Selection state
  const [selectedMemory, setSelectedMemory] = useState<Set<string>>(new Set());
  const [selectedDrive,  setSelectedDrive]  = useState<Set<string>>(new Set());

  // Drive search state
  const [driveQuery,         setDriveQuery]         = useState('');
  const [driveSearchResults, setDriveSearchResults] = useState<DriveFile[]>([]);
  const [driveSearching,     setDriveSearching]     = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

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

    // Clear selections on refresh
    setSelectedMemory(new Set());
    setSelectedDrive(new Set());
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

  // ── Drive search ─────────────────────────────────────────────────────────────

  async function handleDriveSearch() {
    const q = driveQuery.trim();
    if (!q) return;
    setDriveSearching(true);
    const files = await searchDriveFiles(q);
    setDriveSearchResults(files);
    setDriveSearching(false);
  }

  // ── Selection helpers ────────────────────────────────────────────────────────

  function toggleMemory(id: string) {
    setSelectedMemory(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleDrive(id: string) {
    setSelectedDrive(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAllMemory() {
    if (selectedMemory.size === memoryNotes.length) {
      setSelectedMemory(new Set());
    } else {
      setSelectedMemory(new Set(memoryNotes.map(n => n.id)));
    }
  }

  function toggleSelectAllDrive() {
    if (selectedDrive.size === driveNotes.length) {
      setSelectedDrive(new Set());
    } else {
      setSelectedDrive(new Set(driveNotes.map(n => n.id)));
    }
  }

  // ── Delete handlers ──────────────────────────────────────────────────────────

  function confirmDeleteMemory() {
    const count = selectedMemory.size;
    Alert.alert(
      'Delete Memory',
      `Remove ${count} memory item${count > 1 ? 's' : ''} from MyNaavi? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteMemory },
      ]
    );
  }

  async function deleteMemory() {
    if (!supabase || selectedMemory.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedMemory);
    const { error } = await supabase
      .from('knowledge_fragments')
      .delete()
      .in('id', ids);

    if (error) {
      Alert.alert('Error', 'Could not delete. Please try again.');
    } else {
      setMemoryNotes(prev => prev.filter(n => !selectedMemory.has(n.id)));
      setSelectedMemory(new Set());
    }
    setDeleting(false);
  }

  function confirmDeleteDrive() {
    const count = selectedDrive.size;
    Alert.alert(
      'Remove from MyNaavi',
      `Remove ${count} note${count > 1 ? 's' : ''} from MyNaavi? The files will stay in your Google Drive.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: deleteDrive },
      ]
    );
  }

  async function deleteDrive() {
    if (!supabase || selectedDrive.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedDrive);
    const { error } = await supabase
      .from('naavi_notes')
      .delete()
      .in('id', ids);

    if (error) {
      Alert.alert('Error', 'Could not remove. Please try again.');
    } else {
      setDriveNotes(prev => prev.filter(n => !selectedDrive.has(n.id)));
      setSelectedDrive(new Set());
    }
    setDeleting(false);
  }

  // ── Formatting ───────────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────────

  const memoryAllSelected = memoryNotes.length > 0 && selectedMemory.size === memoryNotes.length;
  const driveAllSelected  = driveNotes.length  > 0 && selectedDrive.size  === driveNotes.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.backBtn}>
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
            Memory ({memoryNotes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'drive' && styles.tabActive]}
          onPress={() => setActiveTab('drive')}
        >
          <Text style={[styles.tabText, activeTab === 'drive' && styles.tabTextActive]}>
            Drive Notes ({driveNotes.length})
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

          {/* ── Memory tab ─────────────────────────────────────────────────── */}
          {activeTab === 'memory' && (
            <>
              {memoryNotes.length === 0 ? (
                <Text style={styles.empty}>
                  No memory notes yet.{'\n'}Say "remember that…" to MyNaavi to save something here.
                </Text>
              ) : (
                <>
                  {/* Select All row */}
                  <View style={styles.selectAllRow}>
                    <Checkbox checked={memoryAllSelected} onPress={toggleSelectAllMemory} />
                    <Text style={styles.selectAllText}>
                      {memoryAllSelected ? 'Deselect all' : 'Select all'}
                    </Text>
                    {selectedMemory.size > 0 && (
                      <Text style={styles.selectedCount}>{selectedMemory.size} selected</Text>
                    )}
                  </View>

                  {memoryNotes.map(note => (
                    <TouchableOpacity
                      key={note.id}
                      style={[styles.memoryCard, selectedMemory.has(note.id) && styles.cardSelected]}
                      onPress={() => toggleMemory(note.id)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.cardRow}>
                        <Checkbox
                          checked={selectedMemory.has(note.id)}
                          onPress={() => toggleMemory(note.id)}
                        />
                        <View style={styles.cardBody}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.memoryType}>{typeLabel(note.type)}</Text>
                            <Text style={styles.cardDate}>{formatDate(note.created_at)}</Text>
                          </View>
                          <Text style={styles.memoryContent}>{note.content}</Text>
                          <Text style={styles.cardMeta}>{note.classification} · via {note.source}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}

          {/* ── Drive notes tab ─────────────────────────────────────────────── */}
          {activeTab === 'drive' && (
            <>
              {/* Drive search */}
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

              {/* Drive search results (read-only, no checkboxes) */}
              {driveSearchResults.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Search Results</Text>
                  {driveSearchResults.map(file => (
                    <TouchableOpacity
                      key={file.id}
                      style={styles.driveCard}
                      onPress={() => Linking.openURL(file.webViewLink)}
                      activeOpacity={0.75}
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

              {/* Saved notes with checkboxes */}
              {driveNotes.length === 0 ? (
                <Text style={styles.empty}>
                  No saved notes yet.{'\n\n'}Notes you create going forward ("save a note called…") will appear here.{'\n\n'}Use the search above to find any older notes in your Google Drive.
                </Text>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Saved Notes</Text>

                  {/* Select All row */}
                  <View style={styles.selectAllRow}>
                    <Checkbox checked={driveAllSelected} onPress={toggleSelectAllDrive} />
                    <Text style={styles.selectAllText}>
                      {driveAllSelected ? 'Deselect all' : 'Select all'}
                    </Text>
                    {selectedDrive.size > 0 && (
                      <Text style={styles.selectedCount}>{selectedDrive.size} selected</Text>
                    )}
                  </View>

                  {driveNotes.map(note => (
                    <TouchableOpacity
                      key={note.id}
                      style={[styles.driveCard, selectedDrive.has(note.id) && styles.cardSelected]}
                      onPress={() => toggleDrive(note.id)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.cardRow}>
                        <Checkbox
                          checked={selectedDrive.has(note.id)}
                          onPress={() => toggleDrive(note.id)}
                        />
                        <View style={styles.cardBody}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.driveTitle}>{note.title}</Text>
                          </View>
                          <Text style={styles.cardDate}>{formatDate(note.created_at)}</Text>
                          {note.web_view_link && (
                            <TouchableOpacity onPress={() => Linking.openURL(note.web_view_link!)}>
                              <Text style={styles.driveLink}>Tap to open in Google Docs ↗</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {/* Delete button — appears when anything is selected */}
      {((activeTab === 'memory' && selectedMemory.size > 0) ||
        (activeTab === 'drive'  && selectedDrive.size  > 0)) && (
        <View style={[styles.deleteBar, { paddingBottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={activeTab === 'memory' ? confirmDeleteMemory : confirmDeleteDrive}
            disabled={deleting}
          >
            {deleting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.deleteBtnText}>
                  Delete {activeTab === 'memory' ? selectedMemory.size : selectedDrive.size} item
                  {(activeTab === 'memory' ? selectedMemory.size : selectedDrive.size) > 1 ? 's' : ''}
                </Text>
            }
          </TouchableOpacity>
        </View>
      )}

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.bgApp,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:  { width: 64 },
  backText: { fontSize: Typography.body, color: Colors.accent, fontWeight: '600' },
  headerTitle: {
    fontSize: Typography.sectionHeading,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bgApp,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: Colors.accent },
  tabText: { fontSize: Typography.body, fontWeight: '600', color: Colors.textHint },
  tabTextActive: { color: Colors.accent },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },
  empty: {
    fontSize: Typography.body,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 48,
    lineHeight: Typography.lineHeightBody,
  },
  sectionLabel: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 16 },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  selectAllText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.accent,
    flex: 1,
  },
  selectedCount: {
    fontSize: Typography.body,
    color: Colors.textHint,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  cardBody: { flex: 1 },
  cardSelected: { opacity: 0.85, borderColor: Colors.accent, borderWidth: 2 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  memoryCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gentle,
    padding: 16,
    marginBottom: 10,
  },
  memoryType: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.gentle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  memoryContent: {
    fontSize: Typography.body,
    color: Colors.textPrimary,
    lineHeight: Typography.lineHeightBody,
  },
  cardDate: { fontSize: Typography.caption, color: Colors.textHint },
  cardMeta: { fontSize: Typography.caption, color: Colors.textHint, marginTop: 4, textTransform: 'capitalize' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    height: 48,
  },
  searchBtn: {
    backgroundColor: Colors.moderate,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: Typography.body },
  driveCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.moderate,
    padding: 16,
    marginBottom: 10,
  },
  driveTitle: {
    fontSize: Typography.cardTitle,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  driveLink: { fontSize: Typography.body, color: Colors.moderate, marginTop: 4 },
  deleteBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: Colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  deleteBtn: {
    backgroundColor: Colors.alert,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#fff', fontWeight: '700', fontSize: Typography.body },
});
