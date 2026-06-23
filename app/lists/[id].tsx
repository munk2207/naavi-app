/**
 * List-detail screen — F1a Wave 2 Phase B (Wael 2026-05-13).
 *
 * Shows ONE list with three sections:
 *   1. Header   — list name + open-in-Drive icon.
 *   2. Attached to: — every entity in list_connections.list_id = :id,
 *                     each row resolved to a human label via the
 *                     resolve-entity-ref DESCRIBE op. Tap X to detach
 *                     just that entity (calls manage-list-connections
 *                     DISCONNECT under the hood).
 *   3. Items    — body lines from the Google Doc (read via read-drive-file).
 *
 * "Delete list" button at the bottom shows a cascade-warning modal,
 * then calls deleteListWithConnections.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import {
  invokeWithTimeout,
  queryWithTimeout,
  getSessionWithTimeout,
} from '@/lib/invokeWithTimeout';
import { readList, disableList, reactivateList } from '@/lib/lists';
import { disconnectEntityById, permanentlyDeleteListById } from '@/lib/list_connections';

// ─── Types ─────────────────────────────────────────────────────────────────

type ListDetail = {
  id:            string;
  name:          string;
  category:      string;
  drive_file_id: string;
  web_view_link: string | null;
  /** false = soft-disabled; shows Reactivate + Delete permanently buttons */
  enabled:       boolean;
};

type Attachment = {
  entity_type: string;
  entity_id:   string;
  label:       string;
  hint?:       string | null;
};

