/**
 * Progress Steps — Horizontal stepped progress indicator for job workflow.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, StatusConfig } from '../theme';

const STEPS = ['scheduled', 'en-route', 'in-progress', 'completed', 'invoiced'];

export default function ProgressSteps({ currentStatus }) {
  const currentIdx = STEPS.indexOf(currentStatus);

  return (
    <View style={styles.container}>
      {STEPS.map((step, idx) => {
        const config = StatusConfig[step];
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isActive = isComplete || isCurrent;

        return (
          <React.Fragment key={step}>
            {idx > 0 && (
              <View style={[styles.line, isComplete && styles.lineActive]} />
            )}
            <View style={styles.stepWrap}>
              <View style={[
                styles.dot,
                isComplete && styles.dotComplete,
                isCurrent && { backgroundColor: config.color + '20', borderColor: config.color },
              ]}>
                {isComplete ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : (
                  <Ionicons name={config.icon} size={12} color={isCurrent ? config.color : Colors.textLight} />
                )}
              </View>
              <Text style={[
                styles.label,
                isCurrent && { color: config.color, fontWeight: '600' },
              ]} numberOfLines={1}>
                {config.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  stepWrap: {
    alignItems: 'center',
    width: 58,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotComplete: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  line: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.borderLight,
    marginTop: 13,
  },
  lineActive: {
    backgroundColor: Colors.success,
  },
  label: {
    fontSize: 9,
    color: Colors.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
});
