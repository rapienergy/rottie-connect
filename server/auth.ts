import { randomBytes, createHash } from "crypto";
import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@db";
import { users, verificationCodes, type User } from "@db/schema";
import { eq, and, gte } from "drizzle-orm";
import twilio from "twilio";

const JWT_SECRET = new TextEncoder().encode(process.env.REPL_ID || "rottie-connect-secret");
const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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

  // Verify JWT token
  static async verifyToken(token: string) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return payload;
    } catch {
      return null;
    }
  }

  // Send verification code via SMS
  private static async sendVerificationCode(phoneNumber: string, code: string) {
    try {
      console.log('========================================');
      console.log('Verification code details:');
      console.log('Phone:', phoneNumber);
      console.log('Code:', code);
      console.log('========================================');

      // Skip actual SMS sending in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Development mode: SMS sending skipped');
        return true;
      }

      const message = await twilioClient.messages.create({
        body: `Your RottieConnect verification code is: ${code}`,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: phoneNumber
      });

      console.log('Verification SMS sent:', message.sid);
      return true;
    } catch (error) {
      console.error('Failed to send verification SMS:', error);
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
            phoneNumber: '+511125559311',
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
            phoneNumber: '+511125559311',
            isVerified: false
          });
      }
      console.log('Default user initialized/updated successfully');
    } catch (error) {
      console.error('Failed to initialize default user:', error);
      throw error;
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