/**
 * More Screen — Grid menu for secondary features.
 * GGM Field v3.0
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, Typography } from '../theme';

const MENU_ITEMS = [
  { key: 'Weather',  icon: 'cloud-outline',        label: 'Weather',      color: '#1565C0', desc: '7-day forecast' },
  { key: 'Expenses', icon: 'card-outline',          label: 'Expenses',     color: '#E65100', desc: 'Track costs' },
  { key: 'Notes',    icon: 'document-text-outline', label: 'Field Notes',  color: '#2E7D32', desc: 'Notes & voice' },
  { key: 'Route',    icon: 'map-outline',           label: 'Route Plan',   color: '#7B1FA2', desc: 'Optimise route' },
  { key: 'Quote',    icon: 'calculator-outline',    label: 'New Quote',    color: '#00838F', desc: 'On-site quote' },
  { key: 'Bots',     icon: 'hardware-chip-outline', label: 'Bot Activity', color: '#FF8F00', desc: 'Telegram bots' },
  { key: 'Settings', icon: 'settings-outline',      label: 'Settings',     color: '#546E7A', desc: 'App config' },
];

export default function MoreScreen({ navigation }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header strip */}
      <View style={styles.header}>
        <Ionicons name="leaf" size={20} color={Colors.primary} />
        <Text style={styles.headerTitle}>GGM Field</Text>
        <Text style={styles.headerVersion}>v3.0.0</Text>
      </View>

      {/* Menu grid */}
      <View style={styles.grid}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.tile}
            onPress={() => navigation.navigate(item.key)}
            activeOpacity={0.7}
          >
            <View style={[styles.tileIcon, { backgroundColor: item.color + '14' }]}>
              <Ionicons name={item.icon} size={26} color={item.color} />
            </View>
            <Text style={styles.tileLabel}>{item.label}</Text>
            <Text style={styles.tileDesc}>{item.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Footer */}
      <Text style={styles.footer}>Gardners Ground Maintenance — Cornwall, UK</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: Spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  headerVersion: {
    fontSize: 12,
    color: Colors.textLight,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  tile: {
    width: '47%',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    ...Shadows.card,
  },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  tileDesc: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: Colors.textLight,
    marginTop: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
  },
});
