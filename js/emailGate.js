/**
 * Email Gate Module
 * Manages email collection modal and download permissions
 * for the Pottery Mould Generator.
 */

import { createUser, logDownload, subscribeToKitForm, verifyKitSubscriber } from './supabaseClient.js';

// LocalStorage keys
const STORAGE_KEYS = {
  USER_ID: 'potteryAcademy_userId',
  EMAIL: 'potteryAcademy_email',
  VERIFIED: 'potteryAcademy_verified',
  SUBMITTED_AT: 'potteryAcademy_submittedAt'
};

// Module state
let modalCallback = null;
let elements = {};

/**
 * Initialize the email gate module.
 * Call this after DOM is loaded.
 */
export function initEmailGate() {
  elements = {
    modal: document.getElementById('email-modal'),
    modalOverlay: document.querySelector('#email-modal .modal-overlay'),
    modalClose: document.getElementById('modal-close'),
    modalCloseVerify: document.getElementById('modal-close-verify'),
    emailForm: document.getElementById('email-form'),
    firstNameInput: document.getElementById('modal-first-name'),
    emailInput: document.getElementById('modal-email'),
    emailError: document.getElementById('email-error'),
    submitBtn: document.querySelector('#email-form button[type="submit"]'),
    btnCheckVerified: document.getElementById('btn-check-verified'),
    btnResendVerify: document.getElementById('btn-resend-verify'),
    btnChangeEmail: document.getElementById('btn-change-email'),
    verifyMessage: document.getElementById('verify-message')
  };

  if (elements.modalClose) {
    elements.modalClose.addEventListener('click', hideEmailModal);
  }
  if (elements.modalCloseVerify) {
    elements.modalCloseVerify.addEventListener('click', hideEmailModal);
  }
  if (elements.modalOverlay) {
    elements.modalOverlay.addEventListener('click', hideEmailModal);
  }
  if (elements.emailForm) {
    elements.emailForm.addEventListener('submit', handleEmailSubmit);
  }
  if (elements.btnCheckVerified) {
    elements.btnCheckVerified.addEventListener('click', handleCheckVerified);
  }
  if (elements.btnResendVerify) {
    elements.btnResendVerify.addEventListener('click', handleResendFromVerifyView);
  }
  if (elements.btnChangeEmail) {
    elements.btnChangeEmail.addEventListener('click', handleChangeEmail);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modal && !elements.modal.classList.contains('hidden')) {
      hideEmailModal();
    }
  });

  console.log('Email gate initialized');
}

/**
 * Check if user can download.
 * Uses Kit API for SECURE verification.
 * @returns {Promise<{canDownload: boolean, userId?: string, email?: string, verified?: boolean, needsVerification?: boolean}>}
 */
export async function checkEmailGate() {
  // Bypass email gate for local development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('Local development: bypassing email gate');
    return { canDownload: true, userId: 'local-dev', email: 'dev@localhost', verified: true };
  }

  const storedEmail = localStorage.getItem(STORAGE_KEYS.EMAIL);
  const storedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
  const storedVerified = localStorage.getItem(STORAGE_KEYS.VERIFIED) === 'true';

  if (!storedEmail) {
    return { canDownload: false };
  }

  // If verified locally, allow download
  if (storedVerified) {
    return {
      canDownload: true,
      userId: storedUserId,
      email: storedEmail,
      verified: true
    };
  }

  // Check Kit API for verification status
  try {
    const kitResult = await verifyKitSubscriber(storedEmail);
    if (kitResult.success && kitResult.verified) {
      localStorage.setItem(STORAGE_KEYS.VERIFIED, 'true');
      return {
        canDownload: true,
        userId: storedUserId,
        email: storedEmail,
        verified: true
      };
    }
  } catch (err) {
    console.error('Error checking Kit verification:', err);
  }

  // User exists but not verified
  if (storedUserId) {
    return {
      canDownload: false,
      needsVerification: true,
      userId: storedUserId,
      email: storedEmail,
      verified: false
    };
  }

  return { canDownload: false };
}

