import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
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

  // Get all conversations (grouped messages by contact)
  app.get("/api/conversations", async (_req, res) => {
    try {
      const result = await db.query.messages.findMany({
        orderBy: desc(messages.createdAt),
      });

      // Group messages by contact number and get latest message
      const conversations = result.reduce((acc, message) => {
        if (!acc[message.contactNumber]) {
          acc[message.contactNumber] = {
            contactNumber: message.contactNumber,
            contactName: message.contactName,
            latestMessage: message,
            channel: message.metadata?.channel || 'whatsapp',
          };
        }
        return acc;
      }, {} as Record<string, any>);

      res.json(Object.values(conversations));
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Get messages for a specific conversation
  app.get("/api/conversations/:contactNumber/messages", async (req, res) => {
    try {
      const result = await db.query.messages.findMany({
        where: eq(messages.contactNumber, req.params.contactNumber),
        orderBy: desc(messages.createdAt),
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Send a message
  app.post("/api/messages", async (req, res) => {
    try {
      const { contactNumber, content } = req.body;

      const twilioMessage = await twilioClient.messages.create({
        body: content,
        to: `whatsapp:${contactNumber}`,
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      });

      const message = await db
        .insert(messages)
        .values({
          contactNumber,
          content,
          direction: "outbound",
          status: "sent",
          twilioSid: twilioMessage.sid,
          metadata: { channel: 'whatsapp' },
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.json(message[0]);
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Twilio webhook for incoming messages
  app.post("/api/twilio/webhook", async (req, res) => {
    try {
      const { From, Body, MessageSid, ProfileName } = req.body;

      const message = await db
        .insert(messages)
        .values({
          contactNumber: From.replace('whatsapp:', ''),
          contactName: ProfileName,
          content: Body,
          direction: "inbound",
          status: "delivered",
          twilioSid: MessageSid,
          metadata: {
            channel: 'whatsapp',
            profile: { name: ProfileName },
          },
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