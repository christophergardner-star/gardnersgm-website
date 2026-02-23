/**
 * Weather Screen — 7-day forecast from GAS.
 * GGM Field v3.0
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import GGMCard from '../components/GGMCard';
import EmptyState from '../components/EmptyState';
import LoadingOverlay from '../components/LoadingOverlay';

const WEATHER_ICONS = {
  sunny:      { name: 'sunny-outline',          color: '#FF9800' },
  clear:      { name: 'moon-outline',           color: '#7986CB' },
  cloudy:     { name: 'cloud-outline',          color: '#78909C' },
  overcast:   { name: 'cloud',                  color: '#607D8B' },
  rain:       { name: 'rainy-outline',          color: '#1565C0' },
  drizzle:    { name: 'rainy-outline',          color: '#42A5F5' },
  heavy_rain: { name: 'thunderstorm-outline',   color: '#0D47A1' },
  snow:       { name: 'snow-outline',           color: '#B0BEC5' },
  wind:       { name: 'flag-outline',           color: '#546E7A' },
  fog:        { name: 'water-outline',          color: '#90A4AE' },
  default:    { name: 'partly-sunny-outline',   color: '#FFB74D' },
};

function getWeatherIcon(condition) {
  if (!condition) return WEATHER_ICONS.default;
  const lower = condition.toLowerCase();
  if (lower.includes('heavy rain') || lower.includes('thunder')) return WEATHER_ICONS.heavy_rain;
  if (lower.includes('rain') || lower.includes('shower')) return WEATHER_ICONS.rain;
  if (lower.includes('drizzle')) return WEATHER_ICONS.drizzle;
  if (lower.includes('snow') || lower.includes('sleet')) return WEATHER_ICONS.snow;
  if (lower.includes('fog') || lower.includes('mist')) return WEATHER_ICONS.fog;
  if (lower.includes('overcast')) return WEATHER_ICONS.overcast;
  if (lower.includes('cloud') || lower.includes('partly')) return WEATHER_ICONS.cloudy;
  if (lower.includes('sun') || lower.includes('clear')) return WEATHER_ICONS.sunny;
  if (lower.includes('wind')) return WEATHER_ICONS.wind;
  return WEATHER_ICONS.default;
}

function getSeverityColor(severity) {
  if (severity === 'good' || severity === 'low') return Colors.success;
  if (severity === 'moderate' || severity === 'medium') return Colors.warning;
  if (severity === 'bad' || severity === 'high') return Colors.error;
  return Colors.textMuted;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function WeatherScreen() {
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadWeather(); }, []);

  async function loadWeather() {
    try {
      setError(null);
      const { apiGet } = require('../services/api');
      const data = await apiGet('get_weather', { postcode: 'PL26' });
      // GAS returns { status, forecast: { source, daily: [...], metOfficeWarnings } }
      if (data?.forecast?.daily) {
        setForecast(data.forecast.daily);
      } else if (Array.isArray(data?.forecast)) {
        setForecast(data.forecast);
      } else if (data?.daily) {
        setForecast(data.daily);
      } else {
        setForecast([]);
      }
    } catch (err) {
      setError('Could not load weather data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  if (loading) return <LoadingOverlay message="Loading weather..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadWeather(); }}
          colors={[Colors.primary]} tintColor={Colors.primary} />
      }
    >
      {/* Location info */}
      <View style={styles.locationRow}>
        <Ionicons name="location-outline" size={16} color={Colors.primary} />
        <Text style={styles.locationText}>Roche, Cornwall — PL26</Text>
      </View>

      {error ? (
        <EmptyState icon="cloud-offline-outline" title="Weather Unavailable" subtitle={error} />
      ) : forecast.length === 0 ? (
        <EmptyState icon="cloud-outline" title="No Forecast" subtitle="Pull down to refresh." />
      ) : (
        forecast.map((day, i) => {
          // GAS fields: dateISO, description, tempMax, tempMin, windSpeed, windGust, rainMM, rainChance, severity (object)
          const condition = day.description || day.condition || day.weather || '';
          const wx = getWeatherIcon(condition);
          const date = day.dateISO ? new Date(day.dateISO + 'T00:00:00') : (day.date ? new Date(day.date) : null);
          const dayName = date ? DAY_NAMES[date.getDay()] : '';
          const dateStr = date ? `${date.getDate()}/${date.getMonth() + 1}` : '';
          const isToday = date && date.toDateString() === new Date().toDateString();
          // severity from GAS is { level, shouldCancel, summary, reasons[] }
          const severityObj = day.severity || {};
          const severityLevel = typeof severityObj === 'string' ? severityObj : (severityObj.level || '');
          const severityLabel = severityLevel === 'cancel' ? 'high' : severityLevel === 'advisory' ? 'medium' : (severityLevel === 'ok' ? 'low' : severityLevel);
          const severitySummary = typeof severityObj === 'object' ? severityObj.summary : '';

          return (
            <GGMCard key={i} accentColor={getSeverityColor(severityLabel)}>
              <View style={styles.dayRow}>
                <View style={styles.dayLeft}>
                  <View style={[styles.wxIcon, { backgroundColor: wx.color + '18' }]}>
                    <Ionicons name={wx.name} size={26} color={wx.color} />
                  </View>
                </View>
                <View style={styles.dayCenter}>
                  <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                    {isToday ? 'Today' : dayName} {dateStr}
                  </Text>
                  <Text style={styles.dayCondition}>{condition || '—'}</Text>
                  {day.rainChance > 0 ? (
                    <Text style={styles.dayDetail}>{day.rainChance}% rain · {day.rainMM ?? 0}mm</Text>
                  ) : null}
                  {severityLabel && severityLabel !== 'low' ? (
                    <Text style={[styles.daySeverity, { color: getSeverityColor(severityLabel) }]}>
                      {severitySummary || `Work risk: ${severityLabel}`}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.dayRight}>
                  <Text style={styles.dayTemp}>
                    {day.tempMax ?? day.maxTemp ?? day.high ?? '—'}°
                  </Text>
                  <Text style={styles.dayTempLow}>
                    {day.tempMin ?? day.minTemp ?? day.low ?? '—'}°
                  </Text>
                  {(day.windSpeed || day.wind) ? (
                    <View style={styles.windRow}>
                      <Ionicons name="flag-outline" size={10} color={Colors.textLight} />
                      <Text style={styles.windText}>{day.windSpeed || day.wind}mph</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </GGMCard>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: Spacing.lg },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  locationText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayLeft: {
    marginRight: Spacing.md,
  },
  wxIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCenter: { flex: 1 },
  dayName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dayNameToday: {
    color: Colors.primary,
  },
  dayCondition: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  dayDetail: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },
  daySeverity: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  dayRight: {
    alignItems: 'flex-end',
  },
  dayTemp: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dayTempLow: {
    fontSize: 13,
    color: Colors.textLight,
  },
  windRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  windText: {
    fontSize: 10,
    color: Colors.textLight,
  },
});
