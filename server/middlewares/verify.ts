import { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";
import { validatePhoneNumber } from "../lib/validation";

const VERIFY_EXEMPT_PATHS = [
  '/api/verify/send',
  '/api/verify/check',
  '/api/test-verification',
  '/webhook',
  '/api-docs',
  '/api/twilio/status',  // Allow status checks without verification
  '/api/twilio/test'     // Allow testing without verification
];

export async function verifyTwoStep(req: Request, res: Response, next: NextFunction) {
  try {
    // Skip verification for exempt paths and development mode
    if (VERIFY_EXEMPT_PATHS.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Skip verification in development mode only for testing endpoints
    if (process.env.NODE_ENV === 'development' && (
      req.path.startsWith('/api/test') || 
      req.path === '/webhook'
    )) {
      return next();
    }

    const phoneNumber = req.headers['x-phone-number'] as string;
    const verificationCode = req.headers['x-verification-code'] as string;

    if (!phoneNumber || !verificationCode) {
      return res.status(401).json({
        error: true,
        code: 'VERIFICATION_REQUIRED',
        message: 'Two-step verification required. Please include x-phone-number and x-verification-code headers.',
        details: {
          missingHeaders: {
            phoneNumber: !phoneNumber,
            verificationCode: !verificationCode
          }
        }
      });
    }

    // Validate phone number format
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        error: true,
        code: 'INVALID_PHONE_FORMAT',
        message: phoneValidation.error,
        details: {
          providedNumber: phoneNumber
        }
      });
    }

    const now = new Date();
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');

    // Check for valid verification code
    const [verification] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phoneNumber, cleanNumber),
          eq(verificationCodes.code, verificationCode),
          eq(verificationCodes.verified, true),
          gt(verificationCodes.expiresAt, now)
        )
      )
      .limit(1);

    if (!verification) {
      return res.status(401).json({
        error: true,
        code: 'INVALID_VERIFICATION',
        message: 'Invalid or expired verification code. Please request a new verification code.',
        details: {
          reason: 'Code not found or expired'
        }
      });
    }

    // Store verified phone number in request for later use
    req.headers['verified-phone'] = cleanNumber;
    next();
  } catch (error: any) {
    console.error('Verification middleware error:', error);
    res.status(500).json({
      error: true,
      code: 'VERIFICATION_ERROR',
      message: 'Error during verification process',
      details: error.message
    });
  }
}