import { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";
import { validatePhoneNumber } from "../lib/validation";

const VERIFY_EXEMPT_PATHS = [
  '/api/verify/send',
  '/api/verify/check',
  '/api/test-verification'
];

const ROTTIE_API_KEY = process.env.ROTTIE_API_KEY;

export async function verifyTwoStep(req: Request, res: Response, next: NextFunction) {
  try {
    // Skip verification for exempt paths and development mode
    if (VERIFY_EXEMPT_PATHS.some(path => req.path.startsWith(path)) || 
        process.env.NODE_ENV === 'development') {
      return next();
    }

    // Check for ROTTIE API key first
    const rottieApiKey = req.headers['x-rottie-api-key'] as string;
    if (!rottieApiKey || rottieApiKey !== ROTTIE_API_KEY) {
      return res.status(401).json({
        error: true,
        code: 'INVALID_API_KEY',
        message: 'Invalid or missing ROTTIE API key'
      });
    }

    const phoneNumber = req.headers['x-phone-number'] as string;
    const verificationCode = req.headers['x-verification-code'] as string;

    if (!phoneNumber || !verificationCode) {
      return res.status(401).json({
        error: true,
        code: 'VERIFICATION_REQUIRED',
        message: 'Two-step verification required. Please include x-phone-number and x-verification-code headers.'
      });
    }

    // Validate phone number format
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        error: true,
        code: 'INVALID_PHONE_FORMAT',
        message: phoneValidation.error
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
        message: 'Invalid or expired verification code.'
      });
    }

    req.headers['verified-phone'] = cleanNumber;
    next();
  } catch (error: any) {
    console.error('Verification middleware error:', error);
    res.status(500).json({
      error: true,
      code: 'VERIFICATION_ERROR',
      message: 'Error during verification process'
    });
  }
}