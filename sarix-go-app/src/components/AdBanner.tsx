import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, typography, spacing, radius } from '../theme';
import { gradients } from '../theme/colors';

/** How long the ad stays on screen before it auto-dismisses. */
export const AD_DURATION_SEC = 7;

/**
 * Optional remote ad image. Leave empty to show the built-in branded promo. Set this
 * to a hosted image URL (e.g. a banner from the marketing team) to display a real ad.
 * When set, the image fills the card and the countdown / skip control sit on top.
 */
export const AD_IMAGE_URL = '';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min(width - spacing.lg * 2, 420);

export interface AdBannerProps {
  /** Whether the ad overlay is visible. */
  visible: boolean;
  /** Called when the ad is dismissed (countdown finished or user skipped). */
  onClose: () => void;
  /** Optional override for the ad image URL. */
  imageUrl?: string | null;
  /** Optional override for the display duration in seconds. */
  durationSec?: number;
}

/**
 * Full-screen promotional overlay shown on the passenger home screen for a fixed
 * number of seconds (7 by default). It counts down and auto-closes; the user can also
 * skip it early. Shows a remote image when `imageUrl`/`AD_IMAGE_URL` is provided,
 * otherwise a branded Sarix Go promo so it always renders something on screen.
 */
export default function AdBanner({
  visible,
  onClose,
  imageUrl,
  durationSec = AD_DURATION_SEC,
}: AdBannerProps) {
  const [remaining, setRemaining] = useState(durationSec);
  const img = imageUrl ?? AD_IMAGE_URL;

  useEffect(() => {
    if (!visible) return;
    setRemaining(durationSec);
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          // Defer onClose out of the state updater to avoid setState-in-render.
          setTimeout(onClose, 0);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, durationSec, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {img ? (
            <Image source={{ uri: img }} style={styles.image} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={gradients.purple}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.promo}
            >
              <Text style={styles.promoBadge}>REKLAMA</Text>
              <Text style={styles.promoLogo}>🚕</Text>
              <Text style={styles.promoTitle}>Sarix Go</Text>
              <Text style={styles.promoSubtitle}>
                Termiz va Surxondaryo bo'ylab tez, qulay va ishonchli taksi xizmati!
              </Text>
              <View style={styles.promoTags}>
                {['Tez', 'Arzon', 'Xavfsiz'].map((tag) => (
                  <View key={tag} style={styles.promoTag}>
                    <Text style={styles.promoTagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          )}

          {/* Skip / countdown control */}
          <TouchableOpacity style={styles.skip} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.skipText}>
              {remaining > 0 ? `O'tkazib yuborish · ${remaining}` : "O'tkazib yuborish"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,10,30,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  image: {
    width: '100%',
    height: CARD_WIDTH * 1.3,
  },
  promo: {
    width: '100%',
    minHeight: CARD_WIDTH * 1.1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  promoLogo: { fontSize: 64, marginBottom: spacing.md },
  promoTitle: { ...typography.h1, color: colors.white, marginBottom: spacing.sm },
  promoSubtitle: {
    ...typography.body,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  promoTags: { flexDirection: 'row', gap: spacing.sm },
  promoTag: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  promoTagText: { ...typography.caption, color: colors.white, fontWeight: '700' },
  skip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  skipText: { ...typography.caption, color: colors.white, fontWeight: '700' },
});
