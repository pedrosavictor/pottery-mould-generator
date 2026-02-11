/**
 * Supabase Client Module
 * Handles database operations for email gate
 *
 * SECURITY: This module only uses INSERT operations.
 * SELECT/UPDATE are disabled via RLS to prevent email enumeration.
 * Kit API is the source of truth for email verification.
 */

// Supabase configuration (shared Pottery Academy project)
const SUPABASE_URL = 'https://ktkvfcjbrdxpqakrcuad.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0a3ZmY2picmR4cHFha3JjdWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5ODg1MTEsImV4cCI6MjA4MzU2NDUxMX0.E3ErXd3TkEZkI9gzczxXLAuKxiGAjJK_vJVLDkRf2sU';

let supabaseClient = null;

/**
 * Initialize Supabase client (lazy loading)
 */
function getSupabase() {
  if (!supabaseClient) {
    if (typeof window.supabase === 'undefined') {
      console.error('Supabase library not loaded');
      return null;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

/**
 * Wrap an async operation with consistent error handling
 * @param {string} operation - Name of operation for logging
 * @param {Function} fn - Async function to execute
 * @returns {Promise<{success: boolean, error?: string, data?: any}>}
 */
async function withErrorHandling(operation, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Exception in ${operation}:`, err);
    return { success: false, error: err.message || 'An error occurred' };
  }
}

/**
 * Check if running in local development (skip backend calls)
 * @returns {boolean}
 */
function isLocalDev() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/**
 * Create a new user in the database
 * NOTE: This only INSERTs - we cannot SELECT to check if user exists (security)
 * Duplicate emails will fail silently, which is intentional to prevent enumeration
 *
 * @param {string} email - User's email address
 * @param {string} firstName - User's first name (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createUser(email, firstName = '') {
  if (isLocalDev()) {
    console.log('Local development: skipping createUser');
    return { success: true };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database not available' };
  }

  return withErrorHandling('createUser', async () => {
    const userData = {
      email: email.toLowerCase().trim(),
      email_verified: false
    };

    if (firstName) {
      userData.first_name = firstName.trim();
    }

    const { error } = await supabase.from('users').insert(userData);

    if (error) {
      // Unique violation means user already exists - return success to prevent enumeration
      if (error.code === '23505') {
        console.log('User already exists (not revealing to client)');
        return { success: true };
      }
      console.error('Error creating user:', error);
      return { success: false, error: 'Database error' };
    }

    return { success: true };
  });
}

/**
 * Log a download for analytics
 * NOTE: Only INSERTs to downloads table - no user updates (security)
 *
 * @param {string} email - User's email for analytics tracking
 * @param {object} templateData - Template/mould configuration data
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function logDownload(email, templateData) {
  if (isLocalDev()) {
    console.log('Local development: skipping logDownload');
    return { success: true };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database not available' };
  }

  return withErrorHandling('logDownload', async () => {
    const { error } = await supabase.from('downloads').insert({
      email: email?.toLowerCase().trim() || null,
      template_data: templateData
    });

    if (error) {
      console.error('Error logging download:', error);
    }

    // Always return success - don't block download on logging failure
    return { success: true };
  });
}

/**
 * Kit (ConvertKit) API configuration
 *
 * SECURITY: api_key is used for form subscriptions (public endpoint, acceptable)
 * Subscriber verification is done via Edge Function (api_secret stays server-side)
 */
const KIT_API_KEY = 'Zg7qUWZ12D2zGZg0yovECw';
const KIT_FORM_ID = '8957739';

const KIT_TAGS = {
  TEMPLATE_GENERATOR: 14280842,
  MOULD_GENERATOR: 14280842  // Same tag, different app context
};

/**
 * Subscribe user to Kit form (triggers double opt-in)
 * @param {string} email - User's email
 * @param {string} firstName - User's first name (optional)
 * @returns {Promise<{success: boolean, subscriberId?: string, error?: string}>}
 */
export async function subscribeToKitForm(email, firstName = '') {
  if (isLocalDev()) {
    console.log('Local development: skipping subscribeToKitForm');
    return { success: true, subscriberId: 'local-dev' };
  }

  return withErrorHandling('subscribeToKitForm', async () => {
    const requestBody = {
      api_key: KIT_API_KEY,
      email: email.toLowerCase().trim()
    };

    if (firstName) {
      requestBody.first_name = firstName.trim();
    }

    const tagIds = Object.values(KIT_TAGS).filter(id => id !== null);
    if (tagIds.length > 0) {
      requestBody.tags = tagIds;
    }

    const response = await fetch(`https://api.convertkit.com/v3/forms/${KIT_FORM_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Kit subscription failed:', errorData);
      return { success: false, error: errorData.message || 'Subscription failed' };
    }

    const data = await response.json();
    console.log('Kit subscription response:', data);

    return {
      success: true,
      subscriberId: data.subscription?.subscriber?.id?.toString()
    };
  });
}

/**
 * Verify subscriber status via Edge Function
 * SECURITY: Uses Edge Function to keep api_secret server-side
 * @param {string} email - User's email to verify
 * @returns {Promise<{success: boolean, verified: boolean, subscriberId?: string, error?: string}>}
 */
export async function verifyKitSubscriber(email) {
  if (isLocalDev()) {
    console.log('Local development: skipping verifyKitSubscriber');
    return { success: true, verified: true };
  }

  return withErrorHandling('verifyKitSubscriber', async () => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/kit-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ email: email.toLowerCase().trim() })
    });

    if (!response.ok) {
      console.error('Kit verification Edge Function failed:', response.status);
      return { success: false, verified: false, error: 'Failed to verify with Kit' };
    }

    const data = await response.json();
    console.log('Kit verification response:', data);

    return {
      success: data.success,
      verified: data.verified || false,
      subscriberId: data.subscriberId,
      state: data.state,
      error: data.error
    };
  });
}
