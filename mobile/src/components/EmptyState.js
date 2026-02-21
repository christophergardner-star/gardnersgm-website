/**
 * Empty State — Consistent "no data" placeholder.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../theme';

export default function EmptyState({ icon, title, subtitle, style }) {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name={icon || 'file-tray-outline'} size={48} color={Colors.textLight} />
      <Text style={styles.title}>{title || 'Nothing here yet'}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl * 2,
    paddingHorizontal: Spacing.xxl,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textLight,
    marginTop: Spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
