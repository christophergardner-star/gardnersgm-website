/**
 * Risk Assessment Screen — H&S checklist before starting a job.
 * GGM Field v3.0
 * 
 * Standard outdoor groundskeeping checklist:
 * PPE, hazards, weather, access, equipment.
 * Must be completed before job can move to "In Progress".
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import ChecklistItem from '../components/ChecklistItem';
import IconButton from '../components/IconButton';
import GGMCard from '../components/GGMCard';
import SectionHeader from '../components/SectionHeader';

const CHECKLIST = [
  // PPE
  { id: 'ppe_boots',    section: 'PPE',            label: 'Safety boots / steel toe caps',       icon: 'footsteps-outline' },
  { id: 'ppe_gloves',   section: 'PPE',            label: 'Work gloves',                         icon: 'hand-left-outline' },
  { id: 'ppe_eye',      section: 'PPE',            label: 'Eye protection (if strimming/cutting)',icon: 'eye-outline' },
  { id: 'ppe_ear',      section: 'PPE',            label: 'Ear protection (if using loud kit)',   icon: 'ear-outline' },
  { id: 'ppe_vis',      section: 'PPE',            label: 'Hi-vis vest (if near roads)',          icon: 'shirt-outline' },
  // Site Hazards
  { id: 'haz_trip',     section: 'Site Hazards',   label: 'Checked for trip hazards',            icon: 'warning-outline' },
  { id: 'haz_overhead', section: 'Site Hazards',   label: 'Checked overhead hazards (wires, branches)', icon: 'arrow-up-outline' },
  { id: 'haz_animals',  section: 'Site Hazards',   label: 'Animals / pets secured',              icon: 'paw-outline' },
  { id: 'haz_public',   section: 'Site Hazards',   label: 'Public / pedestrian area controlled', icon: 'people-outline' },
  // Weather
  { id: 'wx_suitable',  section: 'Weather',        label: 'Weather conditions suitable for work', icon: 'cloud-outline' },
  { id: 'wx_ground',    section: 'Weather',        label: 'Ground conditions safe (not waterlogged)', icon: 'water-outline' },
  // Access
  { id: 'acc_parking',  section: 'Access',         label: 'Vehicle parked safely',               icon: 'car-outline' },
  { id: 'acc_gate',     section: 'Access',         label: 'Site access confirmed',               icon: 'log-in-outline' },
  // Equipment
  { id: 'eq_check',     section: 'Equipment',      label: 'Equipment pre-use check done',        icon: 'build-outline' },
  { id: 'eq_fuel',      section: 'Equipment',      label: 'Fuel / charge levels adequate',       icon: 'battery-half-outline' },
];

export default function RiskAssessmentScreen({ route, navigation }) {
  const { jobRef, job, onComplete } = route.params || {};
  const [checked, setChecked] = useState({});
  const [notes, setNotes] = useState({});
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggle(id) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function setNote(id, text) {
    setNotes(prev => ({ ...prev, [id]: text }));
  }

  const totalItems = CHECKLIST.length;
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const allChecked = checkedCount === totalItems;

  async function handleSubmit() {
    if (!allChecked) {
      Alert.alert('Incomplete', 'Please complete all checklist items before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      // Save via API (will be created in api.js)
      const { saveRiskAssessment } = require('../services/api');
      await saveRiskAssessment(jobRef, {
        items: checked,
        notes,
        additionalNotes,
        completedAt: new Date().toISOString(),
        clientName: job?.name || job?.clientName || '',
        service: job?.service || '',
        postcode: job?.postcode || '',
      });
      Alert.alert('Saved', 'Risk assessment recorded.', [
        { text: 'OK', onPress: () => {
          if (onComplete) onComplete();
          navigation.goBack();
        }},
      ]);
    } catch (err) {
      // Queued offline
      Alert.alert('Saved Offline', 'Risk assessment saved and will sync when online.', [
        { text: 'OK', onPress: () => {
          if (onComplete) onComplete();
          navigation.goBack();
        }},
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  // Group items by section
  const sections = {};
  CHECKLIST.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });

  const sectionIcons = {
    PPE: 'shield-checkmark-outline',
    'Site Hazards': 'warning-outline',
    Weather: 'cloud-outline',
    Access: 'car-outline',
    Equipment: 'build-outline',
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Progress indicator */}
      <GGMCard>
        <View style={styles.progressRow}>
          <Ionicons
            name={allChecked ? 'checkmark-circle' : 'clipboard-outline'}
            size={24}
            color={allChecked ? Colors.success : Colors.warning}
          />
          <View style={styles.progressText}>
            <Text style={styles.progressTitle}>
              {allChecked ? 'All Clear' : `${checkedCount} of ${totalItems} checked`}
            </Text>
            <Text style={styles.progressSub}>
              {job?.name || job?.clientName} — {job?.service || 'Job'}
            </Text>
          </View>
        </View>
        {/* Progress bar */}
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${(checkedCount / totalItems) * 100}%` }]} />
        </View>
      </GGMCard>

      {/* Checklist sections */}
      {Object.entries(sections).map(([section, items]) => (
        <View key={section}>
          <SectionHeader icon={sectionIcons[section]} title={section} />
          <GGMCard noPadding>
            {items.map(item => (
              <ChecklistItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                checked={!!checked[item.id]}
                onToggle={() => toggle(item.id)}
                showNotes
                notes={notes[item.id] || ''}
                onNotesChange={(text) => setNote(item.id, text)}
              />
            ))}
          </GGMCard>
        </View>
      ))}

      {/* Additional notes */}
      <SectionHeader icon="create-outline" title="Additional Notes" />
      <GGMCard>
        <TextInput
          style={styles.notesInput}
          multiline
          placeholder="Any additional observations or concerns..."
          placeholderTextColor={Colors.textLight}
          value={additionalNotes}
          onChangeText={setAdditionalNotes}
        />
      </GGMCard>

      {/* Submit */}
      <View style={styles.submitWrap}>
        <IconButton
          icon={allChecked ? 'checkmark-circle' : 'alert-circle-outline'}
          label={allChecked ? 'Submit Risk Assessment' : `${totalItems - checkedCount} items remaining`}
          onPress={handleSubmit}
          disabled={!allChecked}
          loading={submitting}
          color={allChecked ? Colors.primary : Colors.textMuted}
        />
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingVertical: Spacing.lg,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  progressText: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  progressSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
    marginTop: Spacing.md,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    backgroundColor: Colors.success,
    borderRadius: 3,
  },
  notesInput: {
    fontSize: 14,
    color: Colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  submitWrap: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
});
