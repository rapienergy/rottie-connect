import { pgTable, text, serial, timestamp, json } from "drizzle-orm/pg-core";
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
    channel: 'whatsapp' | 'sms' | 'voice';
    profile?: {
      name?: string;
      avatar?: string;
    };
    recordingUrl?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

export type Message = typeof messages.$inferSelect;