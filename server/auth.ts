import { randomBytes, createHash } from "crypto";
import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@db";
import { users, verificationCodes, type User } from "@db/schema";
import { eq, and, gte } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio } from "twilio";

const JWT_SECRET = new TextEncoder().encode(process.env.REPL_ID || "rottie-connect-secret");
const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes

// Initialize Twilio client with error handling
let twilioClient: Twilio | null = null;
try {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Missing required Twilio credentials');
  } else {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log('Twilio client initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Twilio client:', error);
}

function formatWhatsAppNumber(phone: string): string {
  // Remove all non-digit characters except plus sign
  const cleaned = phone.replace(/[^\d+]/g, '');

  // If number already starts with "whatsapp:", return as is
  if (phone.startsWith('whatsapp:')) {
    return phone;
  }

  // If format is +5411... (Argentina), keep as is
  if (cleaned.startsWith('+54') && cleaned.length >= 12) {
    return `whatsapp:${cleaned}`;
  }

  // If no country code but has 10 digits, assume Argentina
  if (cleaned.length === 10) {
    return `whatsapp:+54${cleaned}`;
  }

  // If already has plus, just add whatsapp: prefix
  if (cleaned.startsWith('+')) {
    return `whatsapp:${cleaned}`;
  }

  // Default: add whatsapp: and + prefix
  return `whatsapp:+${cleaned}`;
}

export class AuthService {
  // Generate a random verification code
  private static generateVerificationCode(): string {
    if (process.env.NODE_ENV === 'development') {
      return '123456'; // Fixed code for testing
    }
    return randomBytes(3)
      .toString("hex")
      .toUpperCase()
      .slice(0, VERIFICATION_CODE_LENGTH);
  }

  // Hash password using Argon2
  private static async hashPassword(password: string): Promise<string> {
    try {
      return await argon2.hash(password);
    } catch (error) {
      console.error('Error hashing password:', error);
      throw error;
    }
  }

  // Verify password using Argon2
  private static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      console.log('Verifying password...');
      const result = await argon2.verify(hash, password);
      console.log('Password verification result:', result);
      return result;
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  }

  // Generate JWT token
  private static async generateToken(user: User): Promise<string> {
    return new SignJWT({ userId: user.id, username: user.username })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(JWT_SECRET);
  }

  // Send verification code via WhatsApp
  private static async sendVerificationCode(phoneNumber: string, code: string) {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      console.log('\n=== Sending WhatsApp Verification Code ===');
      console.log('Phone:', phoneNumber);
      console.log('Code:', code);

      // Skip actual WhatsApp sending in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Development mode: WhatsApp sending skipped');
        console.log('==========================\n');
        return true;
      }

      if (!process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('Messaging Service SID not configured');
      }

      // Format the number for WhatsApp
      const whatsappNumber = formatWhatsAppNumber(phoneNumber);
      console.log('Formatted WhatsApp number:', whatsappNumber);

      // Send message via Twilio Messaging Service
      const message = await twilioClient.messages.create({
        body: `Your RottieConnect verification code is: ${code}`,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: whatsappNumber
      });

      console.log('Verification WhatsApp sent:', message.sid);
      console.log('Message status:', message.status);
      console.log('From:', message.from);
      console.log('To:', message.to);
      console.log('==========================\n');
      return true;
    } catch (error: any) {
      console.error('\n=== WhatsApp Verification Error ===');
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo
      });
      console.error('==========================\n');
      return false;
    }
  }

  // Initialize the system with the default user
  static async initializeDefaultUser() {
    try {
      console.log('Initializing default user...');
      const hashedPassword = await this.hashPassword('R11r11r');
      console.log('Password hashed successfully');

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, 'ROTTIE'))
        .limit(1);

      if (existingUser) {
        console.log('Updating existing user...');
        await db
          .update(users)
          .set({
            password: hashedPassword,
            phoneNumber: '+5411125559311',
            isVerified: false
          })
          .where(eq(users.id, existingUser.id));
      } else {
        console.log('Creating new user...');
        await db
          .insert(users)
          .values({
            username: 'ROTTIE',
            password: hashedPassword,
            phoneNumber: '+5411125559311',
            isVerified: false
          });
      }
      console.log('Default user initialized/updated successfully');
    } catch (error) {
      console.error('Failed to initialize default user:', error);
      throw error;
    }
  }

  // Verify JWT token
  static async verifyToken(token: string) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return payload;
    } catch {
      return null;
    }
  }

  // Login user
  static async login(username: string, password: string) {
    console.log('Attempting login for username:', username);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      console.log('User not found');
      throw new Error("Invalid credentials");
    }

    console.log('User found, verifying password...');
    const isValid = await this.verifyPassword(user.password, password);
    console.log('Password validation result:', isValid);

    if (!isValid) {
      throw new Error("Invalid credentials");
    }

    // For verified users, return token immediately
    if (user.isVerified) {
      const token = await this.generateToken(user);
      return { user, token };
    }

    // For unverified users, generate new verification code
    const code = this.generateVerificationCode();
    console.log('Generated verification code:', code);

    await db.insert(verificationCodes).values({
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_CODE_EXPIRY),
    });

    await this.sendVerificationCode(user.phoneNumber, code);
    return { user, requiresVerification: true };
  }

  // Verify user's phone number
  static async verifyPhone(userId: number, code: string) {
    console.log('Verifying phone for user:', userId);
    console.log('Provided code:', code);

    const verificationCode = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.code, code),
        eq(verificationCodes.isUsed, false),
        gte(verificationCodes.expiresAt, new Date())
      ),
    });

    if (!verificationCode) {
      console.log('Verification failed: Invalid or expired code');
      throw new Error("Invalid or expired verification code");
    }

    console.log('Valid verification code found');

    // Mark code as used
    await db
      .update(verificationCodes)
      .set({ isUsed: true })
      .where(eq(verificationCodes.id, verificationCode.id));

    // Mark user as verified
    const [user] = await db
      .update(users)
      .set({ isVerified: true })
      .where(eq(users.id, userId))
      .returning();

    console.log('User verified successfully');
    const token = await this.generateToken(user);
    return { user, token };
  }

  // Request new verification code
  static async requestNewCode(userId: number) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("User not found");
    }

    const code = this.generateVerificationCode();
    await db.insert(verificationCodes).values({
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_CODE_EXPIRY),
    });

    await this.sendVerificationCode(user.phoneNumber, code);
    return true;
  }
}

// Initialize the default user when the module loads
AuthService.initializeDefaultUser().catch(console.error);