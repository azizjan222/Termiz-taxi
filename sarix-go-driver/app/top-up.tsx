import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Clipboard,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import {
  listMethods,
  createAtmosPayment,
  verifyAtmosPayment,
  createClickPayment,
  createPaymePayment,
  submitTopupScreenshot,
  type PaymentMethod,
} from '../src/api/payments';
import { describeApiError, formatAmount } from '../src/api/errors';
import { MIN_BALANCE_FALLBACK } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const PRESET_AMOUNTS = [10000, 20000, 50000, 100000];
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 5_000_000;

const METHOD_ICONS: Record<PaymentMethod['id'], IconName> = {
  card: 'card',
  atmos: 'wallet',
  click: 'wallet',
  payme: 'wallet',
};

const METHOD_COLORS: Record<PaymentMethod['id'], string> = {
  card: '#2563EB',
  atmos: '#6C3CE9',
  click: '#0F86FF',
  payme: '#00CFC1',
};

function formatCardNumberDisplay(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\s+/g, '');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export default function TopUpScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const driver = useDriverStore((s) => s.driver);
  const loadDriver = useDriverStore((s) => s.loadDriver);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string>('card');
  const [amount, setAmount] = useState<number>(50000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const aliveRef = useRef(true);
  const focusedRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      focusedRef.current = false;
    };
  }, []);

  const inFlightRef = useRef(false);
  const lastAtmosPaymentIdRef = useRef<number | null>(null);

  const fetchMethods = useCallback(async () => {
    setMethodsLoading(true);
    try {
      const list = await listMethods();
      if (!aliveRef.current) return;
      setMethods(list);
      setMethodsError(false);
    } catch {
      if (!aliveRef.current) return;
      setMethods([]);
      setMethodsError(true);
    } finally {
      if (aliveRef.current) setMethodsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const pendingAtmosId = lastAtmosPaymentIdRef.current;
      if (pendingAtmosId) {
        verifyAtmosPayment(pendingAtmosId)
          .then((res) => {
            if (res.status === 'approved' || res.status === 'rejected' || res.status === 'cancelled') {
              lastAtmosPaymentIdRef.current = null;
            }
          })
          .catch(() => {})
          .finally(() => {
            loadDriver();
          });
      } else {
        loadDriver();
      }
      fetchMethods();
      return () => {
        focusedRef.current = false;
      };
    }, [fetchMethods, loadDriver])
  );

  const cardMethod = methods.find((m) => m.id === 'card');
  const cardReady = Boolean(cardMethod?.card_number);
  const minBalance = driver?.min_balance ?? MIN_BALANCE_FALLBACK;

  const formatPrice = formatAmount;

  const getActualAmount = (): number => {
    if (customAmount) {
      const n = parseInt(customAmount.replace(/\s/g, ''), 10);
      return isNaN(n) ? 0 : n;
    }
    return amount;
  };

  const copyCard = async () => {
    if (!cardMethod?.card_number) {
      Alert.alert(t('topUp.noCardTitle'), t('topUp.noCardBody'));
      return;
    }
    Clipboard.setString(cardMethod.card_number);
    Alert.alert(t('topUp.copied'));
  };

  const pickScreenshot = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setScreenshot(result.assets[0].uri);
      }
    } catch (e: any) {
      const reason = e?.message || String(e);
      Alert.alert(t('topUp.errImagePick'), reason);
    }
  };

  const submitCardTopup = async () => {
    const amt = getActualAmount();
    if (amt < MIN_AMOUNT) {
      Alert.alert(t('common.error'), t('topUp.errMinAmount', { amount: formatPrice(MIN_AMOUNT) }));
      return;
    }
    if (amt > MAX_AMOUNT) {
      Alert.alert(t('common.error'), t('topUp.errMaxAmount', { amount: formatPrice(MAX_AMOUNT) }));
      return;
    }
    if (!cardReady) {
      Alert.alert(t('topUp.noCardTitle'), t('topUp.noCardBody'));
      return;
    }
    if (!screenshot) {
      Alert.alert(t('topUp.needScreenshot'), t('topUp.needScreenshotBody'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitTopupScreenshot(amt, screenshot);
      await loadDriver();
      if (aliveRef.current) setScreenshot(null);
      if (!focusedRef.current) return;
      Alert.alert(
        t('topUp.sentTitle'),
        res.message || t('topUp.pendingNotice'),
        [{ text: t('common.close'), onPress: () => router.back() }],
        { cancelable: false }
      );
    } catch (e: any) {
      if (!focusedRef.current) return;
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  };

  const handleTopUp = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const amt = getActualAmount();
      if (amt < MIN_AMOUNT) {
        Alert.alert(
          t('common.error'),
          t('topUp.errMinAmount', { amount: formatPrice(MIN_AMOUNT) })
        );
        return;
      }
      if (amt > MAX_AMOUNT) {
        Alert.alert(
          t('common.error'),
          t('topUp.errMaxAmount', { amount: formatPrice(MAX_AMOUNT) })
        );
        return;
      }

      if (selectedMethod === 'card') {
        await submitCardTopup();
        return;
      }

      setLoading(true);
      try {
        let result;
        if (selectedMethod === 'atmos') {
          result = await createAtmosPayment(amt);
          lastAtmosPaymentIdRef.current = result.payment_id;
        } else if (selectedMethod === 'click') {
          result = await createClickPayment(amt);
        } else if (selectedMethod === 'payme') {
          result = await createPaymePayment(amt);
        } else {
          return;
        }

        const supported = await Linking.canOpenURL(result.url);
        if (supported) {
          await Linking.openURL(result.url);
          if (!focusedRef.current) return;
          Alert.alert(t('topUp.providerOpened'), t('topUp.providerOpenedBody'));
        } else {
          Alert.alert(t('common.error'), t('topUp.errBrowser'));
        }
      } catch (e: any) {
        if (!focusedRef.current) return;
        Alert.alert(t('common.error'), describeApiError(e, t));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  const renderMethod = (method: PaymentMethod) => {
    const isSelected = selectedMethod === method.id;
    const methodColor = METHOD_COLORS[method.id] ?? colors.primary;
    return (
      <TouchableOpacity
        key={method.id}
        style={[
          styles.methodCard,
          isSelected && styles.methodCardSelected,
          method.disabled && styles.methodCardDisabled,
        ]}
        onPress={() => !method.disabled && setSelectedMethod(method.id)}
        activeOpacity={0.85}
        disabled={method.disabled}
        accessibilityRole="button"
        accessibilityLabel={method.name}
        accessibilityHint={method.description}
        accessibilityState={{ selected: isSelected, disabled: Boolean(method.disabled) }}
      >
        <View style={[styles.methodIcon, isSelected && styles.methodIconSelected]}>
          <Icon
            name={METHOD_ICONS[method.id] ?? 'card'}
            size={22}
            color={isSelected ? colors.primary : methodColor}
          />
        </View>
        <View style={styles.methodInfo}>
          <Text style={styles.methodName}>
            {method.name}
            {method.disabled && ` ${t('topUp.comingSoon')}`}
          </Text>
          <Text style={styles.methodDesc} numberOfLines={2}>
            {method.description}
          </Text>
        </View>
        <View style={[styles.radio, isSelected && styles.radioSelected]}>
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          disabled={submitting || loading}
        >
          <Icon
            name="back"
            size={24}
            color={submitting || loading ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
        <Text style={styles.title}>{t('topUp.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Current balance card */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceTopRow}>
              <View style={styles.balanceIconWrap}>
                <Icon name="money" size={22} color="#F5B800" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.balanceLabel}>{t('topUp.currentBalance')}</Text>
                <Text style={styles.balanceValue}>
                  {formatPrice(driver?.balance || 0)} {t('more.currency')}
                </Text>
              </View>
            </View>
            {(driver?.balance || 0) < minBalance && (
              <View style={styles.balanceWarningWrap}>
                <Text style={styles.balanceWarning}>
                  {t('topUp.minBalanceHint', { min: formatAmount(minBalance) })}
                </Text>
              </View>
            )}
          </View>

          {/* Amount selection card */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('topUp.amount')}</Text>
            <View style={styles.amountsGrid}>
              {PRESET_AMOUNTS.map((a) => {
                const selected = amount === a && !customAmount;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[
                      styles.amountChip,
                      selected && styles.amountChipSelected,
                    ]}
                    onPress={() => {
                      setAmount(a);
                      setCustomAmount('');
                    }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatPrice(a)} ${t('more.currency')}`}
                    accessibilityHint={t('topUp.a11ySelectAmount')}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.amountChipText,
                        selected && styles.amountChipTextSelected,
                      ]}
                    >
                      {formatPrice(a)}
                    </Text>
                    <Text
                      style={[
                        styles.amountChipSub,
                        selected && styles.amountChipSubSelected,
                      ]}
                    >
                      {t('more.currency')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.customInputWrap, Boolean(customAmount) && styles.customInputWrapActive]}>
              <TextInput
                style={styles.customAmountInput}
                placeholder={t('topUp.amountPlaceholder')}
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                value={customAmount}
                maxLength={String(MAX_AMOUNT).length}
                onChangeText={(text) => setCustomAmount(text.replace(/[^\d]/g, ''))}
                accessibilityLabel={t('topUp.otherAmount')}
                accessibilityHint={t('topUp.a11yEnterAmount')}
              />
              <Text style={styles.customInputCurrency}>{t('more.currency')}</Text>
            </View>
          </View>

          {/* Payment methods card */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('topUp.paymentType')}</Text>
            {methodsLoading && methods.length === 0 ? (
              <Text style={styles.methodsNotice}>{t('topUp.loadingMethods')}</Text>
            ) : methodsError ? (
              <View style={styles.methodsErrorBox}>
                <Text style={styles.methodsErrorText}>{t('topUp.errMethodsLoad')}</Text>
                <TouchableOpacity
                  onPress={fetchMethods}
                  disabled={methodsLoading}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.retry')}
                >
                  <Text style={styles.methodsRetry}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.methods}>
                {methods.map(renderMethod)}
              </View>
            )}
          </View>

          {/* Card manual flow: show card number + screenshot upload */}
          {selectedMethod === 'card' && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>{t('topUp.step1')}</Text>
              <TouchableOpacity
                style={styles.cardNumberBox}
                onPress={copyCard}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardNumberLabel}>{t('topUp.cardNumber')}</Text>
                  <Text style={styles.cardNumberValue}>
                    {formatCardNumberDisplay(cardMethod?.card_number)}
                  </Text>
                  {!!cardMethod?.card_holder && (
                    <Text style={styles.cardHolder}>{cardMethod.card_holder}</Text>
                  )}
                </View>
                <View style={styles.copyBadge}>
                  <IconText
                    name="document"
                    size={14}
                    color={colors.primary}
                    textStyle={styles.copyBtn}
                  >
                    {t('topUp.copy')}
                  </IconText>
                </View>
              </TouchableOpacity>

              {!cardReady && !methodsLoading && (
                <View style={styles.noCardBox}>
                  <Text style={styles.noCardTitle}>{t('topUp.noCardTitle')}</Text>
                  <Text style={styles.noCardBody}>{t('topUp.noCardBody')}</Text>
                  <TouchableOpacity
                    onPress={fetchMethods}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                  >
                    <Text style={styles.methodsRetry}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.stepDivider} />

              <Text style={styles.sectionTitle}>{t('topUp.step2')}</Text>
              <Text style={styles.cardHint}>{t('topUp.cardHint')}</Text>

              {screenshot ? (
                <View style={styles.screenshotPreviewWrap}>
                  <Image source={{ uri: screenshot }} style={styles.screenshotPreview} />
                  <TouchableOpacity
                    style={styles.changeShotBtn}
                    onPress={pickScreenshot}
                    disabled={submitting}
                    activeOpacity={0.85}
                  >
                    <Icon name="camera" size={16} color={colors.primary} />
                    <Text style={styles.changeShotText}>{t('topUp.pickAnotherImage')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.uploadBtn}
                  onPress={pickScreenshot}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  <View style={styles.uploadIconCircle}>
                    <Icon name="camera" size={24} color={colors.primary} />
                  </View>
                  <Text style={styles.uploadText}>{t('topUp.uploadScreenshot')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>{t('topUp.payable')}</Text>
            <Text style={styles.footerAmount}>
              {formatPrice(getActualAmount())} {t('more.currency')}
            </Text>
          </View>
          <Button
            title={
              selectedMethod === 'card'
                ? submitting
                  ? t('topUp.sending')
                  : t('common.send')
                : loading
                ? '...'
                : t('topUp.pay')
            }
            onPress={handleTopUp}
            loading={loading || submitting}
            disabled={
              getActualAmount() < MIN_AMOUNT ||
              getActualAmount() > MAX_AMOUNT ||
              submitting ||
              (selectedMethod === 'card' && (!screenshot || !cardReady))
            }
            variant="primary"
            fullWidth={false}
            style={{ flex: 1, marginLeft: spacing.md }}
            accessibilityLabel={t(selectedMethod === 'card' ? 'topUp.a11yConfirmSend' : 'topUp.a11yStartPayment')}
            accessibilityHint={
              selectedMethod === 'card'
                ? t('topUp.a11ySubmitScreenshot')
                : t('topUp.a11yOpenProvider')
            }
          />
        </View>
      </KeyboardAvoidingView>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.h3, color: colors.text, fontWeight: '800' },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  balanceCard: {
    backgroundColor: '#0E172A',
    borderRadius: radius.xl,
    padding: spacing.lg,
    shadowColor: '#0E172A',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  balanceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  balanceIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 184, 0, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '600',
  },
  balanceValue: {
    ...typography.h1,
    fontSize: 28,
    lineHeight: 34,
    color: '#F5B800',
    fontWeight: '900',
    marginTop: 2,
  },
  balanceWarningWrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  balanceWarning: {
    ...typography.small,
    color: '#F5B800',
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  sectionTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  amountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
    marginBottom: spacing.sm,
  },
  amountChip: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  amountChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary100,
  },
  amountChipText: {
    ...typography.h3,
    fontSize: 17,
    color: colors.text,
    fontWeight: '800',
  },
  amountChipTextSelected: {
    color: colors.primary,
  },
  amountChipSub: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  amountChipSubSelected: {
    color: colors.primary,
  },
  customInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  customInputWrapActive: {
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  customAmountInput: {
    flex: 1,
    paddingVertical: 12,
    ...typography.bodyBold,
    color: colors.text,
  },
  customInputCurrency: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginLeft: spacing.xs,
  },
  methods: { gap: spacing.sm },
  methodsNotice: {
    ...typography.small,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  methodsErrorBox: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    gap: spacing.xs,
  },
  methodsErrorText: {
    ...typography.small,
    color: colors.error,
  },
  methodsRetry: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  noCardBox: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  noCardTitle: {
    ...typography.small,
    color: colors.error,
    fontWeight: '700',
  },
  noCardBody: {
    ...typography.small,
    color: colors.textSecondary,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  methodCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary100,
  },
  methodCardDisabled: { opacity: 0.5 },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  methodIconSelected: {
    backgroundColor: colors.white,
  },
  methodInfo: { flex: 1, marginRight: spacing.sm },
  methodName: { ...typography.bodyBold, color: colors.text, fontWeight: '800' },
  methodDesc: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  radioSelected: { borderColor: colors.primary },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  stepDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  cardNumberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    gap: spacing.sm,
  },
  cardNumberLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  cardNumberValue: {
    ...typography.h3,
    fontSize: 18,
    color: colors.text,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardHolder: { ...typography.small, color: colors.textSecondary, marginTop: 2, fontWeight: '600' },
  copyBadge: {
    backgroundColor: colors.primary100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  copyBtn: { ...typography.small, color: colors.primary, fontWeight: '800' },
  cardHint: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    gap: spacing.sm,
  },
  uploadIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  screenshotPreviewWrap: { alignItems: 'center', gap: spacing.sm },
  screenshotPreview: {
    width: '100%',
    height: 200,
    borderRadius: radius.lg,
    resizeMode: 'contain',
    backgroundColor: colors.surface,
  },
  changeShotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary100,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  changeShotText: { ...typography.small, color: colors.primary, fontWeight: '800' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  footerInfo: { flex: 0 },
  footerLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  footerAmount: { ...typography.h3, color: colors.primary, fontWeight: '900' },
});
