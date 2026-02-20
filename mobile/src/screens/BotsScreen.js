/**
 * GGM Field App — Bots Screen
 * Shows recent messages from all 4 Telegram bots:
 *   DayBot, MoneyBot, ContentBot, CoachBot
 * 
 * Displays messages in a chat-like feed, newest first.
 * Filter by bot or view all.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, BorderRadius, Shadows, Typography } from '../theme';
import { getBotMessages } from '../services/api';

const BOT_META = {
  daybot:     { label: 'DayBot',     emoji: '☀️', color: '#FF9800' },
  moneybot:   { label: 'MoneyBot',   emoji: '💰', color: '#4CAF50' },
  contentbot: { label: 'ContentBot', emoji: '✍️', color: '#2196F3' },
  coachbot:   { label: 'CoachBot',   emoji: '🏋️', color: '#9C27B0' },
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
    <View style={[styles.messageCard, { borderLeftColor: meta.color }]}>
      <View style={styles.messageHeader}>
        <Text style={styles.botEmoji}>{meta.emoji}</Text>
        <Text style={[styles.botName, { color: meta.color }]}>{meta.label}</Text>
        <Text style={styles.messageTime}>{formatTimestamp(item.date)}</Text>
      </View>
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
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
      } else if (data && data._cached) {
        setCached(true);
      } else {
        setMessages([]);
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
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => loadMessages(), 60000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  const filtered = filter === 'all'
    ? messages
    : messages.filter(m => m.bot === filter);

  // Count per bot for badges
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
          <Text style={styles.offlineText}>📡 Offline — showing cached messages</Text>
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
              <Text style={[
                styles.filterChipText,
                isActive && styles.filterChipTextActive,
              ]}>
                {f === 'all' ? '📋 All' : `${meta.emoji} ${meta.label}`}
                {count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Error state */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity onPress={() => loadMessages()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages list */}
      {filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🤖</Text>
          <Text style={styles.emptyTitle}>No bot messages yet</Text>
          <Text style={styles.emptySubtitle}>
            Messages from DayBot, MoneyBot, ContentBot and CoachBot will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.bot}-${item.messageId || index}`}
          renderItem={({ item }) => <MessageCard item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadMessages(true)}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
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
    ...Typography.caption,
    marginTop: Spacing.md,
  },

  // Offline banner
  offlineBanner: {
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warningBorder,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  offlineText: {
    ...Typography.caption,
    color: Colors.warning,
    textAlign: 'center',
    fontWeight: '600',
  },

  // Filter row
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

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.errorBg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.errorBorder,
  },
  errorText: {
    ...Typography.caption,
    color: Colors.error,
    fontWeight: '600',
  },
  retryText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },

  // Message card
  messageCard: {
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    ...Shadows.card,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  botEmoji: {
    fontSize: 18,
    marginRight: Spacing.xs,
  },
  botName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  messageTime: {
    ...Typography.small,
    color: Colors.textLight,
  },
  messageText: {
    ...Typography.body,
    lineHeight: 22,
  },

  // List
  listContent: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxxl,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.caption,
    textAlign: 'center',
    lineHeight: 20,
  },
});
