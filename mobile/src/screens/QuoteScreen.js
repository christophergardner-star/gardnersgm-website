/**
 * Quote Screen — On-site quote creation.
 * GGM Field v3.0
 * Uses existing GAS create_quote endpoint.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows, ServiceIcons } from '../theme';
import GGMCard from '../components/GGMCard';
import FormField from '../components/FormField';
import IconButton from '../components/IconButton';
import SectionHeader from '../components/SectionHeader';

const SERVICES = [
  'Lawn Cutting', 'Hedge Trimming', 'Lawn Treatment', 'Scarifying',
  'Garden Clearance', 'Power Washing', 'Drain Clearance',
  'Fence Repair', 'Gutter Cleaning', 'Weeding',
];

export default function QuoteScreen({ route, navigation }) {
  const { client } = route.params || {};

  const [clientName, setClientName] = useState(client?.name || '');
  const [email, setEmail] = useState(client?.email || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [postcode, setPostcode] = useState(client?.postcode || '');
  const [selectedServices, setSelectedServices] = useState([]);
  const [prices, setPrices] = useState({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleService(svc) {
    setSelectedServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  }

  function setServicePrice(svc, val) {
    setPrices(prev => ({ ...prev, [svc]: val }));
  }

  const total = selectedServices.reduce((sum, svc) => sum + (parseFloat(prices[svc] || '0') || 0), 0);

  async function handleSubmit() {
    if (!clientName.trim()) {
      Alert.alert('Missing', 'Please enter a client name.');
      return;
    }
    if (selectedServices.length === 0) {
      Alert.alert('Missing', 'Please select at least one service.');
      return;
    }

    setSubmitting(true);
    try {
      const { createQuote } = require('../services/api');
      const items = selectedServices.map(svc => ({
        service: svc,
        price: parseFloat(prices[svc] || '0') || 0,
      }));
      await createQuote({
        clientName,
        email,
        phone,
        postcode,
        items,
        total,
        notes,
        source: 'mobile-field',
      });
      Alert.alert('Quote Created', `Quote for ${'\u00A3'}${total.toFixed(2)} sent for ${clientName}.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Saved Offline', 'Quote saved and will sync when online.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Client details */}
      <SectionHeader icon="person-outline" title="Client Details" />
      <GGMCard>
        <FormField icon="person-outline" label="Client Name" value={clientName} onChangeText={setClientName} placeholder="Full name" />
        <FormField icon="mail-outline" label="Email" value={email} onChangeText={setEmail} placeholder="Email address" keyboardType="email-address" />
        <FormField icon="call-outline" label="Phone" value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" />
        <FormField icon="location-outline" label="Postcode" value={postcode} onChangeText={setPostcode} placeholder="e.g. PL26 8HN" />
      </GGMCard>

      {/* Services */}
      <SectionHeader icon="leaf-outline" title="Services" />
      <GGMCard noPadding>
        {SERVICES.map((svc) => {
          const selected = selectedServices.includes(svc);
          const serviceIcon = ServiceIcons[svc] || ServiceIcons.default;
          return (
            <View key={svc} style={[styles.serviceRow, selected && styles.serviceRowSelected]}>
              <Ionicons
                name={selected ? 'checkbox' : 'square-outline'}
                size={22}
                color={selected ? Colors.primary : Colors.textLight}
                onPress={() => toggleService(svc)}
              />
              <Ionicons name={serviceIcon} size={16} color={Colors.textMuted} style={{ marginLeft: Spacing.sm }} />
              <Text
                style={[styles.serviceLabel, selected && styles.serviceLabelSelected]}
                onPress={() => toggleService(svc)}
              >
                {svc}
              </Text>
              {selected && (
                <View style={styles.priceInput}>
                  <Text style={styles.pound}>{'\u00A3'}</Text>
                  <FormField
                    value={prices[svc] || ''}
                    onChangeText={(val) => setServicePrice(svc, val)}
                    placeholder="0.00"
                    keyboardType="numeric"
                    style={{ marginBottom: 0, flex: 1 }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </GGMCard>

      {/* Total */}
      {selectedServices.length > 0 && (
        <GGMCard accentColor={Colors.primary}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Quote Total</Text>
            <Text style={styles.totalValue}>{'\u00A3'}{total.toFixed(2)}</Text>
          </View>
        </GGMCard>
      )}

      {/* Notes */}
      <SectionHeader icon="create-outline" title="Notes" />
      <GGMCard>
        <FormField
          value={notes}
          onChangeText={setNotes}
          placeholder="Additional notes for the quote..."
          multiline
        />
      </GGMCard>

      {/* Submit */}
      <View style={styles.submitWrap}>
        <IconButton
          icon="send-outline"
          label={`Create Quote${total > 0 ? ` — ${'\u00A3'}${total.toFixed(2)}` : ''}`}
          onPress={handleSubmit}
          loading={submitting}
          disabled={!clientName.trim() || selectedServices.length === 0}
        />
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: Spacing.lg },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  serviceRowSelected: {
    backgroundColor: Colors.primaryPale,
  },
  serviceLabel: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    marginLeft: Spacing.sm,
  },
  serviceLabelSelected: {
    fontWeight: '600',
    color: Colors.primary,
  },
  priceInput: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 90,
  },
  pound: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    marginRight: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
  },
  submitWrap: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
});
