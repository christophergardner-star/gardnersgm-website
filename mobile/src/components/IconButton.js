/**
 * Icon Button — Standardised action button with Ionicons icon + label.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing, Shadows } from '../theme';

export default function IconButton({
  icon, label, onPress, color, variant = 'filled', size = 'md',
  disabled, loading, style,
}) {
  const tint = color || Colors.primary;
  const isFilled = variant === 'filled';
  const isSmall = size === 'sm';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isFilled ? { backgroundColor: tint } : { backgroundColor: tint + '10', borderWidth: 1.5, borderColor: tint },
        isSmall && styles.btnSm,
        disabled && styles.disabled,
        isFilled && Shadows.button,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color={isFilled ? '#fff' : tint} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={isSmall ? 16 : 18} color={isFilled ? '#fff' : tint} />}
          {label && (
            <Text style={[
              styles.label,
              { color: isFilled ? '#fff' : tint },
              isSmall && styles.labelSm,
              icon && { marginLeft: Spacing.sm },
            ]}>
              {label}
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md + 2,
    borderRadius: BorderRadius.md,
  },
  btnSm: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelSm: {
    fontSize: 12,
  },
  disabled: {
    opacity: 0.5,
  },
});
