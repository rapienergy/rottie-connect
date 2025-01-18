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
    return randomBytes(3)
      .toString("hex")
      .toUpperCase()
      .slice(0, VERIFICATION_CODE_LENGTH);
  }

  // Hash password using Argon2
  private static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  // Verify password using Argon2
  private static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
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
      const hashedPassword = await this.hashPassword('R11r11r');
      await db
        .insert(users)
        .values({
          username: 'ROTTIE',
          password: hashedPassword,
          phoneNumber: '+549112559311',
          isVerified: false
        })
        .onConflictDoUpdate({
          target: users.username,
          set: { password: hashedPassword }
        });
      console.log('Default user initialized/updated successfully');
    } catch (error) {
      console.error('Failed to initialize default user:', error);
    }
  }

  // Register a new user
  static async register(username: string, password: string, phoneNumber: string) {
    // Check if user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (existingUser) {
      throw new Error("Username already exists");
    }

    const existingPhone = await db.query.users.findFirst({
      where: eq(users.phoneNumber, phoneNumber),
    });

    if (existingPhone) {
      throw new Error("Phone number already registered");
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Create user
    const [user] = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        phoneNumber,
        isVerified: false,
      })
      .returning();

    // Generate and store verification code
    const code = this.generateVerificationCode();
    await db.insert(verificationCodes).values({
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_CODE_EXPIRY),
    });

    // Send verification code
    await this.sendVerificationCode(phoneNumber, code);

    return user;
  }

  // Login user
  static async login(username: string, password: string) {
    console.log('Attempting login for username:', username);

    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!user) {
      console.log('User not found');
      throw new Error("Invalid credentials");
    }

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
    const verificationCode = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.code, code),
        eq(verificationCodes.isUsed, false),
        gte(verificationCodes.expiresAt, new Date())
      ),
    });

    if (!verificationCode) {
      throw new Error("Invalid or expired verification code");
    }

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
AuthService.initializeDefaultUser();