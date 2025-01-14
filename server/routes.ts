import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio } from "twilio";

// Initialize Twilio client
let twilioClient: Twilio | null = null;

try {
  if (!process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Missing Twilio credentials');
  } else {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('Twilio client initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Twilio client:', error);
}

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

  // Message endpoints
  app.post("/api/messages", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, content } = req.body;

      if (!contactNumber || !content) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Contact number and content are required',
            code: 'MISSING_REQUIRED_FIELDS'
          }
        });
      }

      const toNumber = `whatsapp:${contactNumber}`;
      console.log('\n=== Sending WhatsApp message ===');
      console.log('To:', toNumber);
      console.log('Content:', content);

      const messagingOptions = {
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: toNumber,
        body: content,
        statusCallback: `${process.env.BASE_URL}/webhook`,
        persistentAction: ['status_callback'],
      };

      const twilioMessage = await twilioClient.messages.create(messagingOptions);
      console.log('Message sent successfully:', twilioMessage.sid);

      const [message] = await db
        .insert(messages)
        .values({
          contactNumber,
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
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

      res.json({
        success: true,
        message: {
          ...message,
          twilioStatus: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          to: twilioMessage.to,
          from: twilioMessage.from
        }
      });
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'MESSAGE_SEND_ERROR',
          details: error.details || {}
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
            latestMessage: {
              content: msg.content,
              direction: msg.direction,
              status: msg.status,
              createdAt: msg.createdAt
            },
            channel: msg.metadata.channel || 'whatsapp'
          };
        } else if (new Date(msg.createdAt) > new Date(acc[msg.contactNumber].latestMessage.createdAt)) {
          acc[msg.contactNumber].latestMessage = {
            content: msg.content,
            direction: msg.direction,
            status: msg.status,
            createdAt: msg.createdAt
          };
        }
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