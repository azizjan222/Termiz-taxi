/**
 * Feature switches for the passenger app.
 *
 * These exist so a finished feature can be taken off the screen WITHOUT deleting it. The
 * alternative — ripping the code out and re-adding it later — loses every decision baked
 * into it and reopens bugs that were already fixed once.
 */

/**
 * Whether the passenger may see and spend their bonus wallet.
 *
 * Currently OFF at the owner's request: the bonus engine is finished and tested on the
 * server, but it should not be visible in the app yet.
 *
 * TO TURN IT BACK ON: set this to `true` and publish an OTA update to both channels
 * (`preview` and `production`). Nothing else is needed — no backend change, no rebuild,
 * no new translation keys. The strings (`order.useBonus`, `order.useBonusHint`,
 * `referral.walletLabel`, the whole `bonusHistory` block) are already present in all four
 * locales, and `POST /api/orders` already accepts `use_bonus`.
 *
 * WHAT THIS FLAG HIDES (passenger-facing entry points only):
 *   - the "Bonusdan foydalanish" toggle on both order screens, and the `use_bonus` field
 *     in the create-order payload, so no NEW order can ever spend bonus;
 *   - the wallet balance box and the bonus-history link on the referral screen.
 *
 * WHAT IT DELIBERATELY DOES *NOT* HIDE — and must not:
 *   - the bonus/promo discount rows and the `payable` total on the order-detail screen,
 *     in either app. Those are driven by what the SERVER reports for that order. An order
 *     accepted while the flag was still on has already had its wallet debited, and hiding
 *     the discount would show the passenger the gross fare — they would hand over the full
 *     amount in cash, losing the bonus and getting nothing for it. That exact bug is what
 *     the comment in app/order/[id].tsx is about, and a display switch must never
 *     reintroduce it. Once no order carries `use_bonus` any more, those rows simply stop
 *     appearing on their own.
 *   - anything on the server. The wallet keeps earning from rides and referrals, so no
 *     passenger loses bonus while the feature is hidden; it becomes spendable the moment
 *     this flag flips back.
 */
// Annotated `: boolean` rather than left to infer the literal type `false`. Without it
// TypeScript narrows every `BONUS_UI_ENABLED && ...` guard to the constant `false` and marks
// the code behind it unreachable — which is how a flag that is meant to be flipped back
// starts collecting dead-code warnings, and how an editor's "unused" hints tempt someone
// into deleting exactly the code this switch exists to preserve.
export const BONUS_UI_ENABLED: boolean = false;
