import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius, gradients } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export const GUIDE_SEEN_KEY = '@sarixgo-driver/guide_seen';

interface GuideStep {
  n: number;
  icon: IconName;
  tint: string;
  iconColor: string;
  titleKey: string;
  bodyKey: string;
  tipKey: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    n: 1,
    icon: 'idCard',
    tint: '#DBEAFE',
    iconColor: '#1D4ED8',
    titleKey: 'guide.step1Title',
    bodyKey: 'guide.step1Body',
    tipKey: 'guide.step1Tip',
  },
  {
    n: 2,
    icon: 'wallet',
    tint: '#D1FAE5',
    iconColor: '#059669',
    titleKey: 'guide.step2Title',
    bodyKey: 'guide.step2Body',
    tipKey: 'guide.step2Tip',
  },
  {
    n: 3,
    icon: 'taxi',
    tint: '#FEF3C7',
    iconColor: '#D97706',
    titleKey: 'guide.step3Title',
    bodyKey: 'guide.step3Body',
    tipKey: 'guide.step3Tip',
  },
  {
    n: 4,
    icon: 'route',
    tint: '#E0E7FF',
    iconColor: '#4F46E5',
    titleKey: 'guide.step4Title',
    bodyKey: 'guide.step4Body',
    tipKey: 'guide.step4Tip',
  },
  {
    n: 5,
    icon: 'star',
    tint: '#FCE7F3',
    iconColor: '#DB2777',
    titleKey: 'guide.step5Title',
    bodyKey: 'guide.step5Body',
    tipKey: 'guide.step5Tip',
  },
];

