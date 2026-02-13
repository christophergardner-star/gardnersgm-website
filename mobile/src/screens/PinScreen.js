/**
 * PIN Screen — Simple daily authentication
 * Styled like the email header gradient.
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Vibration, Animated, ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Colors, Spacing, BorderRadius } from '../theme';
import { apiPost } from '../services/api';

const LOCAL_PIN_KEY = 'ggm_pin_hash';

export default function PinScreen({ onSuccess }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [shake] = useState(new Animated.Value(0));

  async function verifyPin(enteredPin) {
    setVerifying(true);
    try {
      // Try server validation first
      const result = await apiPost({
        action: 'validate_mobile_pin',
        pin: enteredPin,
        node_id: 'mobile-field',
      });
      if (result.status === 'success' && result.valid) {
        // Cache the valid PIN locally for offline use
        await SecureStore.setItemAsync(LOCAL_PIN_KEY, enteredPin);
        onSuccess();
        return;
      }
      return false; // Invalid PIN
    } catch (err) {
      // Server unavailable — fall back to locally cached PIN
      const cachedPin = await SecureStore.getItemAsync(LOCAL_PIN_KEY);
      if (cachedPin && cachedPin === enteredPin) {
        onSuccess();
        return;
      }
      // No cached PIN and server offline — accept default
      if (!cachedPin && enteredPin === '1234') {
        onSuccess();
        return;
      }
      return false;
    } finally {
      setVerifying(false);
    }
  }

  function handlePress(digit) {
    if (pin.length >= 4 || verifying) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError(false);

    if (newPin.length === 4) {
      verifyPin(newPin).then((result) => {
        if (result === false) {
          setError(true);
          Vibration.vibrate(200);
          // Shake animation
          Animated.sequence([
            Animated.timing(shake, { toValue: 10, duration: 50, useNativeDriver: true }),
            Animated.timing(shake, { toValue: -10, duration: 50, useNativeDriver: true }),
            Animated.timing(shake, { toValue: 10, duration: 50, useNativeDriver: true }),
            Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
          ]).start();
          setTimeout(() => { setPin(''); setError(false); }, 800);
        }
      });
    }
  }

  function handleDelete() {
    setPin(pin.slice(0, -1));
    setError(false);
  }

  const dots = [0, 1, 2, 3].map(i => (
    <View
      key={i}
      style={[
        styles.dot,
        i < pin.length && styles.dotFilled,
        error && styles.dotError,
      ]}
    />
  ));

  const numpad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '⌫'],
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>🌿</Text>
        <Text style={styles.title}>GGM Field</Text>
        <Text style={styles.subtitle}>Gardners Ground Maintenance</Text>
      </View>

      {/* PIN dots */}
      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shake }] }]}>
        {dots}
      </Animated.View>

      {error && <Text style={styles.errorText}>Incorrect PIN</Text>}
      {verifying && (
        <View style={styles.verifyingRow}>
          <ActivityIndicator size="small" color={Colors.textWhite} />
          <Text style={styles.verifyingText}>Verifying...</Text>
        </View>
      )}

      {/* Numpad */}
      <View style={styles.numpad}>
        {numpad.map((row, ri) => (
          <View key={ri} style={styles.numRow}>
            {row.map((digit, di) => {
              if (digit === '') return <View key={di} style={styles.numBtn} />;
              if (digit === '⌫') {
                return (
                  <TouchableOpacity
                    key={di}
                    style={styles.numBtn}
                    onPress={handleDelete}
                  >
                    <Text style={styles.numText}>⌫</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={di}
                  style={styles.numBtn}
                  onPress={() => handlePress(digit)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.numText}>{digit}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Professional Garden Care in Cornwall</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.textWhite,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 10,
  },
  dotFilled: {
    backgroundColor: Colors.textWhite,
    borderColor: Colors.textWhite,
  },
  dotError: {
    backgroundColor: '#ff6b6b',
    borderColor: '#ff6b6b',
  },
  errorText: {
    color: '#ffcdd2',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 20,
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  verifyingText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  numpad: {
    width: 280,
    marginTop: 20,
  },
  numRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  numBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  numText: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.textWhite,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  footerText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
});
