import { pgTable, text, serial, timestamp, boolean, integer, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// Messages table definition
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  contactNumber: text("contact_number").notNull(),
  contactName: text("contact_name"),
  content: text("content").notNull(),
  direction: text("direction").notNull(), // 'inbound' or 'outbound'
  status: text("status").notNull(), // 'sent', 'delivered', 'failed'
  twilioSid: text("twilio_sid"),
  metadata: json("metadata").$type<{
    channel: 'whatsapp' | 'sms' | 'voice' | 'mail';
    profile?: {
      name?: string;
      avatar?: string;
    };
    recordingUrl?: string;
    transcription?: string;
    callDuration?: number;
    emailSubject?: string;
    emailFrom?: string;
    emailTo?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  contactNumberIdx: index("contact_number_idx").on(table.contactNumber),
  twilioSidIdx: index("twilio_sid_idx").on(table.twilioSid),
  createdAtIdx: index("created_at_idx").on(table.createdAt)
}));

// Users table for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  phoneNumber: text("phone_number").unique().notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Verification codes table for 2FA
export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isUsed: boolean("is_used").default(false).notNull(),
});

// Schema types and exports
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const insertVerificationCodeSchema = createInsertSchema(verificationCodes);
export const selectVerificationCodeSchema = createSelectSchema(verificationCodes);
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type InsertVerificationCode = typeof verificationCodes.$inferInsert;

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;