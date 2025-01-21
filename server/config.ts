// Production configuration constants for RottieConnect
// WARNING: These values should remain constant in production
// Changes to these values may affect existing verifications and user experience
export const CONFIG = {
  VERIFICATION: {
    // Test phone number for development and testing purposes
    TEST_PHONE_NUMBER: "+5215584277211", // Do not modify in production

    // Verification code settings
    CODE_LENGTH: 6, // Standard verification code length
    CODE_EXPIRY_MINUTES: 5, // Time before code expires
    MAX_ATTEMPTS: 3, // Maximum verification attempts per code
    COOLDOWN_MINUTES: 1, // Cooldown period between verification requests
  },
  SESSION: {
    MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours session duration
    COOKIE_NAME: "rottie-connect-session", // Session cookie identifier
  }
} as const;

// Using 'as const' ensures these values are read-only
// TypeScript will enforce that these values cannot be modified at runtime