/**
 * Schedule Screen — Weekly calendar with job cards.
 * GGM Field v3.0
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  RefreshControl, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, StatusConfig, ServiceIcons } from '../theme';
import { getSchedule } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import LoadingOverlay from '../components/LoadingOverlay';
import KPICard from '../components/KPICard';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export default function ScheduleScreen({ navigation }) {
  const [sections, setSections] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useFocusEffect(
    useCallback(() => {
      loadSchedule();
    }, [weekOffset])
  );

  async function loadSchedule() {
    try {
      const data = await getSchedule(weekOffset);
      if (data.status === 'success') {
        const allVisits = data.visits || data.schedule || [];
        const groups = {};
        allVisits.forEach(job => {
          const dateKey = job.visitDate || job.date || job.scheduledDate || 'Unknown';
          if (!groups[dateKey]) groups[dateKey] = [];
          groups[dateKey].push({
            ...job,
            date: dateKey,
            service: job.service || job.serviceName || '',
            name: job.name || job.clientName || '',
            price: job.price || job.total || '',
            postcode: job.postcode || '',
            jobNumber: job.jobNumber || job.parentJob || ('SCHED-' + job.rowIndex),
            ref: job.jobNumber || job.parentJob || ('SCHED-' + job.rowIndex),
          });
        });

        const sorted = Object.entries(groups)
          .sort(([a], [b]) => new Date(a) - new Date(b))
          .map(([date, jobs]) => ({
            title: date,
            data: jobs,
            revenue: jobs.reduce((sum, j) => sum + (parseFloat(j.price || j.total || '0') || 0), 0),
          }));

        setSections(sorted);
      } else {
        setSections([]);
      }
    } catch (error) {
      console.warn('Failed to load schedule:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    loadSchedule();
  }

  // Weekly totals
  const totalJobs = sections.reduce((sum, s) => sum + s.data.length, 0);
  const totalRevenue = sections.reduce((sum, s) => sum + s.revenue, 0);

  function renderSectionHeader({ section }) {
    const today = isToday(section.title);
    return (
      <View style={[styles.sectionHeader, today && styles.sectionHeaderToday]}>
        <View style={styles.sectionHeaderLeft}>
          {today && <View style={styles.todayDot} />}
          <Ionicons
            name={today ? 'today' : 'calendar-outline'}
            size={16}
            color={today ? Colors.primary : Colors.textMuted}
          />
          <Text style={[styles.sectionHeaderText, today && styles.sectionHeaderTextToday]}>
            {formatDate(section.title)}
          </Text>
        </View>
        <View style={styles.sectionMeta}>
          <Text style={styles.sectionCount}>{section.data.length} jobs</Text>
          <Text style={styles.sectionRevenue}>{'\u00A3'}{section.revenue.toFixed(0)}</Text>
        </View>
      </View>
    );
  }

  function renderJob({ item }) {
    const statusKey = item.status || 'scheduled';
    const config = StatusConfig[statusKey] || StatusConfig.scheduled;
    const serviceIcon = ServiceIcons[item.service || item.serviceName] || ServiceIcons.default;

    return (
      <TouchableOpacity
        style={styles.jobRow}
        onPress={() => navigation.navigate('JobDetail', {
          jobRef: item.jobNumber || item.ref,
          job: item,
        })}
        activeOpacity={0.7}
      >
        <View style={[styles.jobStatusDot, { backgroundColor: config.color }]} />
        <Ionicons name={serviceIcon} size={18} color={config.color} style={{ marginRight: 8 }} />
        <View style={styles.jobInfo}>
          <Text style={styles.jobService}>{item.service || item.serviceName || 'Job'}</Text>
          <Text style={styles.jobClient}>{item.name || item.clientName || 'Client'}</Text>
        </View>
        <View style={styles.jobRight}>
          <Text style={styles.jobPrice}>{'\u00A3'}{item.price || item.total || '0'}</Text>
          <Text style={styles.jobPostcode}>{item.postcode || ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingOverlay message="Loading schedule..." />;

  return (
    <View style={styles.container}>
      {/* Week navigation */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => setWeekOffset(w => w - 1)} style={styles.weekButton}>
          <Ionicons name="chevron-back" size={20} color={Colors.primary} />
          <Text style={styles.weekButtonText}>Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekOffset(0)} style={styles.weekCurrent}>
          <Text style={styles.weekCurrentText}>
            {weekOffset === 0 ? 'This Week' : weekOffset > 0 ? `+${weekOffset} Week` : `${weekOffset} Week`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekOffset(w => w + 1)} style={styles.weekButton}>
          <Text style={styles.weekButtonText}>Next</Text>
          <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Weekly KPIs */}
      {sections.length > 0 && (
        <View style={styles.kpiRow}>
          <KPICard icon="briefcase-outline" label="Jobs" value={totalJobs} color={Colors.primary} />
          <KPICard icon="cash-outline" label="Revenue" value={`\u00A3${totalRevenue.toFixed(0)}`} color={Colors.success} />
        </View>
      )}

      <SectionList
        sections={sections}
        renderItem={renderJob}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item, i) => item.jobNumber || item.ref || String(i)}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            colors={[Colors.primary]} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="No jobs scheduled"
            subtitle={weekOffset === 0 ? 'Nothing booked for this week.' : 'No jobs for this period.'}
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
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  weekButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
  },
  weekButtonText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
  },
  weekCurrent: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: Colors.primaryLight + '20',
    borderRadius: BorderRadius.md,
  },
  weekCurrentText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.cardTint,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionHeaderToday: {
    backgroundColor: Colors.successBg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sectionHeaderTextToday: {
    color: Colors.primary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  sectionRevenue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  jobStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  jobInfo: {
    flex: 1,
  },
  jobService: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  jobClient: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  jobRight: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  jobPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  jobPostcode: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