/**
 * Show the modal with a specific view.
 * @param {'signup'|'verify'} view
 * @param {Function} onSuccess
 * @param {string} [email]
 */
function showModal(view, onSuccess, email = null) {
  modalCallback = onSuccess;
  if (!elements.modal) return;

  const signupView = document.getElementById('modal-signup-view');
  const verifyView = document.getElementById('modal-verify-view');

  const isSignup = view === 'signup';
  if (signupView) signupView.classList.toggle('hidden', !isSignup);
  if (verifyView) verifyView.classList.toggle('hidden', isSignup);

  if (!isSignup && email) {
    const emailDisplay = document.getElementById('verify-email-display');
    if (emailDisplay) emailDisplay.textContent = email;
  }

  elements.modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    elements.modal.classList.add('show');
  });

  if (isSignup && elements.emailInput) {
    setTimeout(() => elements.emailInput.focus(), 100);
  }

  document.body.style.overflow = 'hidden';
}

/**
 * Show the email collection modal (for new users).
 * @param {Function} onSuccess - Callback when email is successfully submitted
 */
export function showEmailModal(onSuccess) {
  showModal('signup', onSuccess);
}

/**
 * Show the verification required modal (for returning unverified users).
 * @param {string} email
 * @param {Function} onSuccess
 */
export function showVerifyModal(email, onSuccess) {
  showModal('verify', onSuccess, email);
}

/**
 * Hide the email modal.
 */
export function hideEmailModal() {
  if (!elements.modal) return;

  elements.modal.classList.remove('show');
  setTimeout(() => {
    elements.modal.classList.add('hidden');
  }, 300);

  document.body.style.overflow = '';

  if (elements.emailForm) {
    elements.emailForm.reset();
  }
  hideError();
}

/**
 * Handle email form submission.
 * @param {Event} e
 */
async function handleEmailSubmit(e) {
  e.preventDefault();

  const firstName = elements.firstNameInput?.value?.trim() || '';
  const email = elements.emailInput?.value?.trim();

  if (!validateEmail(email)) {
    showError('Please enter a valid email address');
    return;
  }

  setLoading(true);

  try {
    const result = await createUser(email, firstName);

    if (!result.success) {
      showError(result.error || 'Failed to save email. Please try again.');
      setLoading(false);
      return;
    }

    const clientId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    localStorage.setItem(STORAGE_KEYS.USER_ID, clientId);
    localStorage.setItem(STORAGE_KEYS.EMAIL, email);
    localStorage.setItem(STORAGE_KEYS.VERIFIED, 'false');
    localStorage.setItem(STORAGE_KEYS.SUBMITTED_AT, new Date().toISOString());

    // Subscribe to Kit (async, non-blocking)
    subscribeToKitForm(email, firstName)
      .then(kitResult => {
        if (kitResult.success) {
          console.log('Kit subscription initiated, subscriber ID:', kitResult.subscriberId);
        }
      })
      .catch(err => {
        console.error('Failed to subscribe to Kit:', err);
      });

    hideEmailModal();

    // First download is free (no verification required)
    if (modalCallback) {
      modalCallback({ userId: clientId, email, verified: false });
    }
  } catch (err) {
    console.error('Error submitting email:', err);
    showError('An error occurred. Please try again.');
  } finally {
    setLoading(false);
  }
}

/**
 * Validate email format.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showError(message) {
  if (elements.emailError) {
    elements.emailError.textContent = message;
    elements.emailError.classList.remove('hidden');
  }
}

function hideError() {
  if (elements.emailError) {
    elements.emailError.classList.add('hidden');
    elements.emailError.textContent = '';
  }
}

function setLoading(loading) {
  if (elements.submitBtn) {
    elements.submitBtn.disabled = loading;
    elements.submitBtn.textContent = loading ? 'Submitting...' : 'Download Mould Files';
  }
}

/**
 * Handle "I've Confirmed - Check Now" button.
 */
