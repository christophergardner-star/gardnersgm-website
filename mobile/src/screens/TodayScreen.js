/**
 * Today Screen — Professional daily job dashboard.
 * GGM Field v3.0
 * 
 * Features: KPI summary, weather banner, job cards with Ionicons,
 * offline banner, pull-to-refresh.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, StatusConfig, ServiceIcons } from '../theme';
import { getTodaysJobs, processOfflineQueue, apiGet } from '../services/api';
import GGMCard from '../components/GGMCard';
import KPICard from '../components/KPICard';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import LoadingOverlay from '../components/LoadingOverlay';

export default function TodayScreen({ navigation }) {
  const [jobs, setJobs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usingCache, setUsingCache] = useState(false);
  const [weather, setWeather] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [])
  );

  async function loadJobs() {
    try {
      const synced = await processOfflineQueue();
      if (synced > 0) console.log(`Synced ${synced} offline actions`);

      const data = await getTodaysJobs();
      if (data.status === 'success') {
        setJobs(data.jobs || []);
        setUsingCache(!!data._cached);
      }

      // Load weather silently
      try {
        const wx = await apiGet('get_weather', { postcode: 'PL26' });
        if (wx?.forecast?.[0]) setWeather(wx.forecast[0]);
        else if (wx?.daily?.[0]) setWeather(wx.daily[0]);
      } catch (e) { /* silent */ }
    } catch (error) {
      console.warn('Failed to load jobs:', error.message);
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
      case 'scheduled':    return { label: 'Start Drive',     icon: 'car-outline',              next: 'en-route' };
      case 'en-route':     return { label: 'Arrive & Start',  icon: 'construct-outline',        next: 'in-progress' };
      case 'in-progress':  return { label: 'Complete Job',    icon: 'checkmark-circle-outline', next: 'completed' };
      case 'completed':    return { label: 'Send Invoice',    icon: 'receipt-outline',          next: 'invoiced' };
      default: return null;
    }
  }

  // KPI calculations
  const totalJobs = jobs.length;
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
  const totalRevenue = jobs.reduce((sum, j) => sum + (parseFloat(j.price || j.total || '0') || 0), 0);
  const activeJob = jobs.find(j => j.status === 'in-progress' || j.status === 'en-route');

  function renderJob({ item, index }) {
    const statusKey = item.status || 'scheduled';
    const config = StatusConfig[statusKey] || StatusConfig.scheduled;
    const isActive = ['en-route', 'in-progress'].includes(statusKey);
    const nextAction = getNextAction(statusKey);
    const serviceIcon = ServiceIcons[item.service || item.serviceName] || ServiceIcons.default;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('JobDetail', {
          jobRef: item.jobNumber || item.ref,
          job: item,
        })}
      >
        <GGMCard accentColor={config.color} style={isActive && styles.activeCard}>
          {/* Top row: service + status */}
          <View style={styles.jobTop}>
            <View style={styles.jobTopLeft}>
              <View style={[styles.serviceIconWrap, { backgroundColor: config.color + '14' }]}>
                <Ionicons name={serviceIcon} size={18} color={config.color} />
              </View>
              <View>
                <Text style={styles.jobService}>{item.service || item.serviceName || 'Job'}</Text>
                <Text style={styles.jobClient}>{item.name || item.clientName || 'Client'}</Text>
              </View>
            </View>
            <StatusBadge status={statusKey} size="sm" />
          </View>

          {/* Details row */}
          <View style={styles.jobDetails}>
            <View style={styles.jobDetail}>
              <Ionicons name="location-outline" size={14} color={Colors.textMuted} />
              <Text style={styles.jobDetailText} numberOfLines={1}>{item.postcode || item.address || '—'}</Text>
            </View>
            <View style={styles.jobDetail}>
              <Ionicons name="cash-outline" size={14} color={Colors.primary} />
              <Text style={[styles.jobDetailText, styles.jobPrice]}>{'\u00A3'}{item.price || item.total || '0'}</Text>
            </View>
          </View>

          {/* Action button */}
          {nextAction && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: config.color }]}
              onPress={() => navigation.navigate('JobDetail', {
                jobRef: item.jobNumber || item.ref,
                job: item,
                autoAction: nextAction.next,
              })}
              activeOpacity={0.7}
            >
              <Ionicons name={nextAction.icon} size={16} color="#fff" />
              <Text style={styles.actionBtnText}>{nextAction.label}</Text>
            </TouchableOpacity>
          )}
        </GGMCard>
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingOverlay message="Loading today's jobs..." />;

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {usingCache && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.warning} />
          <Text style={styles.offlineText}>Offline — showing cached data</Text>
        </View>
      )}

      {/* Weather mini-banner */}
      {weather && (
        <View style={styles.weatherBanner}>
          <Ionicons name="cloud-outline" size={14} color={Colors.textWhite} />
          <Text style={styles.weatherText}>
            {weather.condition || weather.weather || ''} — {weather.maxTemp || weather.high || ''}°C
          </Text>
        </View>
      )}

      {/* KPI Row */}
      <View style={styles.kpiRow}>
        <KPICard icon="briefcase-outline" label="Jobs" value={totalJobs} color={Colors.primary} />
        <KPICard icon="checkmark-done-outline" label="Done" value={completedJobs} color={Colors.success} />
        <KPICard icon="cash-outline" label="Revenue" value={`\u00A3${totalRevenue.toFixed(0)}`} color={Colors.accentBlue} />
      </View>

      <FlatList
        data={jobs}
        renderItem={renderJob}
        keyExtractor={(item, i) => item.jobNumber || item.ref || String(i)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={[Colors.primary]} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="sunny-outline"
            title="No jobs today"
            subtitle="Enjoy your day off! Pull down to refresh."
          />
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
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warningBorder,
    paddingVertical: 8,
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.warning,
  },
  weatherBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingVertical: 6,
  },
  weatherText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textWhite,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  list: {
    paddingBottom: 100,
  },
  activeCard: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  jobTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  jobTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  serviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobService: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  jobClient: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 1,
  },
  jobDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  jobDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  jobDetailText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  jobPrice: {
    fontWeight: '700',
    color: Colors.primary,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
