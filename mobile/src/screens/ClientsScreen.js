/**
 * Clients Screen — Client directory with search and navigation to detail.
 * GGM Field v3.0
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { getClients } from '../services/api';
import GGMCard from '../components/GGMCard';
import EmptyState from '../components/EmptyState';
import LoadingOverlay from '../components/LoadingOverlay';

export default function ClientsScreen({ navigation }) {
  const [clients, setClients] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadClients();
    }, [])
  );

  async function loadClients() {
    try {
      const data = await getClients();
      if (data && data.status === 'success') {
        const raw = data.clients || [];
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
        const list = Object.values(clientMap).sort((a, b) => b.totalJobs - a.totalJobs);
        list.forEach(c => c.recentJobs.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
        setClients(list);
        filterClients(list, searchQuery);
      }
    } catch (error) {
      console.warn('Failed to load clients:', error.message);
      Alert.alert('Connection Issue', 'Could not load clients. Pull down to retry.');
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

  function renderClient({ item }) {
    const jobCount = item.jobCount || item.totalJobs || 0;
    const totalSpent = item.totalRevenue || item.totalSpent || 0;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ClientDetail', { client: item })}
      >
        <GGMCard style={{ marginBottom: Spacing.sm }}>
          <View style={styles.clientRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.name || 'C').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{item.name || 'Unknown'}</Text>
              <View style={styles.clientMeta}>
                <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.clientAddress} numberOfLines={1}>
                  {item.postcode || item.address || '\u2014'}
                </Text>
              </View>
            </View>
            <View style={styles.clientStats}>
              <Text style={styles.clientJobs}>{jobCount} jobs</Text>
              {totalSpent > 0 && (
                <Text style={styles.clientTotal}>{'\u00A3'}{parseFloat(totalSpent).toFixed(0)}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </View>
        </GGMCard>
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingOverlay message="Loading clients..." />;

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
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
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
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
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadClients(); }}
            colors={[Colors.primary]} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No clients found"
            subtitle={searchQuery ? 'Try a different search term.' : 'Client data will sync from your bookings.'}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    margin: Spacing.md,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    ...Shadows.card,
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
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.textWhite,
    fontSize: 17,
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
  clientMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  clientAddress: {
    fontSize: 12,
    color: Colors.textMuted,
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
});
