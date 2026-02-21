/**
 * Bots Screen — Telegram bot message feed.
 * GGM Field v3.0
 * 
 * DayBot, MoneyBot, ContentBot, CoachBot messages in a chat-like feed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, Typography } from '../theme';
import { getBotMessages } from '../services/api';
import GGMCard from '../components/GGMCard';
import EmptyState from '../components/EmptyState';

const BOT_META = {
  daybot:     { label: 'DayBot',     icon: 'sunny-outline',       color: '#FF9800' },
  moneybot:   { label: 'MoneyBot',   icon: 'cash-outline',        color: '#4CAF50' },
  contentbot: { label: 'ContentBot', icon: 'create-outline',      color: '#2196F3' },
  coachbot:   { label: 'CoachBot',   icon: 'fitness-outline',     color: '#9C27B0' },
};

const FILTERS = ['all', 'daybot', 'moneybot', 'contentbot', 'coachbot'];

function formatTimestamp(unixTs) {
  if (!unixTs) return '';
  const d = new Date(unixTs * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ` ${time}`;
}

function MessageCard({ item }) {
  const meta = BOT_META[item.bot] || BOT_META.daybot;
  return (
    <GGMCard accentColor={meta.color} style={{ marginBottom: Spacing.sm }}>
      <View style={styles.messageHeader}>
        <View style={[styles.botIconWrap, { backgroundColor: meta.color + '20' }]}>
          <Ionicons name={meta.icon} size={18} color={meta.color} />
        </View>
        <Text style={[styles.botName, { color: meta.color }]}>{meta.label}</Text>
        <Text style={styles.messageTime}>{formatTimestamp(item.date)}</Text>
      </View>
      <Text style={styles.messageText}>{item.text}</Text>
    </GGMCard>
  );
}

export default function BotsScreen() {
  const [messages, setMessages] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [cached, setCached] = useState(false);

  const loadMessages = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      setError(null);
      const data = await getBotMessages(50);
      if (data && data.messages) {
        setMessages(data.messages);
        setCached(!!data._cached);
      } else {
        setMessages([]);
        if (data?._cached) setCached(true);
      }
    } catch (e) {
      setError('Could not load bot messages');
      console.warn('BotsScreen load error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(() => loadMessages(), 60000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  const filtered = filter === 'all'
    ? messages
    : messages.filter(m => m.bot === filter);

  const counts = {};
  for (const m of messages) {
    counts[m.bot] = (counts[m.bot] || 0) + 1;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading bot messages...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {cached && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.warning} />
          <Text style={styles.offlineText}>Offline \u2014 showing cached messages</Text>
        </View>
      )}

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => {
          const meta = BOT_META[f];
          const isActive = filter === f;
          const count = f === 'all' ? messages.length : (counts[f] || 0);
          return (
            <TouchableOpacity
              key={f}
              style={[
                styles.filterChip,
                isActive && styles.filterChipActive,
                isActive && meta && { backgroundColor: meta.color },
              ]}
              onPress={() => setFilter(f)}
            >
              {f === 'all' ? (
                <Ionicons name="list-outline" size={14}
                  color={isActive ? Colors.textWhite : Colors.textSecondary} />
              ) : (
                <Ionicons name={meta.icon} size={14}
                  color={isActive ? Colors.textWhite : meta.color} />
              )}
              <Text style={[
                styles.filterChipText,
                isActive && styles.filterChipTextActive,
              ]}>
                {f === 'all' ? 'All' : meta.label}
                {count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Error state */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => loadMessages()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No bot messages yet"
          subtitle="Messages from DayBot, MoneyBot, ContentBot and CoachBot will appear here."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.bot}-${item.messageId || index}`}
          renderItem={({ item }) => <MessageCard item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadMessages(true)}
              colors={[Colors.primary]} tintColor={Colors.primary} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: Spacing.md,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warningBorder,
    paddingVertical: Spacing.sm,
  },
  offlineText: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.textWhite,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.errorBg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.errorBorder,
  },
  errorText: {
    fontSize: 13,
    color: Colors.error,
    fontWeight: '600',
  },
  retryText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  botIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  messageTime: {
    fontSize: 11,
    color: Colors.textLight,
  },
  messageText: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  listContent: {
    padding: Spacing.md,
    paddingBottom: 100,
  },
});
