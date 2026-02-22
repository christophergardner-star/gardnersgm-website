/**
 * GGM Field App v3.0 — Main Entry Point
 * Gardners Ground Maintenance — Professional Field Operations
 * 
 * 4-tab layout: Today / Schedule / Clients / More
 * Ionicons throughout — no emoji in navigation.
 */

import React, { useEffect, useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, ActivityIndicator, StyleSheet, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from './src/theme';
import { startHeartbeat } from './src/services/heartbeat';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
  clearBadge,
} from './src/services/notifications';

// Screens
import PinScreen from './src/screens/PinScreen';
import TodayScreen from './src/screens/TodayScreen';
import JobDetailScreen from './src/screens/JobDetailScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import ClientDetailScreen from './src/screens/ClientDetailScreen';
import MoreScreen from './src/screens/MoreScreen';
import BotsScreen from './src/screens/BotsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import RiskAssessmentScreen from './src/screens/RiskAssessmentScreen';
import SignatureScreen from './src/screens/SignatureScreen';
import WeatherScreen from './src/screens/WeatherScreen';
import QuoteScreen from './src/screens/QuoteScreen';
import ExpensesScreen from './src/screens/ExpensesScreen';
import NotesScreen from './src/screens/NotesScreen';
import RouteScreen from './src/screens/RouteScreen';

const Tab = createBottomTabNavigator();
const TodayStack = createNativeStackNavigator();
const ScheduleStack = createNativeStackNavigator();
const ClientsStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

const PIN_KEY = '@ggm_pin_verified';
const navigationRef = createNavigationContainerRef();

const STACK_HEADER = {
  headerStyle: { backgroundColor: Colors.primary },
  headerTintColor: Colors.textWhite,
  headerTitleStyle: { fontWeight: '700', fontSize: 17 },
  headerShadowVisible: false,
};

// ─── Tab Stacks ───

function TodayStackScreen() {
  return (
    <TodayStack.Navigator screenOptions={STACK_HEADER}>
      <TodayStack.Screen name="TodayList" component={TodayScreen} options={{ title: "Today's Jobs" }} />
      <TodayStack.Screen name="JobDetail" component={JobDetailScreen} options={({ route }) => ({ title: route.params?.jobRef || 'Job Details' })} />
      <TodayStack.Screen name="RiskAssessment" component={RiskAssessmentScreen} options={{ title: 'Risk Assessment' }} />
      <TodayStack.Screen name="Signature" component={SignatureScreen} options={{ title: 'Client Sign-Off' }} />
    </TodayStack.Navigator>
  );
}

function ScheduleStackScreen() {
  return (
    <ScheduleStack.Navigator screenOptions={STACK_HEADER}>
      <ScheduleStack.Screen name="ScheduleList" component={ScheduleScreen} options={{ title: 'Schedule' }} />
      <ScheduleStack.Screen name="JobDetail" component={JobDetailScreen} options={({ route }) => ({ title: route.params?.jobRef || 'Job Details' })} />
      <ScheduleStack.Screen name="RiskAssessment" component={RiskAssessmentScreen} options={{ title: 'Risk Assessment' }} />
      <ScheduleStack.Screen name="Signature" component={SignatureScreen} options={{ title: 'Client Sign-Off' }} />
      <ScheduleStack.Screen name="Route" component={RouteScreen} options={{ title: 'Route Planner' }} />
    </ScheduleStack.Navigator>
  );
}

function ClientsStackScreen() {
  return (
    <ClientsStack.Navigator screenOptions={STACK_HEADER}>
      <ClientsStack.Screen name="ClientsList" component={ClientsScreen} options={{ title: 'Clients' }} />
      <ClientsStack.Screen name="ClientDetail" component={ClientDetailScreen} options={({ route }) => ({ title: route.params?.clientName || 'Client' })} />
      <ClientsStack.Screen name="Quote" component={QuoteScreen} options={{ title: 'New Quote' }} />
    </ClientsStack.Navigator>
  );
}

function MoreStackScreen() {
  return (
    <MoreStack.Navigator screenOptions={STACK_HEADER}>
      <MoreStack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="Weather" component={WeatherScreen} options={{ title: 'Weather' }} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} options={{ title: 'Expenses' }} />
      <MoreStack.Screen name="Notes" component={NotesScreen} options={{ title: 'Field Notes' }} />
      <MoreStack.Screen name="Bots" component={BotsScreen} options={{ title: 'Bot Activity' }} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <MoreStack.Screen name="Route" component={RouteScreen} options={{ title: 'Route Planner' }} />
      <MoreStack.Screen name="Quote" component={QuoteScreen} options={{ title: 'New Quote' }} />
    </MoreStack.Navigator>
  );
}

// ─── Tab Icons ───

const TAB_ICONS = {
  Today:    { focused: 'today',          unfocused: 'today-outline' },
  Schedule: { focused: 'calendar',       unfocused: 'calendar-outline' },
  Clients:  { focused: 'people',         unfocused: 'people-outline' },
  More:     { focused: 'grid',           unfocused: 'grid-outline' },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const iconSet = TAB_ICONS[route.name] || TAB_ICONS.More;
          return <Ionicons name={focused ? iconSet.focused : iconSet.unfocused} size={22} color={color} />;
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.borderLight,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Today" component={TodayStackScreen} />
      <Tab.Screen name="Schedule" component={ScheduleStackScreen} />
      <Tab.Screen name="Clients" component={ClientsStackScreen} />
      <Tab.Screen name="More" component={MoreStackScreen} />
    </Tab.Navigator>
  );
}

// ─── App Root ───

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
        <Ionicons name="leaf" size={48} color={Colors.textWhite} style={{ marginBottom: 12 }} />
        <ActivityIndicator size="large" color={Colors.textWhite} />
        <Text style={styles.loadingText}>GGM Field</Text>
        <Text style={styles.loadingVersion}>v3.1.0</Text>
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
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
  },
  loadingVersion: {
    color: Colors.textWhite + 'aa',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
});