// ─── Screen ────────────────────────────────────────────────────────────────

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [list, setList]             = useState<ListDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [items, setItems]           = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [busyKey, setBusyKey]       = useState<string | null>(null);     // entity_id being detached
  // Two modal modes:
  //   'disable'  — soft-disable an enabled list (preserves Drive + connections)
  //   'delete'   — permanently delete an already-disabled list (Drive trash + hard delete)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode]           = useState<'disable' | 'delete'>('disable');
  const [deleting, setDeleting]               = useState(false);
  const [reactivating, setReactivating]       = useState(false);
  const [selectedItems, setSelectedItems]     = useState<Set<string>>(new Set());
  const [deletingItems, setDeletingItems]     = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      if (!supabase || !id) { setLoading(false); return; }
      const session = await getSessionWithTimeout();
      if (!session?.user) { setLoading(false); return; }

      // 1. Fetch list row.
      const { data: listRow, error: listErr } = await queryWithTimeout(
        supabase
          .from('lists')
          .select('id, name, category, drive_file_id, web_view_link, enabled')
          .eq('user_id', session.user.id)
          .eq('id', String(id))
          .maybeSingle(),
        15_000,
        'list-detail-row',
      );
      if (listErr) throw listErr;
      if (!listRow) { setError('List not found.'); setLoading(false); return; }
      const detail: ListDetail = {
        id:            String((listRow as any).id),
        name:          String((listRow as any).name ?? ''),
        category:      String((listRow as any).category ?? 'other'),
        drive_file_id: String((listRow as any).drive_file_id ?? ''),
        web_view_link: (listRow as any).web_view_link ?? null,
        enabled:       (listRow as any).enabled !== false,
      };
      setList(detail);

      // 2. Fetch connections for this list + describe each in parallel.
      const { data: conns, error: connsErr } = await queryWithTimeout(
        supabase
          .from('list_connections')
          .select('entity_type, entity_id')
          .eq('user_id', session.user.id)
          .eq('list_id', detail.id),
        15_000,
        'list-detail-connections',
      );
      if (connsErr) console.warn('[ListDetail] connections fetch failed:', connsErr.message);

      const rows = Array.isArray(conns) ? (conns as any[]) : [];
      const described = await Promise.all(rows.map(async (c) => {
        const { data, error: dErr } = await invokeWithTimeout('resolve-entity-ref', {
          body: { type: 'DESCRIBE', entity_type: c.entity_type, entity_id: c.entity_id },
        }, 10_000);
        if (dErr) {
          return {
            entity_type: c.entity_type,
            entity_id:   c.entity_id,
            label:       `(${c.entity_type})`,
            hint:        null,
          };
        }
        return {
          entity_type: c.entity_type,
          entity_id:   c.entity_id,
          label:       (data as any)?.label || `(${c.entity_type})`,
          hint:        (data as any)?.hint  || null,
        };
      }));
      setAttachments(described);

      // 3. Read list items from the Drive Doc (uses the existing helper).
      const itemsRes = await readList(detail.name);
      if (itemsRes.success && Array.isArray(itemsRes.items)) {
        setItems(itemsRes.items);
      } else {
        setItems([]);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // Detach one entity from THIS list — calls disconnectEntityById
  // (Wave 2.5 M:N: takes listId + entityType + entityId, removes the
  // single (list, entity) row). Other lists attached to the same
  // entity (if any) stay; this row is the connection between THIS
  // list and that entity.
  const onDetach = async (att: Attachment) => {
    if (!list) return;
    setBusyKey(att.entity_id);
    try {
      const result = await disconnectEntityById(list.id, att.entity_type, att.entity_id);
      if (result.success) {
        setAttachments(prev => prev.filter(a => a.entity_id !== att.entity_id));
      } else {
        setError(`Couldn't detach: ${result.error}`);
      }
    } catch (e: any) {
      setError(e?.message || 'Detach failed');
    } finally {
      setBusyKey(null);
    }
  };

  // onReactivate — re-enable a disabled list via lib/lists.ts helper.
  const onReactivate = async () => {
    if (!list) return;
    setReactivating(true);
    try {
      const result = await reactivateList(list.id);
      if (result.success) {
        // Optimistic: flip enabled in local state, no need to reload
        setList(prev => prev ? { ...prev, enabled: true } : prev);
      } else {
        setError(`Couldn't reactivate: ${result.error}`);
      }
    } catch (e: any) {
      setError(e?.message || 'Reactivate failed');
    } finally {
      setReactivating(false);
    }
  };

  const toggleItemSelection = (item: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(item)) { next.delete(item); } else { next.add(item); }
      return next;
    });
  };

  const onDeleteSelectedItems = async () => {
    if (!list || selectedItems.size === 0) return;
    setDeletingItems(true);
    try {
      const { data, error: err } = await invokeWithTimeout('manage-list', {
        body: { type: 'LIST_REMOVE', listName: list.name, items: Array.from(selectedItems) },
      }, 20_000);
      if (err) { setError(`Couldn't remove items: ${err.message}`); return; }
      if (!(data as any)?.success) { setError('Failed to remove items'); return; }
      setItems(prev => prev.filter(it => !selectedItems.has(it)));
      setSelectedItems(new Set());
    } catch (e: any) {
      setError(e?.message || 'Failed to remove items');
    } finally {
      setDeletingItems(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!list) return;
    setDeleting(true);
    try {
      if (deleteMode === 'disable') {
        // Soft-disable an ENABLED list — preserves Drive Doc and connections.
        const result = await disableList(list.id);
        if (result.success) {
          setShowDeleteModal(false);
          router.back();
        } else {
          setError(`Couldn't disable: ${result.error}`);
          setShowDeleteModal(false);
        }
      } else {
        // Permanent delete on an already-DISABLED list — trashes Drive + hard deletes.
        const result = await permanentlyDeleteListById(list.id);
        if (result.success) {
          setShowDeleteModal(false);
          router.back();
        } else {
          setError(`Couldn't delete: ${result.error}`);
          setShowDeleteModal(false);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Operation failed');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !list) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Header */}
        {list && (
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listName}>{list.name}</Text>
              {list.category && list.category !== 'other' && (
                <Text style={styles.listCategory}>{list.category}</Text>
              )}
            </View>
            {list.web_view_link && (
              <TouchableOpacity
                onPress={() => Linking.openURL(list.web_view_link!).catch(() => {})}
                style={styles.iconBtn}
                accessibilityLabel="Open in Google Drive"
              >
                <Ionicons name="open-outline" size={20} color={Colors.accent} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Attached to: section */}
        <Text style={styles.sectionHeader}>Attached to</Text>
        {attachments.length === 0 ? (
          <Text style={styles.emptySection}>Not attached to anything. Standalone list.</Text>
        ) : (
          attachments.map(att => (
            <View key={`${att.entity_type}:${att.entity_id}`} style={styles.attachRow}>
              <Ionicons
                name={iconForEntityType(att.entity_type)}
                size={20}
                color={Colors.accent}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.attachLabel} numberOfLines={1}>{att.label}</Text>
                <Text style={styles.attachKind} numberOfLines={1}>
                  {humanEntityType(att.entity_type)}
                  {att.hint ? ` · ${att.hint}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onDetach(att)}
                disabled={busyKey === att.entity_id}
                style={styles.detachBtn}
                accessibilityLabel={`Detach from ${att.label}`}
              >
                {busyKey === att.entity_id
                  ? <ActivityIndicator size="small" color={Colors.textMuted} />
                  : <Ionicons name="close" size={20} color={Colors.error} />}
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Items section */}
        <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Items</Text>
        {items.length === 0 ? (
          <Text style={styles.emptySection}>No items yet. Try: "Add milk to {list?.name ?? 'this list'}"</Text>
        ) : (
          <View style={styles.itemsBox}>
            {items.map((it, i) => {
              const selected = selectedItems.has(it);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.itemRow, selected && styles.itemRowSelected]}
                  onPress={() => toggleItemSelection(it)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.itemLine}>• {it}</Text>
                  {selected && <Ionicons name="checkmark-circle" size={18} color={Colors.alert} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {selectedItems.size > 0 && (
          <TouchableOpacity
            style={styles.deleteItemsBtn}
            onPress={onDeleteSelectedItems}
            disabled={deletingItems}
          >
            {deletingItems
              ? <ActivityIndicator size="small" color="#fff" />
              : (<>
                  <Ionicons name="trash" size={16} color="#fff" />
                  <Text style={styles.deleteBtnText}>Delete {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''}</Text>
                </>)}
          </TouchableOpacity>
        )}

        {/* Action buttons — layout mirrors the alerts.tsx disabled/active pattern */}
        {list && (
          <View style={styles.actionBtnRow}>
            {!list.enabled && (
              // Disabled list: Reactivate (accent) + Delete permanently (red)
              <TouchableOpacity
                style={[styles.actionBtn, styles.reactivateBtn]}
                onPress={onReactivate}
                disabled={reactivating}
              >
                {reactivating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : (<>
                      <Ionicons name="refresh" size={16} color="#fff" />
                      <Text style={styles.reactivateBtnText}>Reactivate</Text>
                    </>)}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={() => {
                setDeleteMode(list.enabled ? 'disable' : 'delete');
                setShowDeleteModal(true);
              }}
            >
              <Ionicons name="trash" size={16} color="#fff" />
              <Text style={styles.deleteBtnText}>
                {list.enabled ? 'Delete list' : 'Delete permanently'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Modal — two modes: soft-disable (enabled list) vs permanent delete (disabled list) */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setShowDeleteModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !deleting && setShowDeleteModal(false)}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            {deleteMode === 'disable' ? (
              // Soft-disable: Drive Doc + connections preserved; reversible.
              <>
                <Text style={styles.modalTitle}>Disable "{list?.name}"?</Text>
                {attachments.length > 0 ? (
                  <>
                    <Text style={styles.modalBody}>
                      This list is attached to {attachments.length}{' '}
                      {attachments.length === 1 ? 'item' : 'items'}:
                    </Text>
                    {attachments.map(a => (
                      <Text key={`${a.entity_type}:${a.entity_id}`} style={styles.modalBullet}>
                        • {a.label} ({humanEntityType(a.entity_type)})
                      </Text>
                    ))}
                    <Text style={styles.modalSub}>
                      The list will be hidden but your attachments and items are preserved.
                      You can reactivate it from the Lists screen.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.modalSub}>
                    The list will be hidden. You can reactivate it from the Lists screen.
                  </Text>
                )}
              </>
            ) : (
              // Permanent delete: Drive Doc trashed; not recoverable from app.
              <>
                <Text style={styles.modalTitle}>Permanently delete "{list?.name}"?</Text>
                <Text style={styles.modalSub}>
                  This will permanently delete the list and its Drive document.
                  This can't be undone.
                </Text>
              </>
            )}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={onConfirmDelete}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalBtnDangerText}>
                      {deleteMode === 'disable' ? 'Disable' : 'Delete'}
                    </Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function iconForEntityType(t: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (t) {
    case 'action_rule':        return 'notifications';
    case 'calendar_event':     return 'calendar';
    case 'gmail_message':      return 'mail';
    case 'contact':            return 'person';
    case 'reminder':           return 'alarm';
    case 'document':           return 'document';
    case 'sent_message':       return 'send';
    case 'knowledge_fragment': return 'bookmark';
    case 'list':               return 'list';
    default:                   return 'link';
  }
}

function humanEntityType(t: string): string {
  switch (t) {
    case 'action_rule':        return 'Alert';
    case 'calendar_event':     return 'Calendar event';
    case 'gmail_message':      return 'Email';
    case 'contact':            return 'Contact';
    case 'reminder':           return 'Reminder';
    case 'document':           return 'Document';
    case 'sent_message':       return 'Sent message';
    case 'knowledge_fragment': return 'Memory';
    case 'list':               return 'List';
    default:                   return t;
  }
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.bgApp },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    backgroundColor: Colors.alert,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: { color: '#fff', fontSize: 14 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  listName:     { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  listCategory: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  iconBtn:      { padding: 8 },

  sectionHeader: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySection: { color: Colors.textMuted, fontSize: 14, fontStyle: 'italic' },

  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  attachLabel: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  attachKind:  { color: Colors.textMuted,   fontSize: 12, marginTop: 2 },
  detachBtn:   { padding: 6 },

  itemsBox: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  itemRowSelected: {
    backgroundColor: 'rgba(220,50,50,0.12)',
  },
  itemLine: { color: Colors.textPrimary, fontSize: 15, lineHeight: 22, flex: 1 },
  deleteItemsBtn: {
    marginTop: 12,
    backgroundColor: Colors.alert,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },

  // Action button row — mirrors alerts.tsx F2e actionBtnRow pattern
  actionBtnRow: {
    marginTop: 24,
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 8,
  },
  reactivateBtn:     { backgroundColor: Colors.accent },
  reactivateBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deleteBtn:         { backgroundColor: Colors.alert },
  deleteBtnText:     { color: '#fff', fontSize: 15, fontWeight: '600' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 22,
    maxWidth: 380,
    width: '100%',
  },
  modalTitle:  { color: Colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  modalBody:   { color: Colors.textPrimary, fontSize: 15, marginBottom: 6 },
  modalBullet: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginLeft: 8 },
  modalSub:    { color: Colors.textMuted, fontSize: 13, marginTop: 8, marginBottom: 16 },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn:    {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary:     { backgroundColor: Colors.bgElevated },
  modalBtnSecondaryText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  modalBtnDanger:        { backgroundColor: Colors.alert },
  modalBtnDangerText:    { color: '#fff', fontSize: 15, fontWeight: '600' },
});
