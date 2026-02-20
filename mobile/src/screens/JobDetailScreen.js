/**
 * Job Detail Screen — Full linear workflow for a single job.
 * 
 * Flow: Scheduled → En Route → In Progress → Completed → Invoiced
 * 
 * Features:
 * - Get Directions to job location
 * - Take/upload photos  
 * - Job notes
 * - Complete & auto-invoice
 * 
 * Styled like email "Booking Confirmed" detail cards.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, StyleSheet, Linking, Platform, Image,
  TextInput, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, BorderRadius, Typography, Shadows } from '../theme';
import {
  updateJobStatus, startJob, completeJob,
  sendInvoice, uploadJobPhoto,
} from '../services/api';
import { captureJobLocation } from '../services/location';

const STATUS_FLOW = ['scheduled', 'en-route', 'in-progress', 'completed', 'invoiced'];

const STATUS_META = {
  scheduled:     { icon: '🗓️', label: 'Scheduled',   color: Colors.accentBlue, bg: Colors.infoBg },
  'en-route':    { icon: '🚗', label: 'En Route',    color: Colors.warning, bg: Colors.warningBg },
  'in-progress': { icon: '🔨', label: 'In Progress', color: Colors.accentOrange, bg: Colors.warningBg },
  completed:     { icon: '✅', label: 'Completed',   color: Colors.success, bg: Colors.successBg },
  invoiced:      { icon: '📧', label: 'Invoiced',    color: Colors.success, bg: Colors.successBg },
};

export default function JobDetailScreen({ route, navigation }) {
  const { job, autoAction } = route.params || {};
  const [status, setStatus] = useState(job?.status || 'scheduled');
  const [notes, setNotes] = useState(job?.notes || '');
  const [photos, setPhotos] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [startTime, setStartTime] = useState(null);

  useEffect(() => {
    navigation.setOptions({
      title: job?.name || job?.clientName || 'Job Detail',
    });
    // If autoAction passed from TodayScreen, trigger it
    if (autoAction) {
      handleAdvance(autoAction);
    }
  }, []);

  const statusMeta = STATUS_META[status] || STATUS_META.scheduled;
  const currentIdx = STATUS_FLOW.indexOf(status);

  // ── Open Maps for directions ──
  function openDirections() {
    const address = job?.address || job?.postcode || '';
    if (!address) {
      Alert.alert('No Address', 'No address available for this job.');
      return;
    }
    const encoded = encodeURIComponent(address);
    const url = Platform.select({
      android: `google.navigation:q=${encoded}`,
      ios: `maps:?daddr=${encoded}`,
    });
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
    });
  }

  // ── Advance job status ──
  async function handleAdvance(nextStatus) {
    if (!nextStatus) return;

    if (nextStatus === 'completed') {
      Alert.alert(
        'Complete Job?',
        'Mark this job as completed and optionally send an invoice.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Complete Only', onPress: () => advanceTo('completed') },
          { text: 'Complete & Invoice', onPress: () => advanceTo('completed', true) },
        ]
      );
      return;
    }

    await advanceTo(nextStatus);
  }

  async function advanceTo(nextStatus, sendInvoiceAutomatically = false) {
    setActionLoading(true);
    try {
      // Capture GPS at each workflow transition
      const locationData = await captureJobLocation(nextStatus);

      if (nextStatus === 'in-progress') {
        setStartTime(new Date());
        await startJob(job.jobNumber || job.ref, {
          startTime: new Date().toISOString(),
          notes,
          ...locationData,
        });
      } else if (nextStatus === 'completed') {
        await completeJob(job.jobNumber || job.ref, {
          endTime: new Date().toISOString(),
          startTime: startTime?.toISOString(),
          notes,
          photoCount: photos.length,
          ...locationData,
        });
        if (sendInvoiceAutomatically) {
          await handleSendInvoice();
        }
      } else {
        await updateJobStatus(job.jobNumber || job.ref, nextStatus, '', locationData);
      }
      setStatus(nextStatus);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to update job status');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Send invoice ──
  async function handleSendInvoice() {
    setActionLoading(true);
    try {
      await sendInvoice(job.jobNumber || job.ref, {
        amount: job.price || job.total,
        service: job.service || job.serviceName,
        clientName: job.name || job.clientName,
        clientEmail: job.email || job.clientEmail,
      });
      setStatus('invoiced');
      Alert.alert('Invoice Sent', `Invoice for £${job.price || job.total} sent to ${job.name || job.clientName}.`);
    } catch (error) {
      Alert.alert('Invoice Error', error.message || 'Failed to send invoice. Queued for later.');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Smart photo type based on job status ──
  function getDefaultPhotoType() {
    if (['scheduled', 'en-route'].includes(status)) return 'before';
    return 'after';
  }

  // ── Prompt for photo type then capture ──
  function promptPhotoType(captureMethod) {
    const defaultType = getDefaultPhotoType();
    Alert.alert(
      'Photo Type',
      `Is this a BEFORE or AFTER photo?\n(Default: ${defaultType.toUpperCase()})`,
      [
        { text: 'Before', onPress: () => captureMethod('before') },
        { text: 'After', onPress: () => captureMethod('after'), style: 'default' },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  // ── Take or pick photo ──
  async function takePhoto(photoType) {
    if (!photoType) { promptPhotoType(takePhoto); return; }

    const { status: permStatus } = await ImagePicker.requestCameraPermissionsAsync();
    if (permStatus !== 'granted') {
      Alert.alert('Permission Needed', 'Camera access is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      const photo = result.assets[0];
      setPhotos(prev => [...prev, { uri: photo.uri, base64: photo.base64, type: photoType }]);

      // Upload in background with type tag
      try {
        await uploadJobPhoto(job.jobNumber || job.ref, {
          photo: photo.base64,
          filename: `job-${job.jobNumber || job.ref}-${Date.now()}.jpg`,
          type: photoType,
          caption: `${photoType === 'before' ? 'Before' : 'After'} photo — ${job?.service || 'job'}`,
        });
      } catch (err) {
        console.warn('Photo upload queued for offline sync');
      }
    }
  }

  async function pickFromGallery(photoType) {
    if (!photoType) { promptPhotoType(pickFromGallery); return; }

    const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permStatus !== 'granted') {
      Alert.alert('Permission Needed', 'Gallery access is required to select photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const newPhotos = result.assets.map(asset => ({
        uri: asset.uri,
        base64: asset.base64,
        type: photoType,
      }));
      setPhotos(prev => [...prev, ...newPhotos]);

      // Upload each with type tag
      for (const p of newPhotos) {
        try {
          await uploadJobPhoto(job.jobNumber || job.ref, {
            photo: p.base64,
            filename: `job-${job.jobNumber || job.ref}-${Date.now()}.jpg`,
            type: photoType,
            caption: `${photoType === 'before' ? 'Before' : 'After'} photo — ${job?.service || 'job'}`,
          });
        } catch (err) {
          console.warn('Photo upload queued');
        }
      }
    }
  }

  // ── Derive next action ──
  function getNextAction() {
    const next = STATUS_FLOW[currentIdx + 1];
    if (!next) return null;
    const labels = {
      'en-route': '🚗 Start Driving',
      'in-progress': '🔨 Arrived — Start Job',
      completed: '✅ Complete Job',
      invoiced: '📧 Send Invoice',
    };
    return { next, label: labels[next] || 'Next' };
  }

  const nextAction = getNextAction();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Status banner (like email status header) ── */}
      <View style={[styles.statusBanner, { backgroundColor: statusMeta.bg }]}>
        <Text style={styles.statusIcon}>{statusMeta.icon}</Text>
        <View>
          <Text style={[styles.statusLabel, { color: statusMeta.color }]}>{statusMeta.label}</Text>
          {startTime && status === 'in-progress' && (
            <Text style={styles.timerText}>Started {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          )}
        </View>
      </View>

      {/* ── Progress dots ── */}
      <View style={styles.progressBar}>
        {STATUS_FLOW.map((s, i) => (
          <View key={s} style={styles.progressStep}>
            <View style={[
              styles.progressDot,
              i <= currentIdx && styles.progressDotActive,
              i === currentIdx && styles.progressDotCurrent,
            ]} />
            {i < STATUS_FLOW.length - 1 && (
              <View style={[
                styles.progressLine,
                i < currentIdx && styles.progressLineActive,
              ]} />
            )}
          </View>
        ))}
      </View>

      {/* ── Job Details Card (like email booking confirmation) ── */}
      <View style={styles.detailCard}>
        <View style={styles.cardTitleBar}>
          <Text style={styles.cardTitle}>📋 Job Details</Text>
        </View>

        <View style={styles.tableBody}>
          <DetailRow label="Service" value={`🌿 ${job?.service || job?.serviceName || '—'}`} />
          <DetailRow label="Client" value={job?.name || job?.clientName || '—'} alt />
          <DetailRow label="Email" value={job?.email || job?.clientEmail || '—'} />
          <DetailRow label="Phone" value={job?.phone || '—'} alt onPress={() => {
            if (job?.phone) Linking.openURL(`tel:${job.phone}`);
          }} />
          <DetailRow label="Address" value={job?.address || '—'} />
          <DetailRow label="Postcode" value={job?.postcode || '—'} alt />
          <DetailRow label="Amount" value={`£${job?.price || job?.total || '0'}`} highlight />
        </View>
      </View>

      {/* ── Directions Button ── */}
      <TouchableOpacity style={styles.directionsButton} onPress={openDirections} activeOpacity={0.7}>
        <Text style={styles.directionsButtonText}>📍 Get Directions</Text>
      </TouchableOpacity>

      {/* ── Notes ── */}
      <View style={styles.detailCard}>
        <View style={styles.cardTitleBar}>
          <Text style={styles.cardTitle}>📝 Job Notes</Text>
        </View>
        <View style={styles.notesContainer}>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Add notes about this job..."
            placeholderTextColor={Colors.textMuted}
            value={notes}
            onChangeText={setNotes}
          />
        </View>
      </View>

      {/* ── Photos ── */}
      <View style={styles.detailCard}>
        <View style={styles.cardTitleBar}>
          <Text style={styles.cardTitle}>📸 Photos ({photos.length})</Text>
        </View>
        <View style={styles.photosContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoScroll}>
            {photos.map((photo, i) => (
              <View key={i} style={styles.photoWrapper}>
                <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                <View style={[styles.photoTypeBadge, { backgroundColor: photo.type === 'before' ? Colors.accentBlue : Colors.success }]}>
                  <Text style={styles.photoTypeBadgeText}>{photo.type === 'before' ? 'BEFORE' : 'AFTER'}</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addPhotoButton} onPress={() => takePhoto()}>
              <Text style={styles.addPhotoIcon}>📷</Text>
              <Text style={styles.addPhotoText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPhotoButton} onPress={() => pickFromGallery()}>
              <Text style={styles.addPhotoIcon}>🖼️</Text>
              <Text style={styles.addPhotoText}>Gallery</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {/* ── Primary Action ── */}
      {nextAction && (
        <TouchableOpacity
          style={[styles.mainAction, actionLoading && styles.mainActionDisabled]}
          onPress={() => handleAdvance(nextAction.next)}
          disabled={actionLoading}
          activeOpacity={0.7}
        >
          {actionLoading ? (
            <ActivityIndicator color={Colors.textWhite} />
          ) : (
            <Text style={styles.mainActionText}>{nextAction.label}</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Completed state — show invoice button if not yet invoiced */}
      {status === 'completed' && (
        <TouchableOpacity
          style={[styles.mainAction, { backgroundColor: Colors.accentBlue }]}
          onPress={handleSendInvoice}
          disabled={actionLoading}
          activeOpacity={0.7}
        >
          {actionLoading ? (
            <ActivityIndicator color={Colors.textWhite} />
          ) : (
            <Text style={styles.mainActionText}>📧 Send Invoice</Text>
          )}
        </TouchableOpacity>
      )}

      {status === 'invoiced' && (
        <View style={styles.doneContainer}>
          <Text style={styles.doneIcon}>🎉</Text>
          <Text style={styles.doneText}>Job complete & invoiced!</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

/* ── Detail row sub-component ── */
function DetailRow({ label, value, alt, highlight, onPress }) {
  const row = (
    <View style={[styles.detailRow, alt && styles.detailRowAlt]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && styles.highlightValue]}>{value}</Text>
    </View>
  );
  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{row}</TouchableOpacity>;
  }
  return row;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: BorderRadius.md,
    marginBottom: 12,
    gap: 12,
  },
  statusIcon: {
    fontSize: 28,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  timerText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  progressStep: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.border,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
  },
  progressDotCurrent: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: Colors.primaryLight,
    backgroundColor: Colors.primary,
  },
  progressLine: {
    flex: 1,
    height: 3,
    backgroundColor: Colors.border,
    marginLeft: 4,
  },
  progressLineActive: {
    backgroundColor: Colors.primary,
  },
  detailCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  cardTitleBar: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  cardTitle: {
    color: Colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  tableBody: {
    // rows will alternate
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 15,
    alignItems: 'center',
  },
  detailRowAlt: {
    backgroundColor: Colors.cardAlt,
  },
  detailLabel: {
    width: 80,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  highlightValue: {
    fontWeight: '700',
    color: Colors.primary,
    fontSize: 16,
  },
  directionsButton: {
    backgroundColor: Colors.accentBlue,
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginBottom: 16,
    ...Shadows.button,
  },
  directionsButtonText: {
    color: Colors.textWhite,
    fontSize: 15,
    fontWeight: '600',
  },
  notesContainer: {
    padding: 12,
  },
  notesInput: {
    minHeight: 80,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  photosContainer: {
    padding: 12,
  },
  photoScroll: {
    gap: 10,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
  },
  photoWrapper: {
    position: 'relative',
  },
  photoTypeBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
    alignItems: 'center',
    borderBottomLeftRadius: BorderRadius.sm,
    borderBottomRightRadius: BorderRadius.sm,
  },
  photoTypeBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.cardTint,
  },
  addPhotoIcon: {
    fontSize: 22,
  },
  addPhotoText: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 4,
  },
  mainAction: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginBottom: 12,
    ...Shadows.button,
  },
  mainActionDisabled: {
    opacity: 0.6,
  },
  mainActionText: {
    color: Colors.textWhite,
    fontSize: 17,
    fontWeight: '700',
  },
  doneContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  doneIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.success,
  },
});
