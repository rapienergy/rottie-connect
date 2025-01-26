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
  console.error('- TWILIO_MESSAGING_SERVICE_SID exists:', !!process.env.TWILIO_MESSAGING_SERVICE_SID);
}

export class VerificationService {
  private static CODE_LENGTH = CONFIG.VERIFICATION.CODE_LENGTH;
  private static CODE_EXPIRY_MINUTES = CONFIG.VERIFICATION.CODE_EXPIRY_MINUTES;
  private static MAX_ATTEMPTS = CONFIG.VERIFICATION.MAX_ATTEMPTS;
  private static COOLDOWN_MINUTES = CONFIG.VERIFICATION.COOLDOWN_MINUTES;

  static generateCode(): string {
    return randomInt(100000, 999999).toString().padStart(6, '0');
  }

  static async createVerification(phoneNumber: string): Promise<string> {
    try {
      console.log('\n=== Starting Verification Process ===');
      console.log('Original phone number:', phoneNumber);

      // Clean phone number format - ensure it has + prefix and proper format
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

      // Store new verification code
      await db.insert(verificationCodes).values({
        phoneNumber: formattedNumber,
        code,
        expiresAt,
        verified: false,
        attempts: 0
      });

      console.log('Verification code stored in database');

      // Send verification code via WhatsApp
      if (twilioClient && process.env.TWILIO_MESSAGING_SERVICE_SID) {
        // Remove the + prefix for WhatsApp number format
        const toNumber = `whatsapp:${formattedNumber}`;
        console.log('Sending WhatsApp message to:', toNumber);
        console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

        try {
          const message = await twilioClient.messages.create({
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            to: toNumber,
            body: `Your RottieConnect verification code is: ${code}\n\nThis code will expire in ${this.CODE_EXPIRY_MINUTES} minutes.`
          });

          console.log('Message sent successfully:', message.sid);
          console.log('Message status:', message.status);
          console.log('Message direction:', message.direction);
          console.log('Message from:', message.from);
          console.log('Message to:', message.to);
        } catch (error) {
          console.error('Error sending WhatsApp message:', error);
          throw new Error('Failed to send verification code via WhatsApp');
        }
      } else {
        console.error('Twilio configuration missing:');
        console.error('- TWILIO_ACCOUNT_SID exists:', !!process.env.TWILIO_ACCOUNT_SID);
        console.error('- TWILIO_AUTH_TOKEN exists:', !!process.env.TWILIO_AUTH_TOKEN);
        console.error('- TWILIO_MESSAGING_SERVICE_SID exists:', !!process.env.TWILIO_MESSAGING_SERVICE_SID);
        throw new Error('Messaging service not configured');
      }

      console.log('=== Verification Process Completed ===\n');
      return code;
    } catch (error) {
      console.error('Error in createVerification:', error);
      throw error;
    }
  }

  static async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    // Clean and format the phone number consistently
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
    const now = new Date();

    // Find active verification codes for this number
    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.phoneNumber, formattedNumber),
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
    return /^\d{6}$/.test(code);
  }
}