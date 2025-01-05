import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio, MessageInstance } from "twilio/lib/rest/api/v2010/account/message";

// Initialize Twilio client with error handling
let twilioClient: Twilio | null = null;
try {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Missing required Twilio credentials');
  } else {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log('Twilio client initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Twilio client:', error);
}

// Format WhatsApp number
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

  // Add whatsapp: prefix
  return `whatsapp:${cleaned}`;
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

  // Webhook handler for WhatsApp messages
  app.post("/webhook", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      console.log('Received webhook request');
      console.log('Body:', JSON.stringify(req.body, null, 2));

      // Validate Twilio signature
      const twilioSignature = req.headers['x-twilio-signature'];
      // Use actual host from request for webhook URL
      const webhookUrl = `${req.protocol}://${req.get('host')}/webhook`;

      if (!twilioSignature || !process.env.TWILIO_AUTH_TOKEN) {
        console.error('Missing Twilio signature or auth token');
        return res.status(403).send('Forbidden: Missing signature or auth token');
      }

      const isValid = twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        twilioSignature as string,
        webhookUrl,
        req.body
      );

      if (!isValid) {
        console.error('Invalid Twilio signature');
        return res.status(403).send('Forbidden: Invalid signature');
      }

      const {
        From,
        To,
        Body,
        MessageSid,
        ProfileName,
      } = req.body;

      // Only process WhatsApp messages
      if (!From?.startsWith('whatsapp:')) {
        return res.type('text/xml').send('<Response></Response>');
      }

      const contactNumber = From.replace('whatsapp:', '');
      console.log(`Received WhatsApp message from ${From}`);

      // Store message in database
      const message = await db
        .insert(messages)
        .values({
          contactNumber,
          contactName: ProfileName || undefined,
          content: Body,
          direction: "inbound",
          status: "delivered",
          twilioSid: MessageSid,
          metadata: {
            channel: 'whatsapp' as const,
            profile: {
              name: ProfileName
            }
          },
        })
        .returning();

      // Notify connected clients in real-time
      broadcast({ 
        type: "message_created", 
        message: message[0],
        contactNumber
      });

      res.type('text/xml').send('<Response></Response>');
    } catch (error: any) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  // Send WhatsApp message
  app.post("/api/messages", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, content } = req.body;

      if (!contactNumber || !content) {
        throw new Error('Contact number and content are required');
      }

      // Format the destination number for WhatsApp
      const toNumber = formatWhatsAppNumber(contactNumber);
      console.log('Sending WhatsApp message to:', toNumber);

      // Send message via Twilio
      const twilioMessage = await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: toNumber,
        body: content
      });

      console.log('Message sent successfully:', twilioMessage.sid);

      // Store message in database
      const message = await db
        .insert(messages)
        .values({
          contactNumber,
          content,
          direction: "outbound",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel: 'whatsapp' as const
          },
        })
        .returning();

      broadcast({ 
        type: "message_created", 
        message: message[0],
        contactNumber 
      });

      res.json(message[0]);
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({
        message: "Failed to send message",
        error: error.message
      });
    }
  });

  // Get all WhatsApp conversations
  app.get("/api/conversations", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      console.log('Fetching WhatsApp conversations...');

      // Fetch WhatsApp messages
      const twilioMessages = await twilioClient.messages.list({
        limit: 100
      });

      // Filter and group WhatsApp messages
      const conversations = twilioMessages
        .filter(msg => msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:'))
        .reduce((acc: any, msg: MessageInstance) => {
          const contactNumber = (msg.direction === 'inbound' ? 
            msg.from?.replace('whatsapp:', '') : 
            msg.to?.replace('whatsapp:', ''))?.replace(/^\+/, '');

          const profile = msg.direction === 'inbound' ? {
            name: (msg as any).profileName as string | undefined
          } : undefined;

          if (!acc[contactNumber]) {
            acc[contactNumber] = {
              contactNumber: `+${contactNumber}`,
              contactName: profile?.name,
              latestMessage: {
                id: msg.sid,
                content: msg.body,
                direction: msg.direction,
                status: msg.status,
                createdAt: msg.dateCreated,
                channel: 'whatsapp' as const
              }
            };
          } else if (new Date(msg.dateCreated) > new Date(acc[contactNumber].latestMessage.createdAt)) {
            acc[contactNumber].latestMessage = {
              id: msg.sid,
              content: msg.body,
              direction: msg.direction,
              status: msg.status,
              createdAt: msg.dateCreated,
              channel: 'whatsapp' as const
            };
          }
          return acc;
        }, {});

      // Sort conversations by latest message date
      const sortedConversations = Object.values(conversations).sort((a: any, b: any) => 
        new Date(b.latestMessage.createdAt).getTime() - new Date(a.latestMessage.createdAt).getTime()
      );

      res.json(sortedConversations);
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
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber } = req.params;
      console.log(`Fetching WhatsApp messages for contact: ${contactNumber}`);

      // Format WhatsApp number for querying
      const whatsappNumber = formatWhatsAppNumber(contactNumber);

      // Fetch WhatsApp message history
      const messages = await twilioClient.messages.list({
        limit: 100,
        to: whatsappNumber,
        from: whatsappNumber
      });

      const formattedMessages = messages
        .filter(msg => msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:'))
        .map(msg => ({
          id: msg.sid,
          contactNumber: msg.direction === 'inbound' ? 
            msg.from?.replace('whatsapp:', '') : 
            msg.to?.replace('whatsapp:', ''),
          content: msg.body || '',
          direction: msg.direction,
          status: msg.status,
          twilioSid: msg.sid,
          metadata: {
            channel: 'whatsapp' as const,
            profile: msg.direction === 'inbound' ? {
              name: (msg as any).profileName as string | undefined
            } : undefined
          },
          createdAt: msg.dateCreated
        }));

      // Sort messages chronologically
      const sortedMessages = formattedMessages.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      res.json(sortedMessages);
    } catch (error: any) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ 
        message: "Failed to fetch messages",
        error: error.message
      });
    }
  });

  // Get Twilio Service Status
  app.get("/api/twilio/status", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      // Get WhatsApp capable number
      const whatsappNumber = process.env.TWILIO_PHONE_NUMBER;

      res.json({
        status: "connected",
        friendlyName: "WhatsApp Messaging",
        whatsappNumber: whatsappNumber ? `+${whatsappNumber}` : undefined
      });
    } catch (error: any) {
      console.error("Twilio connection error:", error);
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  });


  // Test Messaging Service configuration
  app.get("/api/twilio/test", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }
      const message = await twilioClient.messages.create({
        body: 'Test message from Twilio',
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+15558675310`
      });
      res.json({ message: 'Test message sent successfully', sid: message.sid });
    } catch (error: any) {
      console.error("Error sending test message:", error);
      res.status(500).json({ message: 'Failed to send test message', error: error.message });
    }
  });

  return httpServer;
}