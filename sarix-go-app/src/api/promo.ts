import { api } from './client';

export interface PromoValidation {
  valid: boolean;
  discount_amount: number;
  discount_percent: number;
}

export interface ReferralInfo {
  referral_code: string;
  referral_link: string;
  referred_count: number;
  referral_count: number;
  bonus_earned: number;
  bonus_balance: number;
}

export async function validatePromo(code: string): Promise<PromoValidation> {
  const r = await api.post<PromoValidation>('/api/promo/validate', { code });
  return r.data;
}

export async function getReferralInfo(): Promise<ReferralInfo> {
  const r = await api.get<ReferralInfo>('/api/referral');
  return r.data;
}

export async function applyReferralCode(code: string): Promise<{
  success: boolean;
  your_bonus: number;
  referrer_name: string;
}> {
  const r = await api.post('/api/referral/apply', { code });
  return r.data;
}
