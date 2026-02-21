/**
 * Job Detail Screen — Full linear workflow for a single job.
 * GGM Field v3.0
 * 
 * Flow: Scheduled → En Route → In Progress → Completed → Invoiced
 * Risk Assessment gate before starting. Client signature on completion.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, StyleSheet, Linking, Platform, Image,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Spacing, BorderRadius, Shadows, StatusConfig, ServiceIcons } from '../theme';
import {
  updateJobStatus, startJob, completeJob,
  sendInvoice, uploadJobPhoto,
} from '../services/api';
import { captureJobLocation } from '../services/location';
import GGMCard from '../components/GGMCard';
import StatusBadge from '../components/StatusBadge';
import ProgressSteps from '../components/ProgressSteps';
import SectionHeader from '../components/SectionHeader';
import IconButton from '../components/IconButton';

const STATUS_FLOW = ['scheduled', 'en-route', 'in-progress', 'completed', 'invoiced'];

export default function JobDetailScreen({ route, navigation }) {
  const { job, autoAction } = route.params || {};
  const [status, setStatus] = useState(job?.status || 'scheduled');
  const [notes, setNotes] = useState(job?.notes || '');
  const [photos, setPhotos] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [startTime, setStartTime] = useState(null);

  const startTimeKey = 'ggm_start_' + (job?.jobNumber || job?.ref || '');
  const statusConfig = StatusConfig[status] || StatusConfig.scheduled;
  const currentIdx = STATUS_FLOW.indexOf(status);
  const serviceIcon = ServiceIcons[job?.service || job?.serviceName] || ServiceIcons.default;

  useEffect(() => {
    navigation.setOptions({
      title: job?.name || job?.clientName || 'Job Detail',
    });
    if (status === 'in-progress' || status === 'completed') {
      AsyncStorage.getItem(startTimeKey).then(stored => {
        if (stored) setStartTime(new Date(stored));
      }).catch(() => {});
    }
    if (autoAction) {
      handleAdvance(autoAction);
    }
  }, []);

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

  async function handleAdvance(nextStatus) {
    if (!nextStatus) return;

    // Risk Assessment gate — must complete before starting work
    if (nextStatus === 'in-progress') {
      navigation.navigate('RiskAssessment', {
        jobRef: job?.jobNumber || job?.ref,
        jobName: job?.service || job?.serviceName || 'Job',
        onComplete: () => advanceTo('in-progress'),
      });
      return;
    }

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
      const locationData = await captureJobLocation(nextStatus);

      if (nextStatus === 'in-progress') {
        const now = new Date();
        setStartTime(now);
        await AsyncStorage.setItem(startTimeKey, now.toISOString());
        await startJob(job.jobNumber || job.ref, {
          startTime: now.toISOString(),
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
        await AsyncStorage.removeItem(startTimeKey).catch(() => {});
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
      Alert.alert('Invoice Sent', `Invoice for \u00A3${job.price || job.total} sent to ${job.name || job.clientName}.`);
    } catch (error) {
      Alert.alert('Invoice Error', error.message || 'Failed to send invoice. Queued for later.');
    } finally {
      setActionLoading(false);
    }
  }

  function getDefaultPhotoType() {
    if (['scheduled', 'en-route'].includes(status)) return 'before';
    return 'after';
  }

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

  async function takePhoto(photoType) {
    if (!photoType) { promptPhotoType(takePhoto); return; }
    const { status: permStatus } = await ImagePicker.requestCameraPermissionsAsync();
    if (permStatus !== 'granted') {
      Alert.alert('Permission Needed', 'Camera access is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.[0]) {
      const photo = result.assets[0];
      setPhotos(prev => [...prev, { uri: photo.uri, base64: photo.base64, type: photoType }]);
      try {
        await uploadJobPhoto(job.jobNumber || job.ref, {
          photo: photo.base64,
          filename: `job-${job.jobNumber || job.ref}-${Date.now()}.jpg`,
          type: photoType,
          caption: `${photoType === 'before' ? 'Before' : 'After'} photo`,
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
      quality: 0.7, base64: true, allowsMultipleSelection: true, selectionLimit: 5,
    });
    if (!result.canceled && result.assets?.length > 0) {
      const newPhotos = result.assets.map(asset => ({
        uri: asset.uri, base64: asset.base64, type: photoType,
      }));
      setPhotos(prev => [...prev, ...newPhotos]);
      for (const p of newPhotos) {
        try {
          await uploadJobPhoto(job.jobNumber || job.ref, {
            photo: p.base64,
            filename: `job-${job.jobNumber || job.ref}-${Date.now()}.jpg`,
            type: photoType,
            caption: `${photoType === 'before' ? 'Before' : 'After'} photo`,
          });
        } catch (err) { console.warn('Photo upload queued'); }
      }
    }
  }

  function getNextAction() {
    const next = STATUS_FLOW[currentIdx + 1];
    if (!next) return null;
    const actions = {
      'en-route':    { label: 'Start Driving',    icon: 'car-outline' },
      'in-progress': { label: 'Arrive & Start',   icon: 'construct-outline' },
      completed:     { label: 'Complete Job',      icon: 'checkmark-circle-outline' },
      invoiced:      { label: 'Send Invoice',      icon: 'receipt-outline' },
    };
    return { next, ...(actions[next] || { label: 'Next', icon: 'arrow-forward-outline' }) };
  }

  const nextAction = getNextAction();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Status Banner */}
      <View style={[styles.statusBanner, { backgroundColor: statusConfig.bg }]}>
        <View style={[styles.statusIconWrap, { backgroundColor: statusConfig.color + '30' }]}>
          <Ionicons name={statusConfig.icon} size={24} color={statusConfig.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusLabel, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          {startTime && status === 'in-progress' && (
            <Text style={styles.timerText}>
              Started {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
        <StatusBadge status={status} size="md" />
      </View>

      {/* Progress Steps */}
      <ProgressSteps currentStatus={status} style={{ marginBottom: Spacing.lg }} />

      {/* Job Details Card */}
      <GGMCard accentColor={Colors.primary} style={{ marginBottom: Spacing.md }}>
        <SectionHeader icon="document-text-outline" title="Job Details" />
        <View style={styles.detailsGrid}>
          <DetailRow icon="leaf-outline" label="Service" value={job?.service || job?.serviceName || '\u2014'} />
          <DetailRow icon="person-outline" label="Client" value={job?.name || job?.clientName || '\u2014'} />
          <DetailRow icon="mail-outline" label="Email" value={job?.email || job?.clientEmail || '\u2014'} />
          <DetailRow icon="call-outline" label="Phone" value={job?.phone || '\u2014'}
            onPress={() => job?.phone && Linking.openURL(`tel:${job.phone}`)} />
          <DetailRow icon="location-outline" label="Address" value={job?.address || '\u2014'} />
          <DetailRow icon="map-outline" label="Postcode" value={job?.postcode || '\u2014'} />
          <DetailRow icon="cash-outline" label="Amount" value={`\u00A3${job?.price || job?.total || '0'}`} highlight />
        </View>
      </GGMCard>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickBtn} onPress={openDirections} activeOpacity={0.7}>
          <Ionicons name="navigate-outline" size={20} color={Colors.accentBlue} />
          <Text style={styles.quickBtnText}>Directions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn}
          onPress={() => job?.phone && Linking.openURL(`tel:${job.phone}`)}
          activeOpacity={0.7}>
          <Ionicons name="call-outline" size={20} color={Colors.success} />
          <Text style={styles.quickBtnText}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn}
          onPress={() => navigation.navigate('RiskAssessment', {
            jobRef: job?.jobNumber || job?.ref,
            jobName: job?.service || 'Job',
          })} activeOpacity={0.7}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.warning} />
          <Text style={styles.quickBtnText}>H&S</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn}
          onPress={() => navigation.navigate('Signature', {
            jobRef: job?.jobNumber || job?.ref,
            clientName: job?.name || job?.clientName || 'Client',
          })} activeOpacity={0.7}>
          <Ionicons name="create-outline" size={20} color={Colors.primary} />
          <Text style={styles.quickBtnText}>Sign</Text>
        </TouchableOpacity>
      </View>

      {/* Notes */}
      <GGMCard style={{ marginBottom: Spacing.md }}>
        <SectionHeader icon="create-outline" title="Job Notes" />
        <TextInput
          style={styles.notesInput}
          multiline
          placeholder="Add notes about this job..."
          placeholderTextColor={Colors.textMuted}
          value={notes}
          onChangeText={setNotes}
        />
      </GGMCard>

      {/* Photos */}
      <GGMCard style={{ marginBottom: Spacing.md }}>
        <SectionHeader icon="camera-outline" title={`Photos (${photos.length})`} />
        <View style={styles.photosContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoScroll}>
            {photos.map((photo, i) => (
              <View key={i} style={styles.photoWrapper}>
                <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                <View style={[styles.photoTypeBadge, {
                  backgroundColor: photo.type === 'before' ? Colors.accentBlue : Colors.success
                }]}>
                  <Text style={styles.photoTypeBadgeText}>{photo.type === 'before' ? 'BEFORE' : 'AFTER'}</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addPhotoButton} onPress={() => takePhoto()}>
              <Ionicons name="camera-outline" size={24} color={Colors.textMuted} />
              <Text style={styles.addPhotoText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addPhotoButton} onPress={() => pickFromGallery()}>
              <Ionicons name="images-outline" size={24} color={Colors.textMuted} />
              <Text style={styles.addPhotoText}>Gallery</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </GGMCard>

      {/* Primary Action */}
      {nextAction && (
        <TouchableOpacity
          style={[styles.mainAction, { backgroundColor: statusConfig.color }, actionLoading && styles.mainActionDisabled]}
          onPress={() => handleAdvance(nextAction.next)}
          disabled={actionLoading}
          activeOpacity={0.7}
        >
          {actionLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.mainActionInner}>
              <Ionicons name={nextAction.icon} size={20} color="#fff" />
              <Text style={styles.mainActionText}>{nextAction.label}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Invoice button when completed */}
      {status === 'completed' && (
        <TouchableOpacity
          style={[styles.mainAction, { backgroundColor: Colors.accentBlue }]}
          onPress={handleSendInvoice}
          disabled={actionLoading}
          activeOpacity={0.7}
        >
          {actionLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.mainActionInner}>
              <Ionicons name="receipt-outline" size={20} color="#fff" />
              <Text style={styles.mainActionText}>Send Invoice</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Completed state */}
      {status === 'invoiced' && (
        <View style={styles.doneContainer}>
          <Ionicons name="checkmark-circle" size={52} color={Colors.success} />
          <Text style={styles.doneText}>Job complete & invoiced!</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DetailRow({ icon, label, value, highlight, onPress }) {
  const row = (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={Colors.textMuted} style={{ marginTop: 1 }} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && styles.highlightValue]} numberOfLines={1}>{value}</Text>
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress}>{row}</TouchableOpacity>;
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
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  statusIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
  detailsGrid: {
    marginTop: Spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: Spacing.sm,
  },
  detailLabel: {
    width: 65,
    fontSize: 12,
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
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  quickBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  notesInput: {
    minHeight: 80,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
    lineHeight: 20,
    marginTop: Spacing.sm,
  },
  photosContainer: {
    marginTop: Spacing.sm,
  },
  photoScroll: {
    gap: 10,
  },
  photoWrapper: {
    position: 'relative',
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
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
    gap: 4,
  },
  addPhotoText: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  mainAction: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    ...Shadows.button,
  },
  mainActionDisabled: {
    opacity: 0.6,
  },
  mainActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mainActionText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  doneContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: Spacing.sm,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.success,
  },
});
