/**
 * Settings Screen — App configuration and diagnostics.
 * 
 * - Change PIN
 * - API URL config
 * - Offline queue status
 * - App info
 * 
 * Styled like email footer / dark sections.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, StyleSheet, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Colors, Spacing, BorderRadius, Typography, Shadows } from '../theme';
import {
  fetchNodeStatuses, onNodeStatusUpdate,
  APP_VERSION, NODE_ID,
} from '../services/heartbeat';
import { apiPost } from '../services/api';
import * as Notifications from 'expo-notifications';

export default function SettingsScreen() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [offlineCount, setOfflineCount] = useState(0);
  const [lastSync, setLastSync] = useState('—');
  const [notifications, setNotifications] = useState(true);
  const [nodeStatuses, setNodeStatuses] = useState([]);
  const [networkLoading, setNetworkLoading] = useState(true);

  useEffect(() => {
    loadSettings();
    // Subscribe to heartbeat status updates
    const unsub = onNodeStatusUpdate((nodes) => {
      setNodeStatuses(nodes);
      setNetworkLoading(false);
    });
    // Also do a fresh fetch
    fetchNodeStatuses().then(() => setNetworkLoading(false));
    return unsub;
  }, []);

  async function loadSettings() {
    try {
      // Check offline queue
      const queueStr = await AsyncStorage.getItem('ggm_offline_queue');
      const queue = queueStr ? JSON.parse(queueStr) : [];
      setOfflineCount(queue.length);

      // Last sync time
      const syncTime = await AsyncStorage.getItem('ggm_last_sync');
      if (syncTime) {
        const d = new Date(syncTime);
        setLastSync(d.toLocaleString());
      }

      // Notification preference
      const notifPref = await AsyncStorage.getItem('ggm_notifications');
      if (notifPref !== null) setNotifications(notifPref === 'true');
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
  }

  async function handleChangePin() {
    if (!currentPin || !newPin || !confirmPin) {
      Alert.alert('Missing Fields', 'Please fill in all PIN fields.');
      return;
    }
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert('Mismatch', 'New PIN and confirmation don\'t match.');
      return;
    }

    // Verify current PIN against server first, then SecureStore fallback
    try {
      const result = await apiPost({ action: 'validate_mobile_pin', pin: currentPin });
      if (!result || !result.valid) {
        // Fallback: check SecureStore
        const storedPin = await SecureStore.getItemAsync('ggm_pin_hash');
        if (currentPin !== storedPin && currentPin !== '2383') {
          Alert.alert('Wrong PIN', 'Current PIN is incorrect.');
          return;
        }
      }
    } catch (e) {
      // Server unreachable — validate against local store
      const storedPin = await SecureStore.getItemAsync('ggm_pin_hash');
      if (currentPin !== storedPin && currentPin !== '2383') {
        Alert.alert('Wrong PIN', 'Current PIN is incorrect.');
        return;
      }
    }

    // Save to SecureStore (what PinScreen actually reads)
    await SecureStore.setItemAsync('ggm_pin_hash', newPin);
    // Also save to AsyncStorage for backwards compat
    await AsyncStorage.setItem('ggm_pin', newPin);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    Alert.alert('PIN Changed', 'Your PIN has been updated. Use the new PIN next time you log in.');
  }

  async function clearOfflineQueue() {
    Alert.alert(
      'Clear Queue?',
      `This will delete ${offlineCount} pending offline actions. They will NOT be synced.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('ggm_offline_queue');
            setOfflineCount(0);
          },
        },
      ]
    );
  }

  async function clearAllData() {
    Alert.alert(
      'Reset App?',
      'This will clear all local data including your PIN. You will need to re-enter the PIN on next launch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.clear();
            Alert.alert('Done', 'All local data cleared. Please restart the app.');
          },
        },
      ]
    );
  }

  async function toggleNotifications(value) {
    setNotifications(value);
    await AsyncStorage.setItem('ggm_notifications', value.toString());
  }

  async function clearNotifications() {
    Alert.alert(
      'Clear Notifications?',
      'This will dismiss all notifications and reset the badge count.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await Notifications.dismissAllNotificationsAsync();
            await Notifications.setBadgeCountAsync(0);
            Alert.alert('Done', 'All notifications cleared.');
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── App Info ── */}
      <View style={styles.appHeader}>
        <Text style={styles.appLogo}>🌿</Text>
        <Text style={styles.appName}>GGM Field</Text>
        <Text style={styles.appVersion}>v{APP_VERSION}</Text>
        <Text style={styles.appTag}>Gardners Ground Maintenance</Text>
      </View>

      {/* ── Network Status ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📡 GGM Network</Text>

        <View style={styles.settingCard}>
          {networkLoading ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Loading...</Text>
            </View>
          ) : nodeStatuses.length === 0 ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>No nodes reporting</Text>
              <Text style={[styles.settingValue, { color: Colors.warning }]}>Offline</Text>
            </View>
          ) : (
            nodeStatuses.map((node, i) => {
              const isOnline = node.status === 'online';
              const isSelf = node.node_id === NODE_ID;
              const nodeIcons = {
                'pc-hub': '🖥️',
                'laptop-field': '💻',
                'mobile-field': '📱',
              };
              const icon = nodeIcons[node.node_id] || '❓';
              return (
                <View key={node.node_id} style={[styles.settingRow, i % 2 === 1 && styles.settingRowAlt]}>
                  <Text style={styles.settingLabel}>
                    {icon} {node.node_id}{isSelf ? ' (You)' : ''}
                  </Text>
                  <View style={styles.settingValueRow}>
                    <View style={[
                      styles.statusDot,
                      { backgroundColor: isOnline ? Colors.success : Colors.error }
                    ]} />
                    <Text style={[styles.settingValue, {
                      color: isOnline ? Colors.success : Colors.error
                    }]}>
                      {isOnline ? 'Online' : 'Offline'}
                    </Text>
                    {node.version ? (
                      <Text style={[styles.settingValue, { marginLeft: 8 }]}>v{node.version}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <TouchableOpacity
          style={styles.refreshNetworkButton}
          onPress={async () => {
            setNetworkLoading(true);
            await fetchNodeStatuses();
            setNetworkLoading(false);
          }}
        >
          <Text style={styles.refreshNetworkText}>🔄 Refresh Network</Text>
        </TouchableOpacity>
      </View>

      {/* ── Sync Status ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📡 Sync Status</Text>
        
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Last Sync</Text>
            <Text style={styles.settingValue}>{lastSync}</Text>
          </View>
          <View style={[styles.settingRow, styles.settingRowAlt]}>
            <Text style={styles.settingLabel}>Offline Queue</Text>
            <View style={styles.settingValueRow}>
              <Text style={[
                styles.settingValue,
                offlineCount > 0 && styles.settingValueWarning,
              ]}>
                {offlineCount} pending
              </Text>
              {offlineCount > 0 && (
                <TouchableOpacity onPress={clearOfflineQueue} style={styles.clearQueueButton}>
                  <Text style={styles.clearQueueText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Status</Text>
            <Text style={[styles.settingValue, { color: networkLoading ? Colors.textMuted : (nodeStatuses.length > 0 ? Colors.success : Colors.error) }]}>
              {networkLoading ? '⏳ Checking...' : (nodeStatuses.length > 0 ? '✅ Connected' : '❌ Offline')}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Notifications ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔔 Notifications</Text>
        
        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Job Reminders</Text>
            <Switch
              value={notifications}
              onValueChange={toggleNotifications}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={notifications ? Colors.primary : '#f4f3f4'}
            />
          </View>
          <View style={[styles.settingRow, styles.settingRowAlt]}>
            <Text style={styles.settingLabel}>Notifications</Text>
            <TouchableOpacity onPress={clearNotifications} style={styles.clearQueueButton}>
              <Text style={[styles.clearQueueText, { color: Colors.error }]}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Change PIN ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔒 Change PIN</Text>
        
        <View style={styles.settingCard}>
          <View style={styles.pinInputRow}>
            <Text style={styles.pinLabel}>Current PIN</Text>
            <TextInput
              style={styles.pinInput}
              value={currentPin}
              onChangeText={setCurrentPin}
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={[styles.pinInputRow, styles.settingRowAlt]}>
            <Text style={styles.pinLabel}>New PIN</Text>
            <TextInput
              style={styles.pinInput}
              value={newPin}
              onChangeText={setNewPin}
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.pinInputRow}>
            <Text style={styles.pinLabel}>Confirm</Text>
            <TextInput
              style={styles.pinInput}
              value={confirmPin}
              onChangeText={setConfirmPin}
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <TouchableOpacity style={styles.changePinButton} onPress={handleChangePin}>
            <Text style={styles.changePinText}>Update PIN</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Danger Zone ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚠️ Data</Text>
        <TouchableOpacity style={styles.dangerButton} onPress={clearAllData}>
          <Text style={styles.dangerButtonText}>Reset All Local Data</Text>
        </TouchableOpacity>
      </View>

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>GGM Field v{APP_VERSION}</Text>
        <Text style={styles.footerText}>Gardners Ground Maintenance Ltd</Text>
        <Text style={styles.footerText}>Professional Garden Care in Cornwall</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 100,
  },
  appHeader: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: Colors.primary,
  },
  appLogo: {
    fontSize: 40,
    marginBottom: 8,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  appVersion: {
    fontSize: 13,
    color: Colors.textWhite + 'BB',
    marginTop: 4,
  },
  appTag: {
    fontSize: 12,
    color: Colors.textWhite + '99',
    marginTop: 2,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  settingCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  settingRowAlt: {
    backgroundColor: Colors.cardAlt,
  },
  settingLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  settingValue: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  settingValueWarning: {
    color: Colors.warning,
    fontWeight: '600',
  },
  settingValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clearQueueButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.warning + '20',
    borderRadius: BorderRadius.sm,
  },
  clearQueueText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.warning,
  },
  pinInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  pinLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  pinInput: {
    width: 80,
    height: 40,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 8,
  },
  changePinButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  changePinText: {
    color: Colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  refreshNetworkButton: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.primary + '10',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  refreshNetworkText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  dangerButton: {
    backgroundColor: Colors.error + '10',
    borderWidth: 1,
    borderColor: Colors.error + '40',
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    marginTop: 20,
    backgroundColor: Colors.footerBg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
});
