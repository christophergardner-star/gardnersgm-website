/**
 * Clients Screen — Client lookup and job history.
 * 
 * Search by name or postcode, view past jobs per client.
 * Styled like email contact confirmation cards.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, RefreshControl, StyleSheet, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, BorderRadius, Typography, Shadows } from '../theme';
import { getClients } from '../services/api';

export default function ClientsScreen({ navigation }) {
  const [clients, setClients] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedClient, setExpandedClient] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadClients();
    }, [])
  );

  async function loadClients() {
    try {
      const data = await getClients();
      console.log('getClients response:', JSON.stringify(data).substring(0, 200));
      if (data && data.status === 'success') {
        // GAS returns all job rows; group by client (name+email)
        const raw = data.clients || [];
        console.log(`Loaded ${raw.length} client rows from API`);
        const clientMap = {};
        raw.forEach(row => {
          const key = (row.email || row.name || '').toLowerCase();
          if (!key) return;
          if (!clientMap[key]) {
            clientMap[key] = {
              ref: row.jobNumber || key,
              clientRef: row.jobNumber || key,
              name: row.name || '',
              email: row.email || '',
              phone: row.phone || '',
              address: row.address || '',
              postcode: row.postcode || '',
              totalRevenue: 0,
              totalJobs: 0,
              recentJobs: [],
            };
          }
          const c = clientMap[key];
          c.totalJobs++;
          c.totalRevenue += parseFloat(row.price || '0') || 0;
          if (!c.phone && row.phone) c.phone = row.phone;
          if (!c.address && row.address) c.address = row.address;
          if (!c.postcode && row.postcode) c.postcode = row.postcode;
          c.recentJobs.push({
            date: row.date || '',
            service: row.service || '',
            price: row.price || '0',
            status: row.status || '',
          });
        });
        // Sort recent jobs by date descending
        const list = Object.values(clientMap).sort((a, b) => b.totalJobs - a.totalJobs);
        list.forEach(c => c.recentJobs.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
        setClients(list);
        filterClients(list, searchQuery);
      }
    } catch (error) {
      console.warn('Failed to load clients:', error.message, error);
      Alert.alert('Connection Issue', 'Could not load clients from server. Pull down to retry.\n\n' + error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function filterClients(list, query) {
    if (!query.trim()) {
      setFiltered(list);
      return;
    }
    const q = query.toLowerCase();
    setFiltered(list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.postcode || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    ));
  }

  function onSearch(text) {
    setSearchQuery(text);
    filterClients(clients, text);
  }

  function toggleExpand(clientRef) {
    setExpandedClient(prev => prev === clientRef ? null : clientRef);
  }

  function renderClient({ item }) {
    const isExpanded = expandedClient === (item.ref || item.clientRef);
    const jobCount = item.jobCount || item.totalJobs || 0;
    const totalSpent = item.totalRevenue || item.totalSpent || 0;

    return (
      <View style={styles.clientCard}>
        <TouchableOpacity
          style={styles.clientHeader}
          onPress={() => toggleExpand(item.ref || item.clientRef)}
          activeOpacity={0.7}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(item.name || 'C').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.clientInfo}>
            <Text style={styles.clientName}>{item.name || 'Unknown'}</Text>
            <Text style={styles.clientAddress} numberOfLines={1}>
              {item.postcode || item.address || '—'}
            </Text>
          </View>
          <View style={styles.clientStats}>
            <Text style={styles.clientJobs}>{jobCount} jobs</Text>
            {totalSpent > 0 && (
              <Text style={styles.clientTotal}>£{parseFloat(totalSpent).toFixed(0)}</Text>
            )}
          </View>
          <Text style={[styles.expandIcon, isExpanded && styles.expandIconOpen]}>›</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedContent}>
            {/* Contact details (like email confirmation table) */}
            <View style={styles.contactSection}>
              <ContactRow icon="📧" label="Email" value={item.email || '—'}
                onPress={() => item.email && Linking.openURL(`mailto:${item.email}`)} />
              <ContactRow icon="📱" label="Phone" value={item.phone || '—'} alt
                onPress={() => item.phone && Linking.openURL(`tel:${item.phone}`)} />
              <ContactRow icon="📍" label="Address" value={item.address || '—'} />
              <ContactRow icon="📮" label="Postcode" value={item.postcode || '—'} alt />
            </View>

            {/* Quick actions */}
            <View style={styles.quickActions}>
              {item.phone && (
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={() => Linking.openURL(`tel:${item.phone}`)}
                >
                  <Text style={styles.quickActionText}>📞 Call</Text>
                </TouchableOpacity>
              )}
              {item.email && (
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={() => Linking.openURL(`mailto:${item.email}`)}
                >
                  <Text style={styles.quickActionText}>📧 Email</Text>
                </TouchableOpacity>
              )}
              {(item.address || item.postcode) && (
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={() => {
                    const addr = encodeURIComponent(item.address || item.postcode);
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${addr}`);
                  }}
                >
                  <Text style={styles.quickActionText}>📍 Directions</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Recent jobs list */}
            {item.recentJobs && item.recentJobs.length > 0 && (
              <View style={styles.recentJobs}>
                <Text style={styles.recentJobsTitle}>Recent Jobs</Text>
                {item.recentJobs.slice(0, 5).map((job, i) => (
                  <View key={i} style={[styles.recentJobRow, i % 2 === 1 && styles.recentJobRowAlt]}>
                    <Text style={styles.recentJobDate}>{job.date || '—'}</Text>
                    <Text style={styles.recentJobService}>{job.service || '—'}</Text>
                    <Text style={styles.recentJobPrice}>£{job.price || '0'}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>👥</Text>
        <Text style={styles.emptyText}>Loading clients...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, postcode, or email..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => onSearch('')} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Count */}
      <View style={styles.resultCount}>
        <Text style={styles.resultCountText}>
          {filtered.length} client{filtered.length !== 1 ? 's' : ''}
          {searchQuery ? ` matching "${searchQuery}"` : ''}
        </Text>
      </View>

      <FlatList
        data={filtered}
        renderItem={renderClient}
        keyExtractor={(item, i) => item.ref || item.clientRef || String(i)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadClients(); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No clients found</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'Try a different search term.' : 'Client data will sync from your bookings.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function ContactRow({ icon, label, value, alt, onPress }) {
  const content = (
    <View style={[styles.contactRow, alt && styles.contactRowAlt]}>
      <Text style={styles.contactIcon}>{icon}</Text>
      <Text style={styles.contactLabel}>{label}</Text>
      <Text style={[styles.contactValue, onPress && styles.contactLink]}>{value}</Text>
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity> : content;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    margin: Spacing.md,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  clearButton: {
    padding: 8,
  },
  clearButtonText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  resultCount: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 8,
  },
  resultCountText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: 100,
  },
  clientCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  clientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.textWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  clientAddress: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  clientStats: {
    alignItems: 'flex-end',
  },
  clientJobs: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  clientTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 2,
  },
  expandIcon: {
    fontSize: 22,
    color: Colors.textMuted,
    transform: [{ rotate: '0deg' }],
  },
  expandIconOpen: {
    transform: [{ rotate: '90deg' }],
  },
  expandedContent: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  contactSection: {
    // rows alternate
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    gap: 8,
  },
  contactRowAlt: {
    backgroundColor: Colors.cardAlt,
  },
  contactIcon: {
    fontSize: 14,
    width: 22,
  },
  contactLabel: {
    width: 65,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  contactValue: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  contactLink: {
    color: Colors.accentBlue,
    textDecorationLine: 'underline',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  quickActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  recentJobs: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: 12,
  },
  recentJobsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  recentJobRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 8,
  },
  recentJobRowAlt: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 4,
  },
  recentJobDate: {
    width: 80,
    fontSize: 12,
    color: Colors.textMuted,
  },
  recentJobService: {
    flex: 1,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  recentJobPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
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
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
