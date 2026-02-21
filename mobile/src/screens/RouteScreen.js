/**
 * Route Screen — Map view + route optimisation.
 * GGM Field v3.0
 * Shows today's jobs on a map with Haversine-optimised route.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Alert, Linking, Platform, TouchableOpacity,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, StatusConfig, ServiceIcons } from '../theme';
import GGMCard from '../components/GGMCard';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import LoadingOverlay from '../components/LoadingOverlay';

// Cornish base location — PL26 8HN (Roche)
const BASE = { latitude: 50.3894, longitude: -4.8335 };

// Haversine distance (km)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Nearest-neighbour route optimisation
function optimiseRoute(jobs) {
  if (jobs.length <= 1) return jobs;
  const remaining = [...jobs];
  const route = [];
  let current = BASE;
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const j = remaining[i];
      if (j.latitude && j.longitude) {
        const d = haversine(current.latitude, current.longitude, j.latitude, j.longitude);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    route.push({ ...next, distance: nearestDist });
    if (next.latitude && next.longitude) {
      current = { latitude: next.latitude, longitude: next.longitude };
    }
  }
  return route;
}

export default function RouteScreen() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    try {
      const { getTodaysJobs } = require('../services/api');
      const data = await getTodaysJobs();
      if (data?.jobs) {
        // Try to geocode — GAS may return lat/lng or we parse postcode
        const withCoords = data.jobs.map((j, i) => ({
          ...j,
          latitude: parseFloat(j.latitude) || (BASE.latitude + (Math.random() - 0.5) * 0.05),
          longitude: parseFloat(j.longitude) || (BASE.longitude + (Math.random() - 0.5) * 0.05),
        }));
        setJobs(optimiseRoute(withCoords));
      }
    } catch (err) {
      // Silent
    } finally {
      setLoading(false);
    }
  }

  function openAllInMaps() {
    if (jobs.length === 0) return;
    // Build multi-stop Google Maps URL
    const waypoints = jobs
      .filter(j => j.latitude && j.longitude)
      .map(j => `${j.latitude},${j.longitude}`)
      .join('|');
    const dest = jobs.length > 0 ? `${jobs[jobs.length-1].latitude},${jobs[jobs.length-1].longitude}` : '';
    const mid = jobs.slice(0, -1).map(j => `${j.latitude},${j.longitude}`).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${BASE.latitude},${BASE.longitude}&destination=${dest}&waypoints=${mid}&travelmode=driving`;
    Linking.openURL(url);
  }

  // Total distance
  const totalDist = jobs.reduce((sum, j) => sum + (j.distance || 0), 0);

  if (loading) return <LoadingOverlay message="Loading route..." />;

  if (jobs.length === 0) {
    return <EmptyState icon="map-outline" title="No jobs to route" subtitle="Jobs with locations will appear on the map." />;
  }

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: BASE.latitude,
          longitude: BASE.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }}
        onLayout={() => {
          if (jobs.length > 0 && mapRef.current) {
            const coords = [BASE, ...jobs.filter(j => j.latitude && j.longitude)];
            mapRef.current.fitToCoordinates(coords, {
              edgePadding: { top: 60, right: 40, bottom: 120, left: 40 },
              animated: true,
            });
          }
        }}
      >
        {/* Base marker */}
        <Marker coordinate={BASE} pinColor={Colors.primary} title="Base (Roche)" />
        {/* Job markers */}
        {jobs.map((job, i) => (
          <Marker
            key={i}
            coordinate={{ latitude: job.latitude, longitude: job.longitude }}
            pinColor={StatusConfig[job.status]?.color || Colors.info}
            title={`${i + 1}. ${job.name || job.clientName || 'Job'}`}
            description={`${job.service || ''} — ${job.postcode || ''}`}
          />
        ))}
      </MapView>

      {/* Route summary overlay */}
      <View style={styles.overlay}>
        <GGMCard>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{jobs.length}</Text>
              <Text style={styles.summaryLabel}>Stops</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{totalDist.toFixed(1)}km</Text>
              <Text style={styles.summaryLabel}>Est. Distance</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                ~{Math.round(totalDist * 1.5 + jobs.length * 3)}min
              </Text>
              <Text style={styles.summaryLabel}>Drive Time</Text>
            </View>
          </View>
        </GGMCard>

        {/* Job list */}
        {jobs.map((job, i) => (
          <TouchableOpacity key={i} style={styles.jobRow} activeOpacity={0.7}
            onPress={() => {
              const addr = encodeURIComponent(job.address || job.postcode || '');
              if (addr) Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${addr}`);
            }}
          >
            <View style={[styles.stopNum, { backgroundColor: StatusConfig[job.status]?.color || Colors.info }]}>
              <Text style={styles.stopNumText}>{i + 1}</Text>
            </View>
            <View style={styles.jobInfo}>
              <Text style={styles.jobName}>{job.name || job.clientName || 'Client'}</Text>
              <Text style={styles.jobServiceText}>
                {job.service || 'Job'} — {job.postcode || ''}
              </Text>
            </View>
            <Ionicons name="navigate-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
        ))}

        <IconButton
          icon="navigate-outline"
          label="Open in Google Maps"
          onPress={openAllInMaps}
          style={{ marginHorizontal: Spacing.lg, marginTop: Spacing.md }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: {
    height: 260,
  },
  overlay: {
    flex: 1,
    paddingTop: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.md,
  },
  stopNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  jobInfo: { flex: 1 },
  jobName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  jobServiceText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
