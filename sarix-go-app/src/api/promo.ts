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
  /** Amounts come from admin settings, so the screen must not hardcode them. */
  referrer_bonus: number;
  new_user_bonus: number;
  new_user_max_rides: number;
  /** True once this user has been linked to a referrer. */
  has_referrer: boolean;
  /**
   * Whether entering a friend's code can still succeed.
   *
   * False once the user has a referrer OR has completed a ride — the server applies both
   * guards, and showing an input that can only return an error is worse than hiding it.
   */
  can_apply_code: boolean;
}

export async function validatePromo(code: string): Promise<PromoValidation> {
  const r = await api.post<PromoValidation>('/api/promo/validate', { code });
  return r.data;
}

export async function getReferralInfo(): Promise<ReferralInfo> {
  const r = await api.get<ReferralInfo>('/api/referral');
  return r.data;
}

export interface ApplyReferralResult {
  success: boolean;
  referrer_name: string;
  /** Bonus the invited passenger earns per qualifying ride — NOT credited yet. */
  new_user_bonus: number;
  new_user_max_rides: number;
  message: string;
}

/**
 * Link this account to a friend's code.
 *
 * Grants nothing on its own: the server links only, and both bonuses are paid after the
 * invited passenger completes a ride. The previous return type claimed a `your_bonus` field
 * that the endpoint has never sent, which would have rendered as `undefined` in any UI that
 * trusted it.
 */
export async function applyReferralCode(code: string): Promise<ApplyReferralResult> {
  const r = await api.post<ApplyReferralResult>('/api/referral/apply', { code });
  return r.data;
}
