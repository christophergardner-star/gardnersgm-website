/**
 * GGM Field App — Location Service
 * Captures GPS coordinates at key job workflow moments:
 *   - En Route (leaving for job)
 *   - Start Job (arrived on site)
 *   - Complete Job (finished)
 *
 * Uses expo-location for one-shot position fixes.
 */

import * as Location from 'expo-location';
import { Alert } from 'react-native';

let permissionGranted = null;

/**
 * Request location permission if not already granted.
 * Returns true if permission is available.
 */
export async function ensureLocationPermission() {
  if (permissionGranted === true) return true;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    permissionGranted = status === 'granted';

    if (!permissionGranted) {
      Alert.alert(
        'Location Permission',
        'Location access helps track job positions for route planning and time sheets. ' +
        'You can enable it in your device settings.',
      );
    }

    return permissionGranted;
  } catch (error) {
    console.warn('Location permission request failed:', error.message);
    return false;
  }
}

/**
 * Get current position as { latitude, longitude, accuracy }.
 * Returns null if permission denied or location unavailable.
 * Uses balanced accuracy to save battery.
 */
export async function getCurrentPosition() {
  const hasPermission = await ensureLocationPermission();
  if (!hasPermission) return null;

  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeout: 10000,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: Math.round(location.coords.accuracy),
      timestamp: new Date(location.timestamp).toISOString(),
    };
  } catch (error) {
    console.warn('Failed to get location:', error.message);
    return null;
  }
}

/**
 * Capture location for a specific job action and return it
 * as a flat object ready to merge into an API payload.
 */
export async function captureJobLocation(action) {
  const pos = await getCurrentPosition();
  if (!pos) return {};

  return {
    [`${action}_lat`]: pos.latitude,
    [`${action}_lng`]: pos.longitude,
    [`${action}_accuracy`]: pos.accuracy,
    [`${action}_location_time`]: pos.timestamp,
  };
}

/**
 * Calculate straight-line distance between two points in km.
 * Uses Haversine formula.
 */
export function distanceBetween(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}
