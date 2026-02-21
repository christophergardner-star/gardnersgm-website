/**
 * GGM Card — Reusable card container with consistent styling.
 * Optional coloured left accent bar for status indication.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, BorderRadius, Spacing, Shadows } from '../theme';

export default function GGMCard({ children, style, accentColor, noPadding }) {
  return (
    <View style={[styles.card, style]}>
      {accentColor && <View style={[styles.accent, { backgroundColor: accentColor }]} />}
      <View style={[styles.content, noPadding && { padding: 0 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    overflow: 'hidden',
    ...Shadows.card,
  },
  accent: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: Spacing.lg,
  },
});
