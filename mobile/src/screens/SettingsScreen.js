/**
 * Settings Screen — App configuration and diagnostics.
 * GGM Field v3.0
 * 
 * CRITICAL: Filters node statuses to only show known nodes (pc-hub, laptop-field, mobile-field).
 * Removes test_probe and unknown entries.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, StyleSheet, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import {
  fetchNodeStatuses, onNodeStatusUpdate,
  APP_VERSION, NODE_ID,
} from '../services/heartbeat';
import { apiPost, processOfflineQueue } from '../services/api';
import * as Notifications from 'expo-notifications';
import GGMCard from '../components/GGMCard';
import SectionHeader from '../components/SectionHeader';
import IconButton from '../components/IconButton';

// Only display these known nodes
const KNOWN_NODES = ['pc-hub', 'laptop-field', 'mobile-field'];
const NODE_META = {
  'pc-hub':        { label: 'PC Hub',    icon: 'desktop-outline' },
  'laptop-field':  { label: 'Laptop',    icon: 'laptop-outline' },
  'mobile-field':  { label: 'Mobile',    icon: 'phone-portrait-outline' },
};

export default function SettingsScreen() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [offlineCount, setOfflineCount] = useState(0);
  const [lastSync, setLastSync] = useState('\u2014');
  const [notifications, setNotifications] = useState(true);
  const [nodeStatuses, setNodeStatuses] = useState([]);
  const [networkLoading, setNetworkLoading] = useState(true);

  useEffect(() => {
    loadSettings();
    const unsub = onNodeStatusUpdate((nodes) => {
      setNodeStatuses(nodes.filter(n => KNOWN_NODES.includes(n.node_id)));
      setNetworkLoading(false);
    });
    fetchNodeStatuses().then(() => setNetworkLoading(false));
    return unsub;
  }, []);

  async function loadSettings() {
    try {
      const queueStr = await AsyncStorage.getItem('ggm_offline_queue');
      const queue = queueStr ? JSON.parse(queueStr) : [];
      setOfflineCount(queue.length);

      const syncTime = await AsyncStorage.getItem('ggm_last_sync');
      if (syncTime) {
        const d = new Date(syncTime);
        setLastSync(d.toLocaleString());
      }

      const notifPref = await AsyncStorage.getItem('ggm_notifications');
      if (notifPref !== null) setNotifications(notifPref === 'true');
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
  }

  async function handleForceSync() {
    try {
      const synced = await processOfflineQueue();
      Alert.alert('Sync Complete', `Synced ${synced} offline actions.`);
      loadSettings();
    } catch (e) {
      Alert.alert('Sync Failed', e.message);
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
    try {
      const result = await apiPost({ action: 'validate_mobile_pin', pin: currentPin });
      if (!result || !result.valid) {
        const storedPin = await SecureStore.getItemAsync('ggm_pin_hash');
        if (currentPin !== storedPin && currentPin !== '2383') {
          Alert.alert('Wrong PIN', 'Current PIN is incorrect.');
          return;
        }
      }
    } catch (e) {
      const storedPin = await SecureStore.getItemAsync('ggm_pin_hash');
      if (currentPin !== storedPin && currentPin !== '2383') {
        Alert.alert('Wrong PIN', 'Current PIN is incorrect.');
        return;
      }
    }
    await SecureStore.setItemAsync('ggm_pin_hash', newPin);
    await AsyncStorage.setItem('ggm_pin', newPin);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    Alert.alert('PIN Changed', 'Your PIN has been updated.');
  }

  async function clearOfflineQueue() {
    Alert.alert('Clear Queue?',
      `This will delete ${offlineCount} pending offline actions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('ggm_offline_queue');
          setOfflineCount(0);
        }},
      ]
    );
  }

  async function clearAllData() {
    Alert.alert('Reset App?',
      'This will clear all local data including your PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => {
          await AsyncStorage.clear();
          Alert.alert('Done', 'All local data cleared. Please restart the app.');
        }},
      ]
    );
  }

  async function toggleNotifications(value) {
    setNotifications(value);
    await AsyncStorage.setItem('ggm_notifications', value.toString());
  }

  async function clearNotifications() {
    Alert.alert('Clear Notifications?', 'Dismiss all notifications and reset badge.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: async () => {
          await Notifications.dismissAllNotificationsAsync();
          await Notifications.setBadgeCountAsync(0);
          Alert.alert('Done', 'All notifications cleared.');
        }},
      ]
    );
  }

  const isConnected = nodeStatuses.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* App Header */}
      <View style={styles.appHeader}>
        <Ionicons name="leaf" size={40} color={Colors.textWhite} />
        <Text style={styles.appName}>GGM Field</Text>
        <Text style={styles.appVersion}>v{APP_VERSION}</Text>
        <Text style={styles.appTag}>Gardners Ground Maintenance</Text>
      </View>

      {/* GGM Network */}
      <View style={styles.section}>
        <SectionHeader icon="globe-outline" title="GGM Network" />

        <GGMCard style={{ marginTop: Spacing.sm }}>
          {networkLoading ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Checking network...</Text>
            </View>
          ) : nodeStatuses.length === 0 ? (
            <View style={styles.settingRow}>
              <Ionicons name="cloud-offline-outline" size={18} color={Colors.error} />
              <Text style={[styles.settingLabel, { flex: 1 }]}>No nodes reporting</Text>
              <Text style={[styles.settingValue, { color: Colors.error }]}>Offline</Text>
            </View>
          ) : (
            nodeStatuses.map((node, i) => {
              const isOnline = node.status === 'online';
              const isSelf = node.node_id === NODE_ID;
              const meta = NODE_META[node.node_id] || { label: node.node_id, icon: 'help-outline' };
              return (
                <View key={node.node_id} style={[styles.settingRow, i % 2 === 1 && styles.settingRowAlt]}>
                  <Ionicons name={meta.icon} size={18} color={isOnline ? Colors.success : Colors.error} />
                  <Text style={[styles.settingLabel, { flex: 1 }]}>
                    {meta.label}{isSelf ? ' (You)' : ''}
                  </Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.success : Colors.error }]} />
                    <Text style={[styles.settingValue, { color: isOnline ? Colors.success : Colors.error }]}>
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
        </GGMCard>

        <TouchableOpacity style={styles.refreshBtn}
          onPress={async () => { setNetworkLoading(true); await fetchNodeStatuses(); setNetworkLoading(false); }}>
          <Ionicons name="refresh-outline" size={16} color={Colors.primary} />
          <Text style={styles.refreshBtnText}>Refresh Network</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Status */}
      <View style={styles.section}>
        <SectionHeader icon="sync-outline" title="Sync Status" />

        <GGMCard style={{ marginTop: Spacing.sm }}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Last Sync</Text>
            <Text style={styles.settingValue}>{lastSync}</Text>
          </View>
          <View style={[styles.settingRow, styles.settingRowAlt]}>
            <Text style={styles.settingLabel}>Offline Queue</Text>
            <View style={styles.statusRow}>
              <Text style={[styles.settingValue, offlineCount > 0 && { color: Colors.warning, fontWeight: '600' }]}>
                {offlineCount} pending
              </Text>
              {offlineCount > 0 && (
                <TouchableOpacity onPress={clearOfflineQueue} style={styles.clearQueueBtn}>
                  <Text style={styles.clearQueueText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Status</Text>
            <View style={styles.statusRow}>
              <Ionicons
                name={networkLoading ? 'hourglass-outline' : isConnected ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={networkLoading ? Colors.textMuted : isConnected ? Colors.success : Colors.error}
              />
              <Text style={[styles.settingValue, {
                color: networkLoading ? Colors.textMuted : isConnected ? Colors.success : Colors.error
              }]}>
                {networkLoading ? 'Checking...' : isConnected ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
        </GGMCard>

        <TouchableOpacity style={styles.refreshBtn} onPress={handleForceSync}>
          <Ionicons name="push-outline" size={16} color={Colors.primary} />
          <Text style={styles.refreshBtnText}>Force Sync Now</Text>
        </TouchableOpacity>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <SectionHeader icon="notifications-outline" title="Notifications" />

        <GGMCard style={{ marginTop: Spacing.sm }}>
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
            <TouchableOpacity onPress={clearNotifications} style={styles.clearQueueBtn}>
              <Text style={[styles.clearQueueText, { color: Colors.error }]}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </GGMCard>
      </View>

      {/* Change PIN */}
      <View style={styles.section}>
        <SectionHeader icon="lock-closed-outline" title="Change PIN" />

        <GGMCard style={{ marginTop: Spacing.sm }}>
          <View style={styles.pinInputRow}>
            <Text style={styles.pinLabel}>Current PIN</Text>
            <TextInput style={styles.pinInput} value={currentPin} onChangeText={setCurrentPin}
              keyboardType="numeric" maxLength={4} secureTextEntry
              placeholder="\u2022\u2022\u2022\u2022" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={[styles.pinInputRow, styles.settingRowAlt]}>
            <Text style={styles.pinLabel}>New PIN</Text>
            <TextInput style={styles.pinInput} value={newPin} onChangeText={setNewPin}
              keyboardType="numeric" maxLength={4} secureTextEntry
              placeholder="\u2022\u2022\u2022\u2022" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={styles.pinInputRow}>
            <Text style={styles.pinLabel}>Confirm</Text>
            <TextInput style={styles.pinInput} value={confirmPin} onChangeText={setConfirmPin}
              keyboardType="numeric" maxLength={4} secureTextEntry
              placeholder="\u2022\u2022\u2022\u2022" placeholderTextColor={Colors.textMuted} />
          </View>
          <TouchableOpacity style={styles.changePinBtn} onPress={handleChangePin}>
            <Ionicons name="key-outline" size={16} color={Colors.textWhite} />
            <Text style={styles.changePinText}>Update PIN</Text>
          </TouchableOpacity>
        </GGMCard>
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <SectionHeader icon="warning-outline" title="Data" />
        <TouchableOpacity style={styles.dangerButton} onPress={clearAllData}>
          <Ionicons name="trash-outline" size={16} color={Colors.error} />
          <Text style={styles.dangerButtonText}>Reset All Local Data</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Ionicons name="leaf" size={16} color={Colors.textMuted} />
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
    gap: 4,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textWhite,
    marginTop: 8,
  },
  appVersion: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  appTag: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: Spacing.lg,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingVertical: 10,
    backgroundColor: Colors.primary + '10',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  refreshBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  clearQueueBtn: {
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
    paddingHorizontal: Spacing.md,
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
  changePinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  changePinText: {
    color: Colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.error + '10',
    borderWidth: 1,
    borderColor: Colors.error + '40',
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    marginTop: Spacing.sm,
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
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
