import { pgTable, text, serial, timestamp, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

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
      name?: string | null;
      avatar?: string | null;
    } | null;
    recordingUrl?: string | null;
    transcription?: string | null;
    callDuration?: number | null;
    emailSubject?: string | null;
    emailFrom?: string | null;
    emailTo?: string | null;
  }>().default({
    channel: 'whatsapp',
    profile: null
  }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  contactNumberIdx: index("contact_number_idx").on(table.contactNumber),
  twilioSidIdx: index("twilio_sid_idx").on(table.twilioSid),
  createdAtIdx: index("created_at_idx").on(table.createdAt)
}));

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;