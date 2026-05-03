/**
 * Alerts screen — list and delete Robert's active action_rules.
 *
 * Grouped by trigger_type, sorted newest-first within each group. Rows are
 * collapsed by default (short one-line summary); tap to expand the full
 * trigger + action detail. Delete button per row opens a confirmation modal
 * before calling the manage-rules Edge Function.
 *
 * Voice commands (LIST_RULES / DELETE_RULE) hit the same Edge Function from
 * the orchestrator and voice server — this UI is for users who prefer tapping
 * over talking.
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
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
import { remoteLog } from '@/lib/remoteLog';
import { getLifecycleSession } from '@/lib/appLifecycle';

// V57.10.2 — Wael 2026-05-01 saw "[object Object]" in the orange error
// banner. Root cause: Supabase / Edge Function error responses are plain
// objects with a `message` property — they are NOT instances of Error.
// String(e) on a plain object yields "[object Object]". Pull the message
// out explicitly when present so the banner shows the real reason.
function formatErrorForUser(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const msg = (e as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
    try {
      return JSON.stringify(e);
    } catch {
      return 'Unknown error';
    }
  }
  return String(e);
}

// ─── Types ──────────────────────────────────────────────────────────────────

type TriggerType = 'location' | 'weather' | 'email' | 'contact_silence' | 'time' | 'calendar';

type ActionRule = {
  id:             string;
  trigger_type:   TriggerType | string;
  trigger_config: Record<string, unknown>;
  action_type:    string;
  action_config:  Record<string, unknown>;
  label:          string | null;
  one_shot:       boolean | null;
  enabled:        boolean | null;
  created_at:     string | null;
};

// ─── Formatters — translate raw trigger/action config into plain language ───

function iconFor(type: string) {
  switch (type) {
    case 'location':        return 'location';
    case 'weather':         return 'rainy';
    case 'email':           return 'mail';
    case 'contact_silence': return 'time';
    case 'time':            return 'alarm';
    case 'calendar':        return 'calendar';
    default:                return 'notifications';
  }
}

function groupLabel(type: string) {
  switch (type) {
    case 'location':        return 'Location';
    case 'weather':         return 'Weather';
    case 'email':           return 'Email';
    case 'contact_silence': return 'Contact silence';
    case 'time':            return 'Time';
    case 'calendar':        return 'Calendar';
    default:                return type;
  }
}

function formatTriggerSummary(r: ActionRule): string {
  const t = r.trigger_type;
  const c = r.trigger_config ?? {};
  switch (t) {
    case 'location': {
      const place = (c as any).place_name ?? 'a place';
      const dir = (c as any).direction ?? 'arrive';
      return `${dir === 'leave' ? 'Leave' : dir === 'inside' ? 'Inside' : 'Arrive at'} ${place}`;
    }
    case 'weather': {
      const cond = (c as any).condition ?? 'weather';
      const threshold = (c as any).threshold;
      const when = (c as any).when ?? 'today';
      const thresholdText = cond === 'rain' || cond === 'snow'
        ? (threshold ? ` (${threshold}%+)` : '')
        : (threshold ? ` ≥ ${threshold}°C` : '');
      const whenText = when === 'today' ? 'today' : when === 'tomorrow' ? 'tomorrow' : String(when);
      const prettyCond = cond === 'temp_max_above' ? 'high temp' : cond === 'temp_min_below' ? 'low temp' : cond;
      return `${prettyCond}${thresholdText} ${whenText}`;
    }
    case 'email': {
      const from = (c as any).from_name ?? (c as any).from_email ?? 'anyone';
      const kw = (c as any).subject_keyword;
      return kw ? `Email from ${from} about "${kw}"` : `Email from ${from}`;
    }
    case 'contact_silence': {
      const from = (c as any).from_name ?? (c as any).from_email ?? 'anyone';
      const days = (c as any).days_silent ?? 30;
      return `${from} silent ${days} days`;
    }
    case 'time': {
      const when = (c as any).datetime;
      if (!when) return 'Scheduled alert';
      try {
        const d = new Date(String(when));
        return `At ${d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      } catch {
        return 'Scheduled alert';
      }
    }
    case 'calendar': {
      const match = (c as any).event_match ?? 'an event';
      const timing = (c as any).timing ?? 'before';
      const minutes = (c as any).minutes ?? 30;
      return `${minutes} min ${timing} "${match}"`;
    }
    default:
      return r.label ?? String(t);
  }
}

function formatActionSummary(r: ActionRule): string {
  const a  = r.action_config ?? {};
  const to = (a as any).to_name ?? (a as any).to ?? (a as any).to_phone ?? 'you';
  const isSelf = !!(a as any).to_phone && !((a as any).to);
  const who    = isSelf ? 'you' : String(to);
  const extras: string[] = [];
  if ((a as any).list_name) extras.push(`${(a as any).list_name} list`);
  if (Array.isArray((a as any).tasks) && (a as any).tasks.length > 0) {
    extras.push(`${(a as any).tasks.length} task${(a as any).tasks.length === 1 ? '' : 's'}`);
  }
  const extrasText = extras.length ? ` with ${extras.join(' + ')}` : '';
  return `→ Alert ${who}${extrasText}`;
}

// Plain-language "WHEN" explainer per trigger type. Hides internal fields
// (lat/lng, fire_at_hour, IANA timezones) that mean nothing to Robert.
function formatWhenDetail(r: ActionRule): string {
  const c = (r.trigger_config ?? {}) as any;
  switch (r.trigger_type) {
    case 'location': {
      const place = c.place_name ?? 'a place';
      const dir = c.direction ?? 'arrive';
      const dwell = c.dwell_minutes ?? 2;
      if (dir === 'leave')  return `You leave ${place}.`;
      if (dir === 'inside') return `You're at ${place} for at least ${dwell} minutes.`;
      return `You arrive at ${place}${dwell ? ` (after staying ${dwell} minute${dwell === 1 ? '' : 's'})` : ''}.`;
    }
    case 'weather': {
      const cond = c.condition ?? 'weather';
      const threshold = c.threshold;
      const when = c.when ?? 'today';
      const whenText = when === 'today' ? 'today' : when === 'tomorrow' ? 'tomorrow' : String(when);
      const condText = cond === 'temp_max_above' ? `high temperature reaches ${threshold}°C or more`
                     : cond === 'temp_min_below' ? `low temperature drops below ${threshold}°C`
                     : cond === 'rain' ? `rain is forecast (${threshold ?? 50}% chance or higher)`
                     : cond === 'snow' ? `snow is forecast (${threshold ?? 50}% chance or higher)`
                     : cond;
      return `The ${condText} ${whenText}.`;
    }
    case 'email': {
      const from = c.from_name ?? c.from_email ?? 'anyone';
      const kw = c.subject_keyword;
      return kw ? `A new email from ${from} about "${kw}" arrives.` : `A new email from ${from} arrives.`;
    }
    case 'contact_silence': {
      const from = c.from_name ?? c.from_email ?? 'someone';
      const days = c.days_silent ?? 30;
      return `${from} hasn't emailed you in ${days} days.`;
    }
    case 'time': {
      if (!c.datetime) return 'At a scheduled time.';
      try {
        const d = new Date(String(c.datetime));
        return `On ${d.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
      } catch { return 'At a scheduled time.'; }
    }
    case 'calendar': {
      const match = c.event_match ?? 'an event';
      const timing = c.timing ?? 'before';
      const minutes = c.minutes ?? 30;
      return `${minutes} minute${minutes === 1 ? '' : 's'} ${timing} your "${match}" event.`;
    }
    default:
      return r.label ?? 'A condition is met.';
  }
}

// Plain-language "WHAT HAPPENS" explainer. Describes the delivery channels,
// the spoken body, and any list/task extras — never exposes to_phone digits
// or internal config keys.
function formatWhatHappens(r: ActionRule): { channelsLine: string; bodyLine: string | null; extraLines: string[] } {
  const a = (r.action_config ?? {}) as any;
  const isSelf = !!a.to_phone && !a.to;
  const body = String(a.body ?? '').trim();

  let channelsLine: string;
  if (isSelf) {
    // Self-alert fan-out (per CLAUDE.md ALERT FAN-OUT section).
    const chans = ['text', 'WhatsApp', 'email', 'push'];
    if (r.trigger_type === 'location' && (a.direction ?? r.trigger_config?.direction) === 'arrive') {
      chans.push('voice call');
    }
    channelsLine = `Naavi sends you ${chans.join(', ')}${chans.length > 1 ? '' : ''} — all channels that are set up.`;
  } else {
    const to = a.to_name ?? a.to ?? 'a contact';
    channelsLine = `Naavi sends ${to} a ${r.action_type === 'email' ? 'message by email' : r.action_type === 'whatsapp' ? 'WhatsApp' : 'text message'}.`;
  }

  const bodyLine = body ? `"${body}"` : null;

  const extras: string[] = [];
  if (a.list_name) extras.push(`Plus items from your "${a.list_name}" list.`);
  if (Array.isArray(a.tasks) && a.tasks.length > 0) {
    const taskList = a.tasks.length === 1
      ? `Plus a reminder: "${a.tasks[0]}".`
      : `Plus ${a.tasks.length} reminders: ${a.tasks.map((t: string) => `"${t}"`).join(', ')}.`;
    extras.push(taskList);
  }

  return { channelsLine, bodyLine, extraLines: extras };
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function AlertsScreen() {
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const [rules, setRules]           = useState<ActionRule[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<ActionRule | null>(null);
  const [deleting, setDeleting]     = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const load = useCallback(async () => {
    // V57.10.5 — UI freeze instrumentation. Wael 2026-05-03 saw the app
    // freeze after Alerts → Notes → Alerts → Home navigation. We log every
    // step of the alerts load + the timing so we can pinpoint which call
    // hung if the freeze happens again.
    const t0 = Date.now();
    remoteLog(getLifecycleSession(), 'alerts-load-start');
    try {
      setError(null);
      if (!supabase) {
        remoteLog(getLifecycleSession(), 'alerts-load-end', { reason: 'no-supabase', ms: Date.now() - t0 });
        setLoading(false);
        return;
      }
      remoteLog(getLifecycleSession(), 'alerts-load-getSession-start');
      const session = await getSessionWithTimeout();
      remoteLog(getLifecycleSession(), 'alerts-load-getSession-end', { has_user: !!session?.user, ms: Date.now() - t0 });
      if (!session?.user) {
        remoteLog(getLifecycleSession(), 'alerts-load-end', { reason: 'no-session', ms: Date.now() - t0 });
        setLoading(false);
        return;
      }
      remoteLog(getLifecycleSession(), 'alerts-load-invoke-start');
      const { data, error: err } = await invokeWithTimeout('manage-rules', {
        body: { op: 'list' },
      }, 15_000);
      remoteLog(getLifecycleSession(), 'alerts-load-invoke-end', {
        had_error: !!err,
        rules_count: Array.isArray((data as any)?.rules) ? (data as any).rules.length : 0,
        ms: Date.now() - t0,
      });
      if (err) throw err;
      setRules(Array.isArray((data as any)?.rules) ? (data as any).rules : []);
      remoteLog(getLifecycleSession(), 'alerts-load-end', { reason: 'ok', ms: Date.now() - t0 });
    } catch (e: unknown) {
      const errMsg = formatErrorForUser(e);
      remoteLog(getLifecycleSession(), 'alerts-load-end', { reason: 'error', error: errMsg.slice(0, 200), ms: Date.now() - t0 });
      setError(errMsg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    remoteLog(getLifecycleSession(), 'alerts-screen-mount');
    load();
    return () => remoteLog(getLifecycleSession(), 'alerts-screen-unmount');
  }, [load]);

  // When navigating in with a highlight param (e.g. from the orchestrator
  // after "show me my Costco alert"), auto-expand the first rule whose
  // trigger or action config contains every word of the match string.
  useEffect(() => {
    if (!highlight || rules.length === 0) return;
    const needles = String(highlight).toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = (r: ActionRule) => {
      const parts: string[] = [String(r.trigger_type ?? ''), String(r.label ?? '')];
      for (const v of Object.values(r.trigger_config ?? {})) if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
      for (const v of Object.values(r.action_config  ?? {})) if (v != null) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
      return parts.join(' ').toLowerCase();
    };
    const target = rules.find(r => {
      const hay = haystack(r);
      return needles.every(n => hay.includes(n));
    });
    if (target) setExpanded(prev => ({ ...prev, [target.id]: true }));
  }, [highlight, rules]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (!supabase) throw new Error('No Supabase client');
      const { error: err } = await invokeWithTimeout('manage-rules', {
        body: { op: 'delete', rule_id: pendingDelete.id },
      }, 15_000);
      if (err) throw err;
      setRules(prev => prev.filter(r => r.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e: unknown) {
      setError(formatErrorForUser(e));
    } finally {
      setDeleting(false);
    }
  };

  // Group by trigger_type. The Edge Function already returns rules sorted
  // trigger_type-ascending then created_at-descending, so we preserve order.
  const groups: Array<{ type: string; rules: ActionRule[] }> = [];
  const seenTypes: Record<string, number> = {};
  for (const r of rules) {
    const t = String(r.trigger_type);
    if (seenTypes[t] == null) {
      seenTypes[t] = groups.length;
      groups.push({ type: t, rules: [] });
    }
    groups[seenTypes[t]].rules.push(r);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {loading && rules.length === 0 && (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && rules.length === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="notifications-off" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No alerts set up yet.</Text>
            <Text style={styles.emptyTip}>Try: "Alert me when it rains tomorrow"</Text>
          </View>
        )}

        {groups.map(({ type, rules: groupRules }) => (
          <View key={type} style={styles.group}>
            <Text style={styles.groupTitle}>{groupLabel(type)}</Text>
            {groupRules.map(rule => {
              const isOpen = !!expanded[rule.id];
              return (
                <View key={rule.id} style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowHeader}
                    onPress={() => setExpanded(prev => ({ ...prev, [rule.id]: !prev[rule.id] }))}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={iconFor(type) as React.ComponentProps<typeof Ionicons>['name']}
                      size={22}
                      color={Colors.accent}
                      style={{ marginRight: 12 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{formatTriggerSummary(rule)}</Text>
                      <Text style={styles.rowSub}   numberOfLines={1}>{formatActionSummary(rule)}</Text>
                    </View>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={Colors.textMuted}
                    />
                  </TouchableOpacity>

                  {isOpen && (() => {
                    const { channelsLine, bodyLine, extraLines } = formatWhatHappens(rule);
                    return (
                      <View style={styles.detailBox}>
                        <Text style={styles.detailHeader}>When</Text>
                        <Text style={styles.detailProse}>{formatWhenDetail(rule)}</Text>
                        <Text style={[styles.detailHeader, { marginTop: 14 }]}>What happens</Text>
                        <Text style={styles.detailProse}>{channelsLine}</Text>
                        {bodyLine && <Text style={styles.detailProseQuote}>{bodyLine}</Text>}
                        {extraLines.map((line, i) => (
                          <Text key={i} style={styles.detailProse}>{line}</Text>
                        ))}
                        <Text style={styles.detailMeta}>
                          {rule.one_shot ? 'Fires once, then stops.' : 'Repeats until you delete it.'}
                        </Text>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => setPendingDelete(rule)}
                        >
                          <Ionicons name="trash" size={16} color="#fff" />
                          <Text style={styles.deleteBtnText}>Delete alert</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Delete confirmation modal */}
      <Modal
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !deleting && setPendingDelete(null)}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Delete alert?</Text>
            <Text style={styles.modalBody}>
              {pendingDelete ? formatTriggerSummary(pendingDelete) : ''}
            </Text>
            <Text style={styles.modalSub}>This can't be undone.</Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setPendingDelete(null)}
                disabled={deleting}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={confirmDelete}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalBtnDangerText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bgApp,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  center: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  errorBox: {
    backgroundColor: Colors.alert,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
  },
  emptyWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 17,
    fontWeight: '500',
    marginTop: 12,
  },
  emptyTip: {
    color: Colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
  group: {
    marginBottom: 18,
  },
  groupTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  row: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: Colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  detailBox: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },
  detailHeader: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailLine: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  // Plain-language prose detail — replaces the raw JSON dump with sentences
  // Robert can read at a glance. No monospace, no field names, no coords.
  detailProse: {
    color: Colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  detailProseQuote: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontStyle: 'italic',
    lineHeight: 22,
    marginBottom: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: Colors.accent,
  },
  detailMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
  },
  deleteBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.alert,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
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
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalBody: {
    color: Colors.textPrimary,
    fontSize: 15,
    marginBottom: 6,
  },
  modalSub: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: {
    backgroundColor: Colors.bgElevated,
  },
  modalBtnSecondaryText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  modalBtnDanger: {
    backgroundColor: Colors.alert,
  },
  modalBtnDangerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
