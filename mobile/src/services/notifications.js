/**
 * GGM Field App — Push Notification Service
 * Registers for Expo push notifications and sends token to GAS.
 * Handles incoming notifications and navigation.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost } from './api';

const PUSH_TOKEN_KEY = '@ggm_push_token';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and send token to GAS.
 * Returns the Expo push token string or null.
 */
export async function registerForPushNotifications() {
  // Only real devices can receive push notifications
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  try {
    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }

    // Get the Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'd17fe848-6644-4d9e-8745-895ab41ba6d0', // EAS project UUID from app.json
    });
    const token = tokenData.data;

    // Check if we already registered this token
    const storedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (storedToken !== token) {
      // Register token with GAS backend
      await apiPost({
        action: 'register_push_token',
        token: token,
        platform: Platform.OS,
        device: Device.modelName || 'Unknown',
        node_id: 'mobile-field',
      });
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
      console.log('📱 Push token registered:', token.substring(0, 20) + '...');
    }

    // Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'GGM Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2E7D32',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('jobs', {
        name: 'Job Updates',
        importance: Notifications.AndroidImportance.HIGH,
        description: 'Notifications about job assignments and updates',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('system', {
        name: 'System Alerts',
        importance: Notifications.AndroidImportance.DEFAULT,
        description: 'System health and network notifications',
      });
    }

    return token;
  } catch (error) {
    console.warn('Failed to register for push notifications:', error.message);
    return null;
  }
}

/**
 * Add a listener for received notifications (when app is in foreground)
 */
export function addNotificationReceivedListener(callback) {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Add a listener for notification responses (user tapped a notification)
 */
export function addNotificationResponseListener(callback) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Get the push token from local storage (if already registered)
 */
export async function getStoredPushToken() {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Schedule a local notification (for testing or reminders)
 */
export async function scheduleLocalNotification(title, body, data = {}, seconds = 1) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: { seconds },
  });
}

/**
 * Get the number of unread notifications (badge count)
 */
export async function getBadgeCount() {
  return Notifications.getBadgeCountAsync();
}

/**
 * Clear the badge count
 */
export async function clearBadge() {
  return Notifications.setBadgeCountAsync(0);
}
