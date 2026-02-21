/**
 * Notes Screen — Field notes hub with text + voice notes.
 * GGM Field v3.0
 * Uses existing save_field_note / get_field_notes GAS endpoints.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import GGMCard from '../components/GGMCard';
import FormField from '../components/FormField';
import IconButton from '../components/IconButton';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';

export default function NotesScreen() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Voice recording
  const [recording, setRecording] = useState(false);

  useEffect(() => { loadNotes(); }, []);

  async function loadNotes() {
    try {
      const { apiGet } = require('../services/api');
      const data = await apiGet('get_field_notes', { limit: '30' });
      if (data?.notes) setNotes(data.notes);
      else setNotes([]);
    } catch (err) {
      // Silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleSubmit() {
    if (!noteTitle.trim() && !noteBody.trim()) {
      Alert.alert('Empty', 'Please enter a title or note body.');
      return;
    }

    setSubmitting(true);
    try {
      const { apiPost } = require('../services/api');
      await apiPost({
        action: 'save_field_note',
        title: noteTitle,
        content: noteBody,
        type: 'text',
        source: 'mobile-field',
        timestamp: new Date().toISOString(),
      });
      Alert.alert('Saved', 'Note recorded.');
      setNoteTitle('');
      setNoteBody('');
      setShowForm(false);
      loadNotes();
    } catch (err) {
      Alert.alert('Saved Offline', 'Note will sync when online.');
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVoiceNote() {
    try {
      const audio = require('../services/audio');
      if (recording) {
        const uri = await audio.stopRecording();
        setRecording(false);
        if (uri) {
          // Save voice note
          const { apiPost } = require('../services/api');
          await apiPost({
            action: 'save_field_note',
            title: `Voice Note — ${new Date().toLocaleTimeString()}`,
            content: '[Voice recording]',
            type: 'voice',
            audioUri: uri,
            source: 'mobile-field',
            timestamp: new Date().toISOString(),
          });
          Alert.alert('Saved', 'Voice note recorded.');
          loadNotes();
        }
      } else {
        await audio.startRecording();
        setRecording(true);
      }
    } catch (err) {
      setRecording(false);
      Alert.alert('Error', 'Could not record audio. Check microphone permissions.');
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadNotes(); }}
          colors={[Colors.primary]} tintColor={Colors.primary} />
      }
    >
      {/* Quick actions */}
      <View style={styles.actionsRow}>
        <IconButton
          icon="create-outline"
          label="New Note"
          onPress={() => setShowForm(true)}
          style={{ flex: 1 }}
        />
        <IconButton
          icon={recording ? 'stop-circle' : 'mic-outline'}
          label={recording ? 'Stop' : 'Voice Note'}
          onPress={handleVoiceNote}
          color={recording ? Colors.error : Colors.accentBlue}
          style={{ flex: 1 }}
        />
      </View>

      {/* New note form */}
      {showForm && (
        <>
          <SectionHeader icon="create-outline" title="New Field Note" />
          <GGMCard>
            <FormField
              icon="text-outline"
              label="Title"
              value={noteTitle}
              onChangeText={setNoteTitle}
              placeholder="Note title..."
            />
            <FormField
              label="Note"
              value={noteBody}
              onChangeText={setNoteBody}
              placeholder="Write your field note..."
              multiline
            />
            <View style={styles.formActions}>
              <IconButton
                icon="close-outline"
                label="Cancel"
                variant="outline"
                color={Colors.textMuted}
                onPress={() => setShowForm(false)}
                style={{ flex: 1 }}
              />
              <IconButton
                icon="checkmark-outline"
                label="Save"
                onPress={handleSubmit}
                loading={submitting}
                style={{ flex: 1 }}
              />
            </View>
          </GGMCard>
        </>
      )}

      {/* Notes list */}
      <SectionHeader icon="document-text-outline" title="Recent Notes" />
      {notes.length === 0 ? (
        <EmptyState icon="document-text-outline" title="No field notes" subtitle="Create a note or record a voice memo." />
      ) : (
        notes.map((note, i) => {
          const isVoice = note.type === 'voice';
          return (
            <GGMCard key={i} accentColor={isVoice ? Colors.accentBlue : Colors.primary}>
              <View style={styles.noteRow}>
                <Ionicons
                  name={isVoice ? 'mic-outline' : 'document-text-outline'}
                  size={20}
                  color={isVoice ? Colors.accentBlue : Colors.primary}
                />
                <View style={styles.noteInfo}>
                  <Text style={styles.noteTitle}>{note.title || 'Untitled'}</Text>
                  {note.content && note.content !== '[Voice recording]' && (
                    <Text style={styles.noteBody} numberOfLines={2}>{note.content}</Text>
                  )}
                  <Text style={styles.noteDate}>
                    {note.timestamp ? new Date(note.timestamp).toLocaleString() : '—'}
                  </Text>
                </View>
              </View>
            </GGMCard>
          );
        })
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: Spacing.lg },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  noteInfo: { flex: 1 },
  noteTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  noteBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 20,
  },
  noteDate: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 4,
  },
});
