/**
 * Today Screen — Daily job list with linear workflow.
 * Shows today's jobs in chronological order.
 * Tap a job to enter the job detail flow.
 * 
 * Styled like email booking cards with green headers.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, BorderRadius, Typography, Shadows } from '../theme';
import { getTodaysJobs, processOfflineQueue } from '../services/api';

const STATUS_CONFIG = {
  scheduled:    { icon: '🗓️', label: 'Scheduled', bg: Colors.infoBg, border: Colors.infoBorder, text: Colors.accentBlue },
  'en-route':   { icon: '🚗', label: 'En Route', bg: Colors.warningBg, border: Colors.warningBorder, text: Colors.warning },
  'in-progress': { icon: '🔨', label: 'In Progress', bg: Colors.warningBg, border: Colors.warningBorder, text: Colors.accentOrange },
  completed:    { icon: '✅', label: 'Completed', bg: Colors.successBg, border: Colors.successBorder, text: Colors.success },
  invoiced:     { icon: '📧', label: 'Invoiced', bg: Colors.successBg, border: Colors.successBorder, text: Colors.success },
};

export default function TodayScreen({ navigation }) {
  const [jobs, setJobs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [])
  );

  async function loadJobs() {
    try {
      // Process any offline queue first
      const synced = await processOfflineQueue();
      if (synced > 0) {
        console.log(`📦 Synced ${synced} offline actions`);
      }

      const data = await getTodaysJobs();
      if (data.status === 'success') {
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.warn('Failed to load jobs:', error.message);
      // Show cached data if available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    loadJobs();
  }

  function getNextAction(status) {
    switch (status) {
      case 'scheduled': return { label: '🚗 Start Drive', next: 'en-route' };
      case 'en-route': return { label: '🔨 Arrive & Start', next: 'in-progress' };
      case 'in-progress': return { label: '✅ Complete Job', next: 'completed' };
      case 'completed': return { label: '📧 Send Invoice', next: 'invoiced' };
      default: return null;
    }
  }

  function renderJob({ item, index }) {
    const status = STATUS_CONFIG[item.status || 'scheduled'] || STATUS_CONFIG.scheduled;
    const isActive = ['en-route', 'in-progress'].includes(item.status);
    const nextAction = getNextAction(item.status);

    return (
      <TouchableOpacity
        style={[styles.jobCard, isActive && styles.jobCardActive]}
        onPress={() => navigation.navigate('JobDetail', { 
          jobRef: item.jobNumber || item.ref,
          job: item,
        })}
        activeOpacity={0.7}
      >
        {/* Card header bar (like email detail cards) */}
        <View style={[styles.cardHeader, isActive && styles.cardHeaderActive]}>
          <Text style={styles.cardHeaderText}>
            🌿 Job {index + 1} of {jobs.length}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
            <Text style={[styles.statusText, { color: status.text }]}>
              {status.icon} {status.label}
            </Text>
          </View>
        </View>

        {/* Card body (like email table rows) */}
        <View style={styles.cardBody}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Service</Text>
            <Text style={styles.detailValue}>🌿 {item.service || item.serviceName || 'Unknown'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowAlt]}>
            <Text style={styles.detailLabel}>Client</Text>
            <Text style={styles.detailValue}>{item.name || item.clientName || 'Unknown'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{item.postcode || item.address || '—'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowAlt]}>
            <Text style={styles.detailLabel}>Amount</Text>
            <Text style={[styles.detailValue, styles.priceText]}>£{item.price || item.total || '0'}</Text>
          </View>
        </View>

        {/* Next action button (like email CTA button) */}
        {nextAction && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('JobDetail', {
                jobRef: item.jobNumber || item.ref,
                job: item,
                autoAction: nextAction.next,
              })}
              activeOpacity={0.7}
            >
              <Text style={styles.primaryButtonText}>{nextAction.label}</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🌿</Text>
        <Text style={styles.emptyText}>Loading today's jobs...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{jobs.length}</Text>
          <Text style={styles.summaryLabel}>Jobs</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>
            {jobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length}
          </Text>
          <Text style={styles.summaryLabel}>Done</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>
            £{jobs.reduce((sum, j) => sum + (parseFloat(j.price || j.total || '0') || 0), 0).toFixed(0)}
          </Text>
          <Text style={styles.summaryLabel}>Revenue</Text>
        </View>
      </View>

      <FlatList
        data={jobs}
        renderItem={renderJob}
        keyExtractor={(item, i) => item.jobNumber || item.ref || String(i)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>☀️</Text>
            <Text style={styles.emptyTitle}>No jobs today</Text>
            <Text style={styles.emptyText}>Enjoy your day off!</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.primary,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  list: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  jobCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  jobCardActive: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  cardHeader: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderActive: {
    backgroundColor: Colors.accentOrange,
  },
  cardHeaderText: {
    color: Colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 15,
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
  priceText: {
    fontWeight: '700',
    color: Colors.primary,
  },
  actionRow: {
    padding: 15,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: BorderRadius.md,
    ...Shadows.button,
  },
  primaryButtonText: {
    color: Colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
