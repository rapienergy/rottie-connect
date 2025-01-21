import { randomInt } from 'crypto';
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";
import twilio from "twilio";
import { CONFIG } from "./config";

// Initialize Twilio client with better error handling
const initTwilioClient = () => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('ERROR: Twilio credentials missing');
    return null;
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('Twilio client initialized successfully');
    return client;
  } catch (error) {
    console.error('ERROR: Failed to initialize Twilio client:', error);
    return null;
  }
};

const twilioClient = initTwilioClient();

export class VerificationService {
  private static CODE_LENGTH = CONFIG.VERIFICATION.CODE_LENGTH;
  private static CODE_EXPIRY_MINUTES = CONFIG.VERIFICATION.CODE_EXPIRY_MINUTES;
  private static MAX_ATTEMPTS = CONFIG.VERIFICATION.MAX_ATTEMPTS;
  private static COOLDOWN_MINUTES = CONFIG.VERIFICATION.COOLDOWN_MINUTES;

  static generateCode(): string {
    return randomInt(100000, 999999).toString().padStart(6, '0');
  }

  static async createVerification(phoneNumber: string): Promise<string> {
    console.log('\n=== Starting Verification Process ===');
    console.log('Phone Number:', phoneNumber);

    // Clean phone number format
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    console.log('Cleaned Phone Number:', cleanNumber);

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
        console.log(`Cooldown active. Wait time: ${waitMinutes} minutes`);
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
        console.log('Attempting to send verification code via Twilio');

        try {
          // Ensure the number starts with a + and remove any existing WhatsApp: prefix
          const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
          const toNumber = `whatsapp:${formattedNumber}`;

          console.log('Sending to:', toNumber);
          console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

          const message = await twilioClient.messages.create({
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            to: toNumber,
            body: `Your RottieConnect verification code is: ${code}\n\nThis code will expire in ${this.CODE_EXPIRY_MINUTES} minutes.`
          });

          console.log('Message sent successfully:', message.sid);
          console.log('Message status:', message.status);
        } catch (twilioError: any) {
          console.error('Twilio Error:', twilioError.code, twilioError.message);
          console.error('Full error:', twilioError);
          throw new Error(`Failed to send verification code: ${twilioError.message}`);
        }
      } else {
        console.error('Twilio client or messaging service not properly configured');
        console.error('TWILIO_MESSAGING_SERVICE_SID exists:', !!process.env.TWILIO_MESSAGING_SERVICE_SID);
        console.error('twilioClient exists:', !!twilioClient);
        throw new Error('Messaging service not configured. Please contact support.');
      }

      console.log('=== Verification Process Completed ===\n');
      return code;
    } catch (error) {
      console.error('Error in createVerification:', error);
      throw error;
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