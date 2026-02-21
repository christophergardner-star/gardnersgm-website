/**
 * Client Detail Screen — Full client profile with job history.
 * GGM Field v3.0
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, StatusConfig, ServiceIcons } from '../theme';
import GGMCard from '../components/GGMCard';
import SectionHeader from '../components/SectionHeader';
import StatusBadge from '../components/StatusBadge';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';

export default function ClientDetailScreen({ route, navigation }) {
  const { client } = route.params || {};

  if (!client) {
    return <EmptyState icon="person-outline" title="No client data" subtitle="Please select a client from the list." />;
  }

  const initials = (client.name || 'C').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  function callClient() {
    if (client.phone) Linking.openURL(`tel:${client.phone}`);
    else Alert.alert('No Phone', 'No phone number on file for this client.');
  }

  function emailClient() {
    if (client.email) Linking.openURL(`mailto:${client.email}`);
    else Alert.alert('No Email', 'No email address on file for this client.');
  }

  function openDirections() {
    const addr = encodeURIComponent(client.address || client.postcode || '');
    if (!addr) { Alert.alert('No Address', 'No address on file.'); return; }
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${addr}`);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile card */}
      <GGMCard>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{client.name}</Text>
            <Text style={styles.profilePostcode}>{client.postcode || client.address || '—'}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{client.totalJobs || 0}</Text>
            <Text style={styles.statLabel}>Jobs</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {'\u00A3'}{parseFloat(client.totalRevenue || 0).toFixed(0)}
            </Text>
            <Text style={styles.statLabel}>Revenue</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {client.recentJobs?.[0]?.date?.slice(0, 10) || '—'}
            </Text>
            <Text style={styles.statLabel}>Last Visit</Text>
          </View>
        </View>
      </GGMCard>

      {/* Quick actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={callClient}>
          <Ionicons name="call-outline" size={20} color={Colors.primary} />
          <Text style={styles.actionLabel}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={emailClient}>
          <Ionicons name="mail-outline" size={20} color={Colors.primary} />
          <Text style={styles.actionLabel}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={openDirections}>
          <Ionicons name="navigate-outline" size={20} color={Colors.primary} />
          <Text style={styles.actionLabel}>Directions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Quote', { client })}
        >
          <Ionicons name="calculator-outline" size={20} color={Colors.primary} />
          <Text style={styles.actionLabel}>Quote</Text>
        </TouchableOpacity>
      </View>

      {/* Contact details */}
      <SectionHeader icon="person-outline" title="Contact Details" />
      <GGMCard noPadding>
        <InfoRow icon="mail-outline" label="Email" value={client.email || '—'} />
        <InfoRow icon="call-outline" label="Phone" value={client.phone || '—'} />
        <InfoRow icon="location-outline" label="Address" value={client.address || '—'} />
        <InfoRow icon="map-outline" label="Postcode" value={client.postcode || '—'} last />
      </GGMCard>

      {/* Job history */}
      <SectionHeader
        icon="time-outline"
        title="Job History"
        right={
          <Text style={styles.historyCount}>
            {client.recentJobs?.length || 0} total
          </Text>
        }
      />
      {client.recentJobs && client.recentJobs.length > 0 ? (
        <GGMCard noPadding>
          {client.recentJobs.slice(0, 10).map((job, i) => {
            const serviceIcon = ServiceIcons[job.service] || ServiceIcons.default;
            return (
              <View key={i} style={[styles.jobRow, i > 0 && styles.jobRowBorder]}>
                <Ionicons name={serviceIcon} size={18} color={Colors.primary} style={styles.jobIcon} />
                <View style={styles.jobInfo}>
                  <Text style={styles.jobService}>{job.service || '—'}</Text>
                  <Text style={styles.jobDate}>{job.date || '—'}</Text>
                </View>
                <Text style={styles.jobPrice}>
                  {'\u00A3'}{parseFloat(job.price || 0).toFixed(0)}
                </Text>
              </View>
            );
          })}
        </GGMCard>
      ) : (
        <EmptyState icon="briefcase-outline" title="No job history" />
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function InfoRow({ icon, label, value, last }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Ionicons name={icon} size={16} color={Colors.textMuted} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: Spacing.lg },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  profilePostcode: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: -2,
  },
  actionsRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    ...Shadows.card,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    marginTop: 4,
  },
  historyCount: {
    fontSize: 12,
    color: Colors.textLight,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoIcon: { marginRight: Spacing.sm },
  infoLabel: {
    width: 70,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  jobRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  jobIcon: { marginRight: Spacing.md },
  jobInfo: { flex: 1 },
  jobService: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  jobDate: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  jobPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
});
