import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { API_URL } from '../src/api/client';
import { describeApiError } from '../src/api/errors';
import { uploadCarPhoto } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function CarPhotoScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [imageUri, setImageUri] = useState<string | null>(
    driver?.car_photo_url ? `${API_URL}${driver.car_photo_url}` : null
  );
  const [uploading, setUploading] = useState(false);

  // Guards state setters (mounted) and dialogs/navigation (still on screen) separately —
  // the upload runs against a 20s timeout and the back button used to stay live, so a
  // driver who left mid-upload got a dialog over an unrelated screen whose only button
  // called router.back() and popped them out of it.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Synchronous, unlike `uploading` state, which only disables the Button after a
  // re-render. Two taps in one frame both used to reach the POST: two files written, two
  // commits, and because each commit deletes the PREVIOUS car_photo_url from disk
  // (_handle_driver_upload), the loser could unlink the winner's file and leave the
  // driver's saved photo pointing at nothing.
  const uploadInFlightRef = useRef(false);
  const pickInFlightRef = useRef(false);

  const setPickedImage = (result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled && result.assets?.[0] && aliveRef.current) {
      setImageUri(result.assets[0].uri);
    }
  };

  const pickImage = async () => {
    if (pickInFlightRef.current) return;
    pickInFlightRef.current = true;
    try {
      // Was uncaught: on an installed build without media-library permission baked in this
      // rejects, and an unhandled rejection gave the driver no feedback whatsoever.
      setPickedImage(
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: true,
          aspect: [4, 3],
        })
      );
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || String(e));
    } finally {
      pickInFlightRef.current = false;
    }
  };

  const takePhoto = async () => {
    if (pickInFlightRef.current) return;
    pickInFlightRef.current = true;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.error'), t('carPhoto.errCameraPermission'));
        return;
      }
      setPickedImage(
        await ImagePicker.launchCameraAsync({
          quality: 0.7,
          allowsEditing: true,
          aspect: [4, 3],
        })
      );
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || String(e));
    } finally {
      pickInFlightRef.current = false;
    }
  };

  const upload = async () => {
    if (uploadInFlightRef.current) return;
    if (!imageUri || imageUri.startsWith('http')) return;
    uploadInFlightRef.current = true;

    setUploading(true);
    try {
      const { url } = await uploadCarPhoto(imageUri);

      // The store was never updated, so re-entering this screen re-seeded the preview from
      // the OLD driver.car_photo_url — the driver saw their previous photo (or the empty
      // placeholder on a first upload), concluded it had failed, and uploaded again.
      const current = useDriverStore.getState().driver;
      if (current && url) {
        setDriver({ ...current, car_photo_url: url });
      }
      if (!aliveRef.current) return;
      Alert.alert(
        t('common.success'),
        t('carPhoto.uploaded'),
        [{ text: t('common.close'), onPress: () => router.back() }],
        // Android dialogs are dismissible by default and a dismissal never fires onPress,
        // which stranded the driver here after a SUCCESSFUL upload.
        { cancelable: false }
      );
    } catch (e: any) {
      if (!aliveRef.current) return;
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      uploadInFlightRef.current = false;
      if (aliveRef.current) setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          disabled={uploading}
        >
          <Icon name="back" size={26} color={uploading ? colors.textMuted : colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('carPhoto.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.preview} />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="car" size={64} color={colors.textMuted} />
            <Text style={styles.placeholderText}>{t('carPhoto.placeholder')}</Text>
          </View>
        )}

        <Text style={styles.hint}>{t('carPhoto.hint')}</Text>

        <View style={styles.buttons}>
          <Button
            title={t('carPhoto.camera')}
            onPress={takePhoto}
            disabled={uploading}
            variant="outline"
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <Button
            title={t('carPhoto.gallery')}
            onPress={pickImage}
            disabled={uploading}
            variant="outline"
            fullWidth={false}
            style={{ flex: 1, marginLeft: spacing.sm }}
          />
        </View>

        {imageUri && !imageUri.startsWith('http') && (
          <Button
            title={t('carPhoto.upload')}
            onPress={upload}
            loading={uploading}
            variant="accent"
            style={{ marginTop: spacing.lg }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.primary },
  body: { flex: 1, padding: spacing.lg },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  placeholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.divider,
    borderStyle: 'dashed',
  },
  placeholderText: { ...typography.body, color: colors.textSecondary },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginVertical: spacing.md,
    lineHeight: 20,
  },
  buttons: { flexDirection: 'row' },
});
