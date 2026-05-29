import { api } from './client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  answer: string;
  source: 'ai' | 'faq' | 'default';
}

export interface SupportInfo {
  telegram_username: string;
  telegram_url: string;
  bot_username: string;
  bot_url: string;
}

export async function askAi(messages: ChatMessage[]): Promise<ChatResponse> {
  const response = await api.post<ChatResponse>('/api/ai/chat', { messages });
  return response.data;
}

export async function getSupportInfo(): Promise<SupportInfo> {
  const response = await api.get<SupportInfo>('/api/support');
  return response.data;
}
