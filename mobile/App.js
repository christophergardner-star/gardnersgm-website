/**
 * GGM Field App — Main Entry Point
 * Gardners Ground Maintenance field companion app.
 * 
 * Styled to match the company email templates:
 * Green gradient headers, white card backgrounds, clean layout.
 * 
 * Sideloaded via USB — no OTA updates.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors } from './src/theme';
import { startHeartbeat } from './src/services/heartbeat';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
  clearBadge,
} from './src/services/notifications';
import PinScreen from './src/screens/PinScreen';
import TodayScreen from './src/screens/TodayScreen';
import JobDetailScreen from './src/screens/JobDetailScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import BotsScreen from './src/screens/BotsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const PIN_KEY = '@ggm_pin_verified';
const navigationRef = createNavigationContainerRef();

function TabIcon({ name, focused }) {
  const icons = {
    Today: focused ? '☀️' : '🌤️',
    Schedule: focused ? '📅' : '🗓️',
    Clients: focused ? '👥' : '👤',
    Bots: focused ? '🤖' : '🔌',
    Settings: focused ? '⚙️' : '🔧',
  };
  return <Text style={{ fontSize: 22 }}>{icons[name] || '📋'}</Text>;
}

function TodayStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textWhite,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="TodayList"
        component={TodayScreen}
        options={{ title: "🌿 Today's Jobs" }}
      />
      <Stack.Screen
        name="JobDetail"
        component={JobDetailScreen}
        options={({ route }) => ({
          title: route.params?.jobRef || 'Job Details',
        })}
      />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textWhite,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerShadowVisible: false,
      })}
    >
      <Tab.Screen
        name="Today"
        component={TodayStack}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{ title: '📅 Schedule' }}
      />
      <Tab.Screen
        name="Clients"
        component={ClientsScreen}
        options={{ title: '👥 Clients' }}
      />
      <Tab.Screen
        name="Bots"
        component={BotsScreen}
        options={{ title: '🤖 Bots' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: '⚙️ Settings' }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const verified = await AsyncStorage.getItem(PIN_KEY);
      const today = new Date().toISOString().substring(0, 10);
      // PIN is valid for the day
      if (verified === today) {
        setAuthenticated(true);
      }
    } catch (e) {
      // Not authenticated
    }
    setLoading(false);
  }

  // Start heartbeat + push notifications once authenticated
  useEffect(() => {
    if (authenticated) {
      const heartbeatCleanup = startHeartbeat();
      registerForPushNotifications();
      clearBadge();

      // Handle notification taps (e.g. navigate to a job)
      const responseSubscription = addNotificationResponseListener((response) => {
        const data = response.notification.request.content.data;
        if (data?.screen === 'JobDetail' && data?.jobRef && navigationRef.isReady()) {
          navigationRef.navigate('Today', {
            screen: 'JobDetail',
            params: { jobRef: data.jobRef, job: data.job },
          });
        }
      });

      return () => {
        heartbeatCleanup?.();
        responseSubscription.remove();
      };
    }
  }, [authenticated]);

  async function onPinSuccess() {
    const today = new Date().toISOString().substring(0, 10);
    await AsyncStorage.setItem(PIN_KEY, today);
    setAuthenticated(true);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>🌿 GGM Field</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!authenticated) {
    return (
      <>
        <PinScreen onSuccess={onPinSuccess} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <MainTabs />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
});
