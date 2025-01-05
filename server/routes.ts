import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { db } from "@db";
import { contacts, messages, twilioConfig } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import type { Twilio } from "twilio";
import twilio from "twilio";

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    verifyClient: (info) => {
      // Ignore Vite HMR WebSocket connections
      return info.req.headers['sec-websocket-protocol'] !== 'vite-hmr';
    }
  });

  // Broadcast to all clients
  const broadcast = (message: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(message));
      }
    });
  };

  // WebSocket connection handling
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });
  });

  // Contacts API
  app.get("/api/contacts", async (_req, res) => {
    try {
      const result = await db.query.contacts.findMany({
        orderBy: desc(contacts.updatedAt),
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const contact = await db.insert(contacts).values(req.body).returning();
      broadcast({ type: "contact_created", contact: contact[0] });
      res.json(contact[0]);
    } catch (error) {
      console.error("Error creating contact:", error);
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  // Messages API
  app.get("/api/messages/:contactId", async (req, res) => {
    try {
      const result = await db.query.messages.findMany({
        where: eq(messages.contactId, parseInt(req.params.contactId)),
        orderBy: desc(messages.createdAt),
        with: {
          contact: true,
        },
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const config = await db.query.twilioConfig.findFirst({
        where: eq(twilioConfig.active, true),
      });

      if (!config) {
        res.status(400).json({ message: "Twilio configuration not found" });
        return;
      }

      let twilioClient: Twilio;
      try {
        twilioClient = twilio(config.accountSid, config.authToken);
      } catch (error: any) {
        console.error("Twilio client initialization error:", error);
        res.status(500).json({ message: "Failed to initialize Twilio client" });
        return;
      }

      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, req.body.contactId),
      });

      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      const twilioMessage = await twilioClient.messages.create({
        body: req.body.content,
        to: contact.phone,
        from: config.phoneNumber,
      });

      const message = await db
        .insert(messages)
        .values({
          ...req.body,
          direction: "outbound",
          status: "sent",
          twilioSid: twilioMessage.sid,
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.json(message[0]);
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Twilio Config API
  app.get("/api/twilio/config", async (_req, res) => {
    try {
      const config = await db.query.twilioConfig.findFirst({
        where: eq(twilioConfig.active, true),
      });
      res.json(config || null);
    } catch (error) {
      console.error("Error fetching Twilio config:", error);
      res.status(500).json({ message: "Failed to fetch Twilio configuration" });
    }
  });

  // Add console logging to the Twilio config endpoint
  app.post("/api/twilio/config", async (req, res) => {
    try {
      console.log("Updating Twilio configuration...");

      // Deactivate existing config
      await db
        .update(twilioConfig)
        .set({ active: false })
        .where(eq(twilioConfig.active, true));

      // Insert new config
      const config = await db
        .insert(twilioConfig)
        .values({ 
          accountSid: process.env.TWILIO_ACCOUNT_SID || '',
          authToken: process.env.TWILIO_AUTH_TOKEN || '',
          phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
          active: true 
        })
        .returning();

      console.log("Twilio configuration updated successfully");
      res.json(config[0]);
    } catch (error) {
      console.error("Error updating Twilio config:", error);
      res.status(500).json({ message: "Failed to update Twilio configuration" });
    }
  });

  // Twilio webhook for incoming messages
  app.post("/api/twilio/webhook", async (req, res) => {
    try {
      const { From, Body, MessageSid } = req.body;

      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.phone, From),
      });

      if (!contact) {
        res.status(404).send("Contact not found");
        return;
      }

      const message = await db
        .insert(messages)
        .values({
          contactId: contact.id,
          content: Body,
          direction: "inbound",
          status: "delivered",
          twilioSid: MessageSid,
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.status(200).send();
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  return httpServer;
}