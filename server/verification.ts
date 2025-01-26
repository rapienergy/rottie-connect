import { randomInt } from 'crypto';
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";
import twilio from "twilio";
import { CONFIG } from "./config";

// Initialize Twilio client with detailed logging
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

if (!twilioClient) {
  console.error('Twilio client initialization failed:');
  console.error('- TWILIO_ACCOUNT_SID exists:', !!process.env.TWILIO_ACCOUNT_SID);
  console.error('- TWILIO_AUTH_TOKEN exists:', !!process.env.TWILIO_AUTH_TOKEN);
  console.error('- TWILIO_PHONE_NUMBER exists:', !!process.env.TWILIO_PHONE_NUMBER);
}

export class VerificationService {
  private static CODE_LENGTH = CONFIG.VERIFICATION.CODE_LENGTH;
  private static CODE_EXPIRY_MINUTES = CONFIG.VERIFICATION.CODE_EXPIRY_MINUTES;
  private static MAX_ATTEMPTS = CONFIG.VERIFICATION.MAX_ATTEMPTS;
  private static COOLDOWN_MINUTES = CONFIG.VERIFICATION.COOLDOWN_MINUTES;

  // Test function to send a basic WhatsApp message
  static async sendTestMessage(toNumber: string): Promise<boolean> {
    try {
      console.log('\n=== Starting Test Message Send ===');

      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      // Clean and format the number
      const cleanNumber = toNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
      const whatsappNumber = `whatsapp:${formattedNumber}`;

      console.log('Sending to:', whatsappNumber);
      console.log('From:', `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`);

      const message = await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: whatsappNumber,
        body: 'Hello! This is a test message from RottieConnect.'
      });

      console.log('Message sent successfully!');
      console.log('Message SID:', message.sid);
      console.log('Status:', message.status);
      console.log('Error Code:', message.errorCode);
      console.log('Error Message:', message.errorMessage);
      console.log('=== Test Message Complete ===\n');

      return true;
    } catch (error: any) {
      console.error('Error sending test message:');
      console.error('Code:', error.code);
      console.error('Message:', error.message);
      console.error('More Info:', error.moreInfo);
      console.error('Status:', error.status);
      throw error;
    }
  }

  static generateCode(): string {
    return randomInt(100000, 999999).toString().padStart(6, '0');
  }

  static async createVerification(phoneNumber: string): Promise<string> {
    try {
      console.log('\n=== Starting Internal Verification Process ===');
      console.log('Phone number:', phoneNumber);

      // Clean phone number format
      const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
      console.log('Formatted phone number:', formattedNumber);

      // Check for existing active verification
      const now = new Date();
      const existingVerification = await db.query.verificationCodes.findFirst({
        where: and(
          eq(verificationCodes.phoneNumber, formattedNumber),
          gt(verificationCodes.expiresAt, now)
        )
      });

      // If there's an existing verification, check cooldown
      if (existingVerification) {
        const cooldownEndTime = new Date(existingVerification.createdAt);
        cooldownEndTime.setMinutes(cooldownEndTime.getMinutes() + this.COOLDOWN_MINUTES);

        if (now < cooldownEndTime) {
          const waitMinutes = Math.ceil((cooldownEndTime.getTime() - now.getTime()) / (1000 * 60));
          console.log(`Cooldown active. Wait time: ${waitMinutes} minutes`);
          throw new Error(`Please wait ${waitMinutes} minutes before requesting a new code`);
        }
      }

      // Generate new code
      const code = this.generateCode();
      console.log('Generated verification code:', code);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.CODE_EXPIRY_MINUTES);

      // Store verification code
      await db.insert(verificationCodes).values({
        phoneNumber: formattedNumber,
        code,
        expiresAt,
        verified: false,
        attempts: 0
      });

      console.log('Verification code stored successfully');
      console.log('*** FOR TESTING: Verification Code:', code, '***');
      console.log('=== Internal Verification Process Complete ===\n');

      return code;
    } catch (error) {
      console.error('Error in createVerification:', error);
      throw error;
    }
  }

  static async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
    const now = new Date();

    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.phoneNumber, formattedNumber),
        gt(verificationCodes.expiresAt, now)
      )
    });

    if (!verification) {
      throw new Error('No active verification code found. Please request a new code.');
    }

    if (verification.attempts >= this.MAX_ATTEMPTS) {
      throw new Error(`Max attempts (${this.MAX_ATTEMPTS}) exceeded. Please request a new code.`);
    }

    if (verification.code !== code) {
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

    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, verification.id));

    return true;
  }

  static isValidCode(code: string): boolean {
    return /^\d{6}$/.test(code);
  }
}