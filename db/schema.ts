import { pgTable, text, serial, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  contactId: serial("contact_id").references(() => contacts.id),
  content: text("content").notNull(),
  direction: text("direction").notNull(), // 'inbound' or 'outbound'
  status: text("status").notNull(), // 'sent', 'delivered', 'failed'
  twilioSid: text("twilio_sid"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const twilioConfig = pgTable("twilio_config", {
  id: serial("id").primaryKey(),
  accountSid: text("account_sid").notNull(),
  authToken: text("auth_token").notNull(),
  phoneNumber: text("phone_number").notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  contact: one(contacts, {
    fields: [messages.contactId],
    references: [contacts.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  messages: many(messages),
}));

export const insertContactSchema = createInsertSchema(contacts);
export const selectContactSchema = createSelectSchema(contacts);
export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);
export const insertTwilioConfigSchema = createInsertSchema(twilioConfig);
export const selectTwilioConfigSchema = createSelectSchema(twilioConfig);

export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type TwilioConfig = typeof twilioConfig.$inferSelect;
