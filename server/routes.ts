import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { db } from "@db";
import { contacts, messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import type { Twilio } from "twilio";
import twilio from "twilio";

// Validate required Twilio environment variables
const requiredEnvVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is required`);
  }
}

// Initialize Twilio client once
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    verifyClient: (info: any) => {
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
        from: process.env.TWILIO_PHONE_NUMBER,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, // Optional: for multi-channel messaging
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

  // Twilio webhook for incoming messages (SMS, WhatsApp)
  app.post("/api/twilio/webhook", async (req, res) => {
    try {
      const { From, Body, MessageSid, Channel = 'sms' } = req.body;

      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.phone, From),
      });

      if (!contact) {
        console.warn(`Received message from unknown contact: ${From}`);
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
          metadata: { channel: Channel },
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.status(200).send();
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  // Twilio webhook for voice calls
  app.post("/api/twilio/voice", (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for calling RAPIENERGY. Please leave a message after the tone.');
    twiml.record({
      action: '/api/twilio/recording',
      maxLength: 30,
      playBeep: true,
    });
    res.type('text/xml');
    res.send(twiml.toString());
  });

  // Handle recorded voice messages
  app.post("/api/twilio/recording", async (req, res) => {
    try {
      const { From, RecordingUrl, RecordingSid } = req.body;

      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.phone, From),
      });

      if (!contact) {
        console.warn(`Received voice message from unknown contact: ${From}`);
        res.status(404).send("Contact not found");
        return;
      }

      const message = await db
        .insert(messages)
        .values({
          contactId: contact.id,
          content: `Voice message: ${RecordingUrl}`,
          direction: "inbound",
          status: "delivered",
          twilioSid: RecordingSid,
          metadata: { type: 'voice', recordingUrl: RecordingUrl },
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.status(200).send();
    } catch (error) {
      console.error("Error processing voice recording:", error);
      res.status(500).send("Internal server error");
    }
  });

  return httpServer;
}