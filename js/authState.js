/**
 * authState.js -- User tier and authentication state management.
 *
 * Manages the freemium tier state:
 *   - 'free': default tier, watermarked STL, default settings only
 *   - 'pro': clean STL, STEP export, custom shrinkage + wall thickness
 *
 * For v1: Pro is enabled via localStorage override ('potteryAcademy_tier' = 'pro').
 * Future: Stripe subscription check.
 */

const STORAGE_KEYS = {
  EMAIL: 'potteryAcademy_email',
  TIER: 'potteryAcademy_tier',
  USER_ID: 'potteryAcademy_userId',
};

/**
 * Get the current user's subscription tier.
 * @returns {'free'|'pro'}
 */
export function getUserTier() {
  const tier = localStorage.getItem(STORAGE_KEYS.TIER);
  if (tier === 'pro') return 'pro';
  return 'free';
}

/**
 * Check if user has Pro subscription.
 * @returns {boolean}
 */
export function isPro() {
  return getUserTier() === 'pro';
}

/**
 * Check if user is on the free tier.
 * @returns {boolean}
 */
export function isFreeUser() {
  return !isPro();
}

/**
 * Get stored email address.
 * @returns {string|null}
 */
export function getStoredEmail() {
  return localStorage.getItem(STORAGE_KEYS.EMAIL) || null;
}

/**
 * Check if a user is logged in (has email stored).
 * @returns {boolean}
 */
export function isLoggedIn() {
  return !!localStorage.getItem(STORAGE_KEYS.EMAIL);
}