export default function DriverGuideScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = onboarding === '1';

  const [activeIndex, setActiveIndex] = useState(0);
  const currentStep = GUIDE_STEPS[activeIndex];
  const isLast = activeIndex === GUIDE_STEPS.length - 1;

  const finishGuide = async () => {
    try {
      await AsyncStorage.setItem(GUIDE_SEEN_KEY, 'true');
    } catch {}
    if (isOnboarding) {
      router.replace('/login');
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/orders');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <LinearGradient
        colors={gradients.navy}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTopRow}>
          {!isOnboarding ? (
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <Icon name="back" size={24} color={colors.textOnPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}

          <View style={styles.stepPill}>
            <Text style={styles.stepPillText}>
              {t('guide.stepOf', { current: activeIndex + 1, total: GUIDE_STEPS.length })}
            </Text>
          </View>

          {isOnboarding ? (
            <TouchableOpacity onPress={finishGuide} style={styles.skipBtn}>
              <Text style={styles.skipText}>{t('guide.skipBtn')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={styles.headerHero}>
          <View style={styles.heroIconWrap}>
            <Icon name="book" size={32} color={colors.primary} />
          </View>
          <Text style={styles.headerTitle}>{t('guide.title')}</Text>
          <Text style={styles.headerSub}>{t('guide.subtitle')}</Text>
        </View>

        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {GUIDE_STEPS.map((s, idx) => (
            <TouchableOpacity
              key={s.n}
              onPress={() => setActiveIndex(idx)}
              style={[
                styles.dot,
                idx === activeIndex && styles.dotActive,
                idx < activeIndex && styles.dotCompleted,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(s.titleKey)}
            />
          ))}
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Featured active step card */}
        <View style={styles.activeCard}>
          <View style={[styles.stepIconCircle, { backgroundColor: currentStep.tint }]}>
            <Icon name={currentStep.icon} size={34} color={currentStep.iconColor} />
          </View>
          <Text style={styles.stepTitle}>{t(currentStep.titleKey)}</Text>
          <Text style={styles.stepBody}>{t(currentStep.bodyKey)}</Text>

          <View style={styles.tipBox}>
            <Icon name="idea" size={18} color="#B45309" />
            <Text style={styles.tipText}>{t(currentStep.tipKey)}</Text>
          </View>
        </View>

        {/* Step navigation controls */}
        <View style={styles.navRow}>
          {activeIndex > 0 ? (
            <TouchableOpacity
              style={styles.prevBtn}
              onPress={() => setActiveIndex((i) => Math.max(0, i - 1))}
              activeOpacity={0.8}
            >
              <Icon name="back" size={18} color={colors.text} />
              <Text style={styles.prevBtnText}>{t('guide.prevBtn')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <View style={{ flex: 1.4 }}>
            <Button
              title={isLast ? t('guide.finishBtn') : t('guide.nextBtn')}
              onPress={() => {
                if (isLast) {
                  finishGuide();
                } else {
                  setActiveIndex((i) => Math.min(GUIDE_STEPS.length - 1, i + 1));
                }
              }}
              variant="primary"
            />
          </View>
        </View>

        {/* Overview list of all 5 steps so the driver can jump directly to any topic */}
        <Text style={styles.allStepsHeader}>{t('guide.allStepsTitle')}</Text>
        <View style={styles.stepList}>
          {GUIDE_STEPS.map((step, idx) => {
            const selected = idx === activeIndex;
            return (
              <TouchableOpacity
                key={step.n}
                style={[styles.stepRow, selected && styles.stepRowSelected]}
                onPress={() => setActiveIndex(idx)}
                activeOpacity={0.85}
              >
                <View style={[styles.smallIconTile, { backgroundColor: step.tint }]}>
                  <Icon name={step.icon} size={20} color={step.iconColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stepRowTitle, selected && { color: colors.primary }]}>
                    {t(step.titleKey)}
                  </Text>
                  <Text style={styles.stepRowSub} numberOfLines={2}>
                    {t(step.bodyKey)}
                  </Text>
                </View>
                {selected && <Icon name="check" size={18} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepPill: {
      backgroundColor: 'rgba(255,255,255,0.16)',
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    stepPillText: {
      ...typography.small,
      color: colors.textOnPrimary,
      fontWeight: '700',
    },
    skipBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    skipText: {
      ...typography.small,
      color: colors.accent,
      fontWeight: '700',
    },
    headerHero: {
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    heroIconWrap: {
      width: 60,
      height: 60,
      borderRadius: radius.lg,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    headerTitle: {
      ...typography.h2,
      color: colors.textOnPrimary,
      textAlign: 'center',
    },
    headerSub: {
      ...typography.caption,
      color: 'rgba(255,255,255,0.82)',
      textAlign: 'center',
      marginTop: 4,
    },
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.md,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: 'rgba(255,255,255,0.3)',
    },
    dotActive: {
      width: 28,
      backgroundColor: colors.accent,
    },
    dotCompleted: {
      backgroundColor: 'rgba(255,255,255,0.75)',
    },
    scroll: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    activeCard: {
      backgroundColor: colors.background,
      borderRadius: radius.xl,
      padding: spacing.lg,
      alignItems: 'center',
      shadowColor: '#0E1730',
      shadowOpacity: 0.07,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    stepIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    stepTitle: {
      ...typography.h2,
      color: colors.text,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    stepBody: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 23,
      marginBottom: spacing.md,
    },
    tipBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: '#FFFBEB',
      borderWidth: 1,
      borderColor: '#FDE68A',
      borderRadius: radius.md,
      padding: spacing.md,
      width: '100%',
    },
    tipText: {
      ...typography.small,
      color: '#92400E',
      flex: 1,
      lineHeight: 19,
    },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
    },
    prevBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    prevBtnText: {
      ...typography.bodyBold,
      color: colors.text,
    },
    allStepsHeader: {
      ...typography.bodyBold,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    stepList: {
      gap: spacing.sm,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.background,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    stepRowSelected: {
      borderColor: colors.primary,
    },
    smallIconTile: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepRowTitle: {
      ...typography.bodyBold,
      color: colors.text,
    },
    stepRowSub: {
      ...typography.small,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
