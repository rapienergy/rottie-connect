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

// Initialize Twilio client with error handling
let twilioClient;
try {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  );
  console.log('Twilio client initialized successfully');
} catch (error) {
  console.error('Failed to initialize Twilio client:', error);
  throw error;
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    verifyClient: (info: any) => {
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

  // Verify WhatsApp Business Profile and Configuration
  app.get("/api/twilio/status", async (_req, res) => {
    try {
      // Verify account and WhatsApp capabilities
      const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch();

      // Check if the number exists and get its capabilities
      const phoneNumbers = await twilioClient.incomingPhoneNumbers.list();
      const whatsappNumber = phoneNumbers.find(n => n.phoneNumber === process.env.TWILIO_PHONE_NUMBER);

      if (!whatsappNumber) {
        throw new Error('The specified phone number was not found in your Twilio account');
      }

      res.json({
        status: 'connected',
        friendlyName: account.friendlyName,
        whatsappNumber: process.env.TWILIO_PHONE_NUMBER,
        capabilities: whatsappNumber.capabilities
      });
    } catch (error: any) {
      console.error("Error verifying WhatsApp configuration:", error);
      res.status(500).json({
        status: 'error',
        message: error.message,
        code: error.code || 'WHATSAPP_CONFIGURATION_ERROR'
      });
    }
  });

  // Send WhatsApp message
  app.post("/api/messages", async (req, res) => {
    try {
      const { contactNumber, content } = req.body;

      // Format WhatsApp numbers
      const fromNumber = `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`;
      const toNumber = `whatsapp:${contactNumber}`;

      console.log('Attempting to send WhatsApp message:');
      console.log('From:', fromNumber);
      console.log('To:', toNumber);
      console.log('Content:', content);

      // Send message via Twilio WhatsApp API
      const twilioMessage = await twilioClient.messages.create({
        from: fromNumber,
        to: toNumber,
        body: content
      });

      console.log('Message sent successfully:', twilioMessage.sid);

      // Store message in database
      const message = await db
        .insert(messages)
        .values({
          contactNumber: contactNumber,
          content,
          direction: "outbound",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel: 'whatsapp'
          },
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.json(message[0]);
    } catch (error: any) {
      console.error("Error sending WhatsApp message:", error);
      res.status(500).json({
        message: "Failed to send message",
        error: error.message || 'Unknown error occurred',
        code: error.code
      });
    }
  });

  // Get all conversations
  app.get("/api/conversations", async (_req, res) => {
    try {
      console.log('Fetching WhatsApp messages from Twilio...');

      const twilioMessages = await twilioClient.messages.list({
        limit: 50
      });

      console.log(`Found ${twilioMessages.length} messages`);

      const conversations = twilioMessages
        .filter(msg => msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:'))
        .reduce((acc: any, msg: any) => {
          const contactNumber = (msg.to?.startsWith('whatsapp:') ? msg.from : msg.to)?.replace('whatsapp:', '');

          if (!acc[contactNumber]) {
            acc[contactNumber] = {
              contactNumber,
              latestMessage: {
                content: msg.body,
                direction: msg.direction,
                status: msg.status,
                createdAt: msg.dateCreated
              },
              channel: 'whatsapp'
            };
          } else if (new Date(msg.dateCreated) > new Date(acc[contactNumber].latestMessage.createdAt)) {
            acc[contactNumber].latestMessage = {
              content: msg.body,
              direction: msg.direction,
              status: msg.status,
              createdAt: msg.dateCreated
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
      const twilioMessages = await twilioClient.messages.list({
        limit: 50,
        to: `whatsapp:${contactNumber}`,
        from: `whatsapp:${contactNumber}`
      });

      const messages = twilioMessages
        .filter(msg => msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:'))
        .map(msg => ({
          id: msg.sid,
          contactNumber: (msg.to?.startsWith('whatsapp:') ? msg.from : msg.to)?.replace('whatsapp:', ''),
          content: msg.body || '',
          direction: msg.direction,
          status: msg.status,
          twilioSid: msg.sid,
          metadata: {
            channel: 'whatsapp'
          },
          createdAt: msg.dateCreated
        }));

      res.json(messages);
    } catch (error: any) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ 
        message: "Failed to fetch messages",
        error: error.message
      });
    }
  });

  // Twilio webhook for incoming messages
  app.post("/api/twilio/webhook", async (req, res) => {
    try {
      const {
        From,
        To,
        Body,
        MessageSid,
        ProfileName,
        WaId // WhatsApp ID
      } = req.body;

      console.log(`Received WhatsApp message from ${From} (${ProfileName || 'Unknown'})`);

      const message = await db
        .insert(messages)
        .values({
          contactNumber: formatWhatsAppNumber(From.replace('whatsapp:', '')),
          contactName: ProfileName || From.replace('whatsapp:', ''),
          content: Body,
          direction: "inbound",
          status: "delivered",
          twilioSid: MessageSid,
          metadata: {
            channel: 'whatsapp',
            profile: {
              name: ProfileName
            }
          },
        })
        .returning();

      console.log(`Stored incoming message with ID: ${message[0].id}`);
      broadcast({ type: "message_created", message: message[0] });
      res.status(200).send();
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  return httpServer;
}

function formatWhatsAppNumber(phoneNumber: string): string {
  // Remove any non-digit characters except plus sign
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');
  // Ensure there's exactly one plus sign at the start
  const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  // Always prefix with whatsapp: as required by Twilio WhatsApp Business API
  return `whatsapp:${formatted}`;
}