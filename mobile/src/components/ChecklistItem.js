/**
 * Checklist Item — Toggleable row with icon, label, and optional notes.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing } from '../theme';

export default function ChecklistItem({ label, icon, checked, onToggle, showNotes, notes, onNotesChange }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={22}
          color={checked ? Colors.success : Colors.textLight}
        />
        {icon && <Ionicons name={icon} size={18} color={Colors.textMuted} style={styles.icon} />}
        <Text style={[styles.label, checked && styles.labelChecked]}>{label}</Text>
        {showNotes && (
          <TouchableOpacity onPress={() => setExpanded(!expanded)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      {showNotes && expanded && (
        <TextInput
          style={styles.notes}
          value={notes}
          onChangeText={onNotesChange}
          placeholder="Add notes..."
          placeholderTextColor={Colors.textLight}
          multiline
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  icon: {
    marginLeft: Spacing.xs,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  labelChecked: {
    color: Colors.textMuted,
  },
  notes: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.inputBg,
    borderRadius: BorderRadius.sm,
    fontSize: 13,
    color: Colors.textPrimary,
    minHeight: 40,
  },
});
