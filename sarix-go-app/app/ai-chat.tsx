import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { askAi, getSupportInfo, type ChatMessage } from '../src/api/ai';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

interface DisplayMessage extends ChatMessage {
  id: string;
  source?: 'ai' | 'faq' | 'default';
}

export default function AiChatScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: t('ai.welcome'),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [supportUrl, setSupportUrl] = useState('https://t.me/SarixGo_support_bot');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getSupportInfo()
      .then((info) => setSupportUrl(info.telegram_url))
      .catch(() => {});
  }, []);

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: DisplayMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    scrollToBottom();

    try {
      const history: ChatMessage[] = messages
        .filter((m) => m.id !== 'welcome')
        .slice(-5)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: text.trim() });

      const response = await askAi(history);
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: response.answer,
          source: response.source,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: t('ai.errorMessage'),
        },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  const openSupport = () => Linking.openURL(supportUrl);

  const suggestions = t('ai.suggestions', { returnObjects: true }) as string[];
  const showSuggestions = messages.length === 1;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.aiAvatar}>
            <Icon name="robot" size={20} color={colors.textOnPrimary} />
          </View>
          <View>
            <Text style={styles.title}>{t('ai.title')}</Text>
            <Text style={styles.subtitle}>{t('ai.subtitle')}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.humanBtn} onPress={openSupport}>
          <Icon name="profile" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.message,
                msg.role === 'user' ? styles.userMessage : styles.aiMessage,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  msg.role === 'user' && styles.userMessageText,
                ]}
              >
                {msg.content}
              </Text>
            </View>
          ))}

          {loading && (
            <View style={[styles.message, styles.aiMessage]}>
              <View style={styles.typing}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.typingText}>{t('ai.typing')}</Text>
              </View>
            </View>
          )}

          {showSuggestions && (
            <View style={styles.suggestions}>
              {suggestions.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={styles.suggestion}
                  onPress={() => sendMessage(s)}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('ai.placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            editable={!loading}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!input.trim() || loading) && styles.sendBtnDisabled,
            ]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <Icon name="send" size={18} color={colors.textOnPrimary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.needHumanBtn} onPress={openSupport}>
          <IconText
            name="profile"
            size={13}
            color={colors.primary}
            textStyle={styles.needHumanText}
          >
            {t('ai.needHuman')}
          </IconText>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aiAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...typography.bodyBold, color: colors.primary },
  subtitle: { ...typography.small, color: colors.textSecondary },
  humanBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  messages: { padding: spacing.md, paddingBottom: spacing.lg },
  message: {
    maxWidth: '85%',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  userMessage: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  messageText: { ...typography.body, color: colors.text, lineHeight: 22 },
  userMessageText: { color: colors.textOnPrimary },
  typing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typingText: { ...typography.caption, color: colors.textSecondary },
  suggestions: { marginTop: spacing.md, gap: spacing.sm },
  suggestion: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  suggestionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.text,
    maxHeight: 100,
    minHeight: 40,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  needHumanBtn: {
    backgroundColor: colors.primary,
    padding: spacing.sm,
    alignItems: 'center',
  },
  needHumanText: { ...typography.caption, color: colors.textOnPrimary, fontWeight: '600' },
});