async function handleCheckVerified() {
  if (elements.btnCheckVerified) {
    elements.btnCheckVerified.disabled = true;
    elements.btnCheckVerified.textContent = 'Checking...';
  }

  try {
    const result = await checkVerificationNow();

    if (result.verified) {
      showVerifyMessage(result.message, 'success');
      setTimeout(() => {
        hideEmailModal();
        if (modalCallback) {
          const userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
          const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
          modalCallback({ userId, email, verified: true });
        }
      }, 1500);
    } else {
      showVerifyMessage(result.message, 'error');
    }
  } catch (err) {
    console.error('Error checking verification:', err);
    showVerifyMessage('Could not check status. Please try again.', 'error');
  } finally {
    if (elements.btnCheckVerified) {
      elements.btnCheckVerified.disabled = false;
      elements.btnCheckVerified.textContent = "I've Confirmed - Check Now";
    }
  }
}

/**
 * Resend verification email from verify modal.
 */
async function handleResendFromVerifyView() {
  const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
  if (!email) return;

  if (elements.btnResendVerify) {
    elements.btnResendVerify.disabled = true;
    elements.btnResendVerify.textContent = 'Sending...';
  }

  try {
    const kitResult = await subscribeToKitForm(email);
    if (kitResult.success) {
      showVerifyMessage('Verification email sent! Check your inbox (and spam folder).', 'success');
    } else {
      showVerifyMessage('Could not send email. Please try again.', 'error');
    }
  } catch (err) {
    console.error('Error resending verification:', err);
    showVerifyMessage('An error occurred. Please try again.', 'error');
  } finally {
    if (elements.btnResendVerify) {
      elements.btnResendVerify.disabled = false;
      elements.btnResendVerify.textContent = 'Resend Verification Email';
    }
  }
}

/**
 * Check if user is now verified via Kit API.
 * @returns {Promise<{verified: boolean, message: string}>}
 */
export async function checkVerificationNow() {
  const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
  if (!email) {
    return { verified: false, message: 'No email found' };
  }

  try {
    const kitResult = await verifyKitSubscriber(email);
    if (kitResult.success && kitResult.verified) {
      localStorage.setItem(STORAGE_KEYS.VERIFIED, 'true');
      return { verified: true, message: 'Email verified! You can now download mould files.' };
    }

    return {
      verified: false,
      message: `Not verified yet. Please check your inbox and click the confirmation link.`
    };
  } catch (err) {
    console.error('Error checking verification:', err);
    return { verified: false, message: 'Could not check verification status. Please try again.' };
  }
}

/**
 * Handle change email - switch to signup view.
 */
function handleChangeEmail() {
  clearStoredUser();

  const signupView = document.getElementById('modal-signup-view');
  const verifyView = document.getElementById('modal-verify-view');
  if (signupView) signupView.classList.remove('hidden');
  if (verifyView) verifyView.classList.add('hidden');

  if (elements.emailInput) {
    setTimeout(() => elements.emailInput.focus(), 100);
  }

  hideVerifyMessage();
}

function showVerifyMessage(message, type) {
  if (elements.verifyMessage) {
    elements.verifyMessage.textContent = message;
    elements.verifyMessage.className = `verify-message ${type}`;
    elements.verifyMessage.classList.remove('hidden');
  }
}

function hideVerifyMessage() {
  if (elements.verifyMessage) {
    elements.verifyMessage.classList.add('hidden');
    elements.verifyMessage.textContent = '';
  }
}

/**
 * Log a download for analytics.
 * @param {object} templateData - Mould configuration
 */
export async function trackDownload(templateData) {
  try {
    const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
    await logDownload(email, templateData);
  } catch (err) {
    console.error('Error tracking download:', err);
  }
}

/**
 * Clear stored user data.
 */
export function clearStoredUser() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
}

/**
 * Get stored user info.
 * @returns {object|null}
 */
export function getStoredUser() {
  const userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
  const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
  if (!email) return null;

  return {
    userId,
    email,
    verified: localStorage.getItem(STORAGE_KEYS.VERIFIED) === 'true',
    submittedAt: localStorage.getItem(STORAGE_KEYS.SUBMITTED_AT)
  };
}
