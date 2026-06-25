import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GeofencePermKey, GeofencePermItem, PERM_META } from '@/hooks/useGeofencePermissions';

interface Props {
  missing: GeofencePermKey[];
  onFix: (key: GeofencePermKey) => Promise<void>;
  onDismiss: () => void;
}

export function GeofencePermissionCard({ missing, onFix, onDismiss }: Props) {
  if (missing.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Location alerts need a little setup</Text>

      {missing.map((key) => {
        const item: GeofencePermItem = PERM_META[key];
        return (
          <View key={key} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </View>
            <TouchableOpacity
              style={styles.fixBtn}
              onPress={() => onFix(key)}
              activeOpacity={0.75}
            >
              <Text style={styles.fixBtnText}>Fix</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <Text style={styles.warning}>
        Without these, location alerts won't work.
      </Text>

      <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.75}>
        <Text style={styles.dismissText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  title: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  detail: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
  },
  fixBtn: {
    backgroundColor: '#22C55E',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fixBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
  },
  warning: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  dismissBtn: {
    alignSelf: 'flex-end',
  },
  dismissText: {
    color: '#6B7280',
    fontSize: 13,
  },
});
