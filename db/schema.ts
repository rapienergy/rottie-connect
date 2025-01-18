import { pgTable, text, serial, timestamp, json, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

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
  // Add indexes for faster queries
  contactNumberIdx: index("contact_number_idx").on(table.contactNumber),
  twilioSidIdx: index("twilio_sid_idx").on(table.twilioSid),
  createdAtIdx: index("created_at_idx").on(table.createdAt)
}));

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

export type Message = typeof messages.$inferSelect;

export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  phoneNumberIdx: index("phone_number_idx").on(table.phoneNumber),
}));

export const insertVerificationSchema = createInsertSchema(verificationCodes);
export const selectVerificationSchema = createSelectSchema(verificationCodes);