import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!, 
  process.env.TWILIO_AUTH_TOKEN!
);

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // WebSocket setup
  const clients = new Set<WebSocket>();
  const broadcast = (message: any) => {
    if (clients.size === 0) return;
    const messageStr = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
        } catch (error) {
          console.error('Error sending WebSocket message:', error);
          clients.delete(client);
        }
      }
    });
  };

  const wss = new WebSocketServer({ 
    server: httpServer,
    verifyClient: (info: any) => {
      return info.req.headers['sec-websocket-protocol'] !== 'vite-hmr';
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket client connected');
    clients.add(ws);

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });

  // WhatsApp message endpoint
  app.post("/api/messages", async (req, res) => {
    try {
      const { contactNumber, content } = req.body;

      if (!contactNumber || !content) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Contact number and content are required'
        });
      }

      const formattedNumber = contactNumber.startsWith('+') ? contactNumber : `+${contactNumber}`;

      console.log('Sending WhatsApp message:', {
        to: formattedNumber,
        content: content
      });

      const twilioMessage = await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:${formattedNumber}`,
        body: content
      });

      console.log('Message sent:', twilioMessage.sid);

      const [message] = await db
        .insert(messages)
        .values({
          contactNumber: formattedNumber,
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel: 'whatsapp',
            profile: null
          }
        })
        .returning();

      broadcast({
        type: "message_created",
        message
      });

      res.json({
        success: true,
        message: {
          ...message,
          twilioStatus: twilioMessage.status,
          twilioSid: twilioMessage.sid
        }
      });
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'MESSAGE_SEND_ERROR'
        }
      });
    }
  });

  // Webhook handler for message status updates
  app.post("/webhook", async (req, res) => {
    try {
      const { MessageSid, MessageStatus, From, To, Body } = req.body;
      console.log('Webhook received:', { MessageSid, MessageStatus, From, To, Body });

      if (MessageStatus) {
        broadcast({
          type: "message_status_updated",
          message: {
            twilioSid: MessageSid,
            status: MessageStatus,
            contactNumber: From?.replace('whatsapp:', '')
          }
        });
      } else if (Body) {
        const [message] = await db
          .insert(messages)
          .values({
            contactNumber: From.replace('whatsapp:', ''),
            content: Body,
            direction: "inbound",
            status: "received",
            twilioSid: MessageSid,
            metadata: {
              channel: 'whatsapp',
              profile: null
            },
          })
          .returning();

        broadcast({
          type: "message_created",
          message
        });
      }

      res.sendStatus(200);
    } catch (error: any) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  // Get all conversations
  app.get("/api/conversations", async (_req, res) => {
    try {
      console.log('Fetching messages from database...');
      const dbMessages = await db.select().from(messages).orderBy(desc(messages.createdAt));

      const conversations = dbMessages.reduce((acc: any, msg: any) => {
        if (!acc[msg.contactNumber]) {
          acc[msg.contactNumber] = {
            contactNumber: msg.contactNumber,
            contactName: msg.contactName,
            messages: [],
            channel: msg.metadata.channel || 'whatsapp'
          };
        }
        acc[msg.contactNumber].messages.push(msg);
        return acc;
      }, {});

      res.json(Object.values(conversations));
    } catch (error: any) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({
        message: "Failed to fetch conversations",
        error: error.message
      });
    }
  });

  // Get messages for a specific conversation
  app.get("/api/conversations/:contactNumber/messages", async (req, res) => {
    try {
      const { contactNumber } = req.params;
      console.log(`Fetching messages for ${contactNumber}`);

      const dbMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.contactNumber, contactNumber))
        .orderBy(desc(messages.createdAt));

      res.json({
        messages: dbMessages,
        stats: {
          total: dbMessages.length,
          sent: dbMessages.filter(m => m.direction === 'rottie').length,
          received: dbMessages.filter(m => m.direction === 'inbound').length,
          firstInteraction: dbMessages[dbMessages.length - 1]?.createdAt,
          lastInteraction: dbMessages[0]?.createdAt,
        }
      });
    } catch (error: any) {
      console.error("Error fetching messages:", error);
      res.status(500).json({
        message: "Failed to fetch messages",
        error: error.message
      });
    }
  });

  return httpServer;
}