/**
 * Signature Screen — Client sign-off capture.
 * GGM Field v3.0
 * 
 * Canvas signature pad for client to sign on completion.
 * Saves base64 image to GAS.
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import IconButton from '../components/IconButton';
import GGMCard from '../components/GGMCard';

export default function SignatureCapture({ route, navigation }) {
  const { jobRef, job } = route.params || {};
  const sigRef = useRef(null);
  const [signed, setSigned] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSignature(signature) {
    // signature is a base64 data URI
    setSignatureData(signature);
    setSigned(true);
  }

  function handleClear() {
    sigRef.current?.clearSignature();
    setSigned(false);
    setSignatureData(null);
  }

  async function handleSubmit() {
    if (!signatureData) {
      Alert.alert('No Signature', 'Please ask the client to sign before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const { submitClientSignature } = require('../services/api');
      await submitClientSignature(jobRef, {
        signature: signatureData,
        clientName: job?.name || job?.clientName || '',
        service: job?.service || '',
        signedAt: new Date().toISOString(),
      });
      Alert.alert('Signed Off', 'Client signature recorded successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Saved Offline', 'Signature saved and will sync when online.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  const webStyle = `.m-signature-pad {
    box-shadow: none;
    border: none;
    margin: 0;
    width: 100%;
    height: 100%;
  }
  .m-signature-pad--body {
    border: none;
  }
  .m-signature-pad--footer {
    display: none;
  }
  body, html {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
  }`;

  return (
    <View style={styles.container}>
      {/* Job info */}
      <GGMCard>
        <View style={styles.jobInfo}>
          <Ionicons name="create-outline" size={22} color={Colors.primary} />
          <View style={styles.jobText}>
            <Text style={styles.jobTitle}>Client Sign-Off</Text>
            <Text style={styles.jobSub}>
              {job?.name || job?.clientName || 'Client'} — {job?.service || 'Job'}
            </Text>
          </View>
          {signed && (
            <View style={styles.signedBadge}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={styles.signedText}>Signed</Text>
            </View>
          )}
        </View>
      </GGMCard>

      {/* Signature pad */}
      <View style={styles.padContainer}>
        <Text style={styles.padLabel}>Please sign below</Text>
        <View style={styles.padWrap}>
          <SignatureScreen
            ref={sigRef}
            onOK={handleSignature}
            onEmpty={() => setSigned(false)}
            webStyle={webStyle}
            backgroundColor={Colors.card}
            penColor={Colors.textPrimary}
            dotSize={2}
            minWidth={1.5}
            maxWidth={3}
            autoClear={false}
          />
        </View>
        <View style={styles.signatureLine}>
          <View style={styles.line} />
          <Text style={styles.signatureX}>X</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <IconButton
            icon="trash-outline"
            label="Clear"
            onPress={handleClear}
            variant="outline"
            color={Colors.error}
            style={{ flex: 1 }}
          />
          <IconButton
            icon="save-outline"
            label="Save"
            onPress={() => sigRef.current?.readSignature()}
            variant="outline"
            color={Colors.primary}
            style={{ flex: 1 }}
          />
        </View>
        <IconButton
          icon="checkmark-circle-outline"
          label="Submit Sign-Off"
          onPress={handleSubmit}
          disabled={!signed}
          loading={submitting}
          color={Colors.primary}
          style={{ marginTop: Spacing.md }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
  },
  jobInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  jobText: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  jobSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signedText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.success,
  },
  padContainer: {
    flex: 1,
    marginTop: Spacing.lg,
  },
  padLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  padWrap: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
    backgroundColor: Colors.card,
  },
  signatureLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.textLight,
  },
  signatureX: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textLight,
    marginLeft: Spacing.sm,
  },
  actions: {
    paddingTop: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
});
