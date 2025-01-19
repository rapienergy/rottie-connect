export const CONFIG = {
  VERIFICATION: {
    TEST_PHONE_NUMBER: "+5215584277211", // Number to receive verification codes
    CODE_LENGTH: 6,
    CODE_EXPIRY_MINUTES: 5,
    MAX_ATTEMPTS: 3,
    COOLDOWN_MINUTES: 15,
  },
  SESSION: {
    MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
    COOKIE_NAME: "rottie-connect-session",
  }
} as const;
