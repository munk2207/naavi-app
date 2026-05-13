/**
 * Lists screen — F1a Wave 2 Phase B (Wael 2026-05-13).
 *
 * Shows the user's voice-managed lists with three subcategory tabs:
 *   All         — every list this user owns
 *   Attached    — lists that have at least one row in list_connections
 *   Standalone  — lists with no rows in list_connections
 *
 * Vocabulary is "Attached/Detached" per prompt v69 (Wael 2026-05-12) —
 * NOT "Connected/Disconnected". Mobile UI mirrors the voice surface.
 *
 * Tap a row → /lists/[id] for the list-detail screen with the
 * "Attached to:" header.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { getSessionWithTimeout, queryWithTimeout } from '@/lib/invokeWithTimeout';

// ─── Types ─────────────────────────────────────────────────────────────────

type ListRow = {
  id:              string;
  name:            string;
  category:        string;
  drive_file_id:   string;
  web_view_link:   string | null;
  attachmentCount: number;
};

type TabKey = 'all' | 'attached' | 'standalone';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'attached',   label: 'Attached' },
  { key: 'standalone', label: 'Standalone' },
];

// ─── Screen ────────────────────────────────────────────────────────────────

export default function ListsScreen() {
  const [lists, setLists]           = useState<ListRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [tab, setTab]               = useState<TabKey>('all');

  const load = useCallback(async () => {
    try {
      setError(null);
      if (!supabase) { setLoading(false); return; }
      const session = await getSessionWithTimeout();
      if (!session?.user) { setLoading(false); return; }

      // Fetch lists + connections in parallel — RLS lets the user read
      // both tables filtered to their own user_id.
      const [listsRes, connsRes] = await Promise.all([
        queryWithTimeout(
          supabase
            .from('lists')
            .select('id, name, category, drive_file_id, web_view_link')
            .eq('user_id', session.user.id)
            .order('name', { ascending: true }),
          15_000,
          'lists-load',
        ),
        queryWithTimeout(
          supabase
            .from('list_connections')
            .select('list_id')
            .eq('user_id', session.user.id),
          15_000,
          'list-connections-count',
        ),
      ]);

      if (listsRes.error) throw listsRes.error;

      // Count connections per list_id in JS — small enough that an
      // aggregate query isn't worth the round-trip.
      const counts: Record<string, number> = {};
      if (Array.isArray(connsRes.data)) {
        for (const row of connsRes.data as any[]) {
          const id = String(row.list_id);
          counts[id] = (counts[id] ?? 0) + 1;
        }
      }

      const rows: ListRow[] = ((listsRes.data ?? []) as any[]).map(r => ({
        id:              String(r.id),
        name:            String(r.name ?? ''),
        category:        String(r.category ?? 'other'),
        drive_file_id:   String(r.drive_file_id ?? ''),
        web_view_link:   r.web_view_link ?? null,
        attachmentCount: counts[String(r.id)] ?? 0,
      }));
      setLists(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load lists');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const filtered = useMemo(() => {
    if (tab === 'attached')   return lists.filter(l => l.attachmentCount > 0);
    if (tab === 'standalone') return lists.filter(l => l.attachmentCount === 0);
    return lists;
  }, [lists, tab]);

  const counts = useMemo(() => ({
    all:        lists.length,
    attached:   lists.filter(l => l.attachmentCount > 0).length,
    standalone: lists.filter(l => l.attachmentCount === 0).length,
  }), [lists]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.tabsRow}>
        {TABS.map(({ key, label }) => {
          const isActive = tab === key;
          const count = counts[key];
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setTab(key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {label} {count > 0 && <Text style={styles.tabCount}>({count})</Text>}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {loading && lists.length === 0 && (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && filtered.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="list" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>
              {tab === 'all'        ? 'No lists yet.'
               : tab === 'attached' ? 'No attached lists.'
               :                      'No standalone lists.'}
            </Text>
            <Text style={styles.emptyTip}>Try: "Create a grocery list"</Text>
          </View>
        )}

        {filtered.map(l => (
          <TouchableOpacity
            key={l.id}
            style={styles.row}
            onPress={() => router.push({ pathname: '/lists/[id]', params: { id: l.id } })}
            activeOpacity={0.75}
          >
            <Ionicons name="list" size={22} color={Colors.accent} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{l.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {l.attachmentCount > 0
                  ? `Attached to ${l.attachmentCount} ${l.attachmentCount === 1 ? 'item' : 'items'}`
                  : 'Standalone'}
                {l.category && l.category !== 'other' ? ` · ${l.category}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.bgApp },
  tabsRow:       {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: Colors.bgElevated,
  },
  tabActive: {
    backgroundColor: Colors.accent,
  },
  tabLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#fff',
  },
  tabCount: {
    fontWeight: '400',
    opacity: 0.85,
  },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center:        { paddingVertical: 60, alignItems: 'center' },
  errorBox: {
    backgroundColor: Colors.alert,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: { color: '#fff', fontSize: 14 },
  emptyWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: { color: Colors.textSecondary, fontSize: 17, fontWeight: '500', marginTop: 12 },
  emptyTip:  { color: Colors.textMuted, fontSize: 15, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  rowTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
  rowSub:   { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
});
