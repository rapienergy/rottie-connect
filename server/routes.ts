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

// Format number for WhatsApp Business API
function formatWhatsAppNumber(phoneNumber: string): string {
  if (!phoneNumber) return '';

  // Remove all non-digit characters except plus sign
  let cleaned = phoneNumber.replace(/[^\d+]/g, '');

  // Ensure number starts with + and country code
  if (!cleaned.startsWith('+')) {
    // For US numbers, add +1
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  // Add whatsapp: prefix for Business API
  return `whatsapp:${cleaned}`;
}

async function verifyWhatsAppBusinessProfile() {
  try {
    // Get account information
    const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch();

    // Get WhatsApp-enabled phone numbers
    const phoneNumbers = await twilioClient.incomingPhoneNumbers.list();
    const businessNumber = phoneNumbers.find(n => 
      n.phoneNumber === process.env.TWILIO_PHONE_NUMBER || 
      n.phoneNumber === formatWhatsAppNumber(process.env.TWILIO_PHONE_NUMBER!)
    );

    if (!businessNumber) {
      throw new Error('WhatsApp Business number not found in your Twilio account');
    }

    // Verify messaging service configuration
    const messagingServices = await twilioClient.messaging.v1.services.list();
    const whatsappService = messagingServices.find(s => 
      s.inboundRequestUrl?.includes('whatsapp') || 
      s.fallbackUrl?.includes('whatsapp')
    );

    return {
      status: 'connected',
      accountType: account.type,
      businessProfile: {
        friendlyName: businessNumber.friendlyName,
        phoneNumber: businessNumber.phoneNumber,
        whatsappEnabled: !!whatsappService,
        capabilities: businessNumber.capabilities
      }
    };
  } catch (error: any) {
    console.error('Error verifying WhatsApp Business profile:', error);
    throw new Error(`WhatsApp Business verification failed: ${error.message}`);
  }
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

  // Verify WhatsApp Business Profile status
  app.get("/api/twilio/status", async (_req, res) => {
    try {
      const profile = await verifyWhatsAppBusinessProfile();
      res.json(profile);
    } catch (error: any) {
      console.error("WhatsApp Business API connection error:", error);
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

      if (!contactNumber || !content) {
        throw new Error('Contact number and content are required');
      }

      // Verify WhatsApp Business profile before sending
      await verifyWhatsAppBusinessProfile();

      // Format the numbers for WhatsApp Business API
      const fromNumber = formatWhatsAppNumber(process.env.TWILIO_PHONE_NUMBER!);
      const toNumber = formatWhatsAppNumber(contactNumber);

      console.log('Sending WhatsApp message:');
      console.log('From:', fromNumber);
      console.log('To:', toNumber);
      console.log('Content:', content);

      // Send message via Twilio WhatsApp Business API
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
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details || undefined
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