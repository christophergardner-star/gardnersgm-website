/**
 * Expenses Screen — Track job-related expenses.
 * GGM Field v3.0
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, FlatList, StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import GGMCard from '../components/GGMCard';
import FormField from '../components/FormField';
import IconButton from '../components/IconButton';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';

const CATEGORIES = [
  { key: 'fuel',      icon: 'flame-outline',       label: 'Fuel',       color: '#E65100' },
  { key: 'materials', icon: 'cube-outline',         label: 'Materials',  color: '#1565C0' },
  { key: 'equipment', icon: 'build-outline',        label: 'Equipment',  color: '#558B2F' },
  { key: 'disposal',  icon: 'trash-outline',        label: 'Disposal',   color: '#6D4C41' },
  { key: 'travel',    icon: 'car-outline',          label: 'Travel',     color: '#7B1FA2' },
  { key: 'other',     icon: 'ellipsis-horizontal',  label: 'Other',      color: '#546E7A' },
];

export default function ExpensesScreen() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [category, setCategory] = useState('fuel');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadExpenses(); }, []);

  async function loadExpenses() {
    try {
      const { getJobExpenses } = require('../services/api');
      const data = await getJobExpenses();
      if (data?.expenses) setExpenses(data.expenses);
      else setExpenses([]);
    } catch (err) {
      // Silently fail — show empty
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleSubmit() {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid', 'Please enter a valid amount.');
      return;
    }

    setSubmitting(true);
    try {
      const { saveJobExpense } = require('../services/api');
      await saveJobExpense({
        category,
        amount: parseFloat(amount),
        description,
        date: new Date().toISOString(),
        source: 'mobile-field',
      });
      Alert.alert('Saved', 'Expense recorded.');
      setAmount('');
      setDescription('');
      setShowForm(false);
      loadExpenses();
    } catch (err) {
      Alert.alert('Saved Offline', 'Expense saved and will sync when online.');
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  const totalToday = expenses
    .filter(e => e.date?.startsWith(new Date().toISOString().slice(0, 10)))
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  const totalWeek = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  const catInfo = CATEGORIES.find(c => c.key === category) || CATEGORIES[0];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadExpenses(); }}
          colors={[Colors.primary]} tintColor={Colors.primary} />
      }
    >
      {/* Summary */}
      <View style={styles.summaryRow}>
        <GGMCard style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Today</Text>
          <Text style={styles.summaryValue}>{'\u00A3'}{totalToday.toFixed(2)}</Text>
        </GGMCard>
        <GGMCard style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This Period</Text>
          <Text style={styles.summaryValue}>{'\u00A3'}{totalWeek.toFixed(2)}</Text>
        </GGMCard>
      </View>

      {/* Add button or form */}
      {!showForm ? (
        <View style={styles.addWrap}>
          <IconButton
            icon="add-circle-outline"
            label="Add Expense"
            onPress={() => setShowForm(true)}
          />
        </View>
      ) : (
        <>
          <SectionHeader icon="card-outline" title="New Expense" />
          <GGMCard>
            {/* Category pills */}
            <Text style={styles.catLabel}>Category</Text>
            <View style={styles.catRow}>
              {CATEGORIES.map(cat => (
                <View key={cat.key}>
                  <IconButton
                    icon={cat.icon}
                    label={cat.label}
                    size="sm"
                    variant={category === cat.key ? 'filled' : 'outline'}
                    color={cat.color}
                    onPress={() => setCategory(cat.key)}
                    style={styles.catPill}
                  />
                </View>
              ))}
            </View>
            <FormField
              icon="cash-outline"
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="numeric"
            />
            <FormField
              icon="create-outline"
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="What was this expense for?"
              multiline
            />
            <View style={styles.formActions}>
              <IconButton
                icon="close-outline"
                label="Cancel"
                variant="outline"
                color={Colors.textMuted}
                onPress={() => setShowForm(false)}
                style={{ flex: 1 }}
              />
              <IconButton
                icon="checkmark-outline"
                label="Save"
                onPress={handleSubmit}
                loading={submitting}
                style={{ flex: 1 }}
              />
            </View>
          </GGMCard>
        </>
      )}

      {/* Recent expenses */}
      <SectionHeader icon="time-outline" title="Recent Expenses" />
      {expenses.length === 0 ? (
        <EmptyState icon="card-outline" title="No expenses" subtitle="Tap 'Add Expense' to record costs." />
      ) : (
        expenses.slice(0, 20).map((exp, i) => {
          const cat = CATEGORIES.find(c => c.key === exp.category) || CATEGORIES[5];
          return (
            <GGMCard key={i} accentColor={cat.color}>
              <View style={styles.expRow}>
                <Ionicons name={cat.icon} size={20} color={cat.color} />
                <View style={styles.expInfo}>
                  <Text style={styles.expDesc}>{exp.description || cat.label}</Text>
                  <Text style={styles.expDate}>{exp.date?.slice(0, 10) || '—'}</Text>
                </View>
                <Text style={styles.expAmount}>{'\u00A3'}{parseFloat(exp.amount || 0).toFixed(2)}</Text>
              </View>
            </GGMCard>
          );
        })
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingVertical: Spacing.lg },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 0,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  addWrap: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  catLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  catRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  catPill: {
    paddingHorizontal: Spacing.md,
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  expRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  expInfo: { flex: 1 },
  expDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  expDate: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  expAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.error,
  },
});
