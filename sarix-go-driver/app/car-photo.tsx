import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../src/components/Button';
import { api, API_URL } from '../src/api/client';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function CarPhotoScreen() {
  const driver = useDriverStore((s) => s.driver);
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [imageUri, setImageUri] = useState<string | null>(
    driver?.car_photo_url ? `${API_URL}${driver.car_photo_url}` : null
  );
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('❌', 'Ruxsat berilmadi');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('❌', 'Kamera ruxsati berilmadi');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const upload = async () => {
    if (!imageUri || imageUri.startsWith('http')) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: imageUri,
        name: 'car.jpg',
        type: 'image/jpeg',
      } as any);

      await api.post('/api/driver/upload/car-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      Alert.alert('✅', 'Mashina rasmi yuklandi! Admin tasdiqlashi bilan yo\'lovchilar ko\'radi.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('❌', e?.response?.data?.error || 'Yuklab bo\'lmadi');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Mashina rasmi</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.preview} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderEmoji}>🚗</Text>
            <Text style={styles.placeholderText}>Mashina rasmi qo'shing</Text>
          </View>
        )}

        <Text style={styles.hint}>
          Yo'lovchilar sizning mashinangizni tanish uchun yaxshi rasm yuklang.
          Mashina raqami ko'rinishi kerak.
        </Text>

        <View style={styles.buttons}>
          <Button
            title="📷 Kamera"
            onPress={takePhoto}
            variant="outline"
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <Button
            title="🖼 Galereya"
            onPress={pickImage}
            variant="outline"
            fullWidth={false}
            style={{ flex: 1, marginLeft: spacing.sm }}
          />
        </View>

        {imageUri && !imageUri.startsWith('http') && (
          <Button
            title="✅ Yuklash"
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
  backIcon: { fontSize: 28, color: colors.primary },
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
  placeholderEmoji: { fontSize: 80, marginBottom: spacing.sm },
  placeholderText: { ...typography.body, color: colors.textSecondary },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginVertical: spacing.md,
    lineHeight: 20,
  },
  buttons: { flexDirection: 'row' },
});
