/**
 * Audio Service — Voice recording using expo-av.
 * GGM Field v3.0
 */

import { Audio } from 'expo-av';

let currentRecording = null;

export async function startRecording() {
  // Request permission
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Microphone permission not granted');
  }

  // Configure audio mode
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  // Create and start recording
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  currentRecording = recording;
  return recording;
}

export async function stopRecording() {
  if (!currentRecording) return null;

  try {
    await currentRecording.stopAndUnloadAsync();
    const uri = currentRecording.getURI();
    currentRecording = null;

    // Reset audio mode
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    return uri;
  } catch (err) {
    currentRecording = null;
    throw err;
  }
}

export function isRecording() {
  return currentRecording !== null;
}
