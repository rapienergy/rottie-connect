import { randomInt } from 'crypto';
import { db } from "@db";
import { verificationCodes } from "@db/schema";
import { and, eq, gt } from "drizzle-orm";

export class VerificationService {
  private static CODE_LENGTH = 6;
  private static CODE_EXPIRY_MINUTES = 5;

  static generateCode(): string {
    return randomInt(100000, 999999).toString();
  }

  static async createVerification(phoneNumber: string): Promise<string> {
    // Clean phone number format
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    
    // Generate new code
    const code = this.generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.CODE_EXPIRY_MINUTES);

    // Store in database
    await db.insert(verificationCodes).values({
      phoneNumber: cleanNumber,
      code,
      expiresAt,
      verified: false
    });

    return code;
  }

  static async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    const cleanNumber = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const now = new Date();

    // Find valid code
    const [verification] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phoneNumber, cleanNumber),
          eq(verificationCodes.code, code),
          eq(verificationCodes.verified, false),
          gt(verificationCodes.expiresAt, now)
        )
      )
      .limit(1);

    if (!verification) {
      return false;
    }

    // Mark as verified
    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, verification.id));

    return true;
  }
}
