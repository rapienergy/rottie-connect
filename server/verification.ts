import { randomInt } from 'crypto';
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";
import twilio from "twilio";

// Initialize Twilio client
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export class VerificationService {
  private static CODE_LENGTH = 6;
  private static CODE_EXPIRY_MINUTES = 5;
  private static MAX_ATTEMPTS = 3;
  private static COOLDOWN_MINUTES = 1;

  static generateCode(): string {
    // Generate a random 6-digit number (100000-999999)
    return randomInt(100000, 999999).toString().padStart(6, '0');
  }

  static async createVerification(phoneNumber: string): Promise<string> {
    // Clean phone number format
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');

    // Check for existing active verification
    const now = new Date();
    const existingVerification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.phoneNumber, cleanNumber),
        gt(verificationCodes.expiresAt, now)
      )
    });

    // If there's an existing verification, check cooldown
    if (existingVerification) {
      const cooldownEndTime = new Date(existingVerification.createdAt);
      cooldownEndTime.setMinutes(cooldownEndTime.getMinutes() + this.COOLDOWN_MINUTES);

      if (now < cooldownEndTime) {
        const waitMinutes = Math.ceil((cooldownEndTime.getTime() - now.getTime()) / (1000 * 60));
        throw new Error(`Please wait ${waitMinutes} minutes before requesting a new code`);
      }
    }

    // Generate new code
    const code = this.generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.CODE_EXPIRY_MINUTES);

    try {
      // Store new verification code
      await db.insert(verificationCodes).values({
        phoneNumber: cleanNumber,
        code,
        expiresAt,
        verified: false,
        attempts: 0
      });

      // Send verification code via WhatsApp if Twilio is configured
      if (twilioClient && process.env.TWILIO_MESSAGING_SERVICE_SID) {
        console.log('\n=== Sending Verification Code ===');
        console.log('To:', phoneNumber);
        console.log('Code:', code);

        // Format the phone number for WhatsApp
        const toNumber = `whatsapp:+${cleanNumber.replace(/^\+/, '')}`;

        const message = await twilioClient.messages.create({
          messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
          to: toNumber,
          body: `Your RottieConnect verification code is: ${code}\n\nThis code will expire in ${this.CODE_EXPIRY_MINUTES} minutes.`
        });

        console.log('Message sent successfully:', message.sid);
        console.log('==========================\n');
      } else {
        console.error('Twilio client or messaging service not configured');
      }

      return code;
    } catch (error) {
      console.error('Error sending verification code:', error);
      throw new Error('Failed to send verification code. Please try again later.');
    }
  }

  static async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const now = new Date();

    // Find active verification codes for this number
    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.phoneNumber, cleanNumber),
        gt(verificationCodes.expiresAt, now)
      )
    });

    if (!verification) {
      throw new Error('No active verification code found. Please request a new code.');
    }

    // Check if max attempts exceeded
    if (verification.attempts >= this.MAX_ATTEMPTS) {
      throw new Error(`Max attempts (${this.MAX_ATTEMPTS}) exceeded. Please request a new code.`);
    }

    // Verify the code
    if (verification.code !== code) {
      // Update attempts count
      const newAttempts = (verification.attempts || 0) + 1;
      await db
        .update(verificationCodes)
        .set({ 
          attempts: newAttempts,
          lastAttemptAt: now
        })
        .where(eq(verificationCodes.id, verification.id));

      const remainingAttempts = this.MAX_ATTEMPTS - newAttempts;
      throw new Error(`Invalid code. ${remainingAttempts} attempts remaining.`);
    }

    // Mark as verified
    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, verification.id));

    return true;
  }

  static isValidCode(code: string): boolean {
    // Validate code format (6 digits)
    return /^\d{6}$/.test(code);
  }
}