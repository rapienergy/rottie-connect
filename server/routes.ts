import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio } from "twilio";

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

// Format number for various channels
function formatPhoneNumber(phoneNumber: string, channel: 'whatsapp' | 'sms' | 'voice'): string {
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

  // Add whatsapp: prefix only for WhatsApp channel
  return channel === 'whatsapp' ? `whatsapp:${cleaned}` : cleaned;
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

  // Webhook handler for all channels
  app.post("/webhook", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      console.log('Received webhook request');
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      console.log('Body:', JSON.stringify(req.body, null, 2));

      // Validate Twilio signature
      const twilioSignature = req.headers['x-twilio-signature'];
      const webhookUrl = `https://rapienergy.live/webhook`;

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

      // Extract message details
      const {
        From,
        To,
        Body,
        MessageSid,
        ProfileName,
      } = req.body;

      // Determine channel type
      const isWhatsApp = From?.startsWith('whatsapp:') || To?.startsWith('whatsapp:');
      const channel = isWhatsApp ? 'whatsapp' : 'sms';
      const contactNumber = isWhatsApp ? From.replace('whatsapp:', '') : From;

      console.log(`Received ${channel} message from ${From}`);
      console.log('Message details:', { From, To, Body, MessageSid });

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
            channel,
            profile: {
              name: ProfileName
            }
          },
        })
        .returning();

      // Notify connected clients
      broadcast({ type: "message_created", message: message[0] });

      // Return TwiML response
      res.type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response></Response>
      `);
    } catch (error: any) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  });

  // Send message using Messaging Service (supports SMS, WhatsApp, etc.)
  app.post("/api/messages", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, content, channel = 'whatsapp' } = req.body;

      if (!contactNumber || !content) {
        throw new Error('Contact number and content are required');
      }

      // Format the destination number based on channel
      const toNumber = formatPhoneNumber(contactNumber, channel);

      console.log('Sending message via Messaging Service:');
      console.log('Channel:', channel);
      console.log('To:', toNumber);
      console.log('Content:', content);

      // Send message via Twilio Messaging Service
      const messagingOptions = {
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: content
      };

      const twilioMessage = await twilioClient.messages.create(messagingOptions);

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
            channel
          },
        })
        .returning();

      broadcast({ type: "message_created", message: message[0] });
      res.json(message[0]);
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({
        message: "Failed to send message",
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR'
      });
    }
  });

  // Get all conversations across channels
  app.get("/api/conversations", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }
      console.log('Fetching messages from Twilio...');

      const twilioMessages = await twilioClient.messages.list({
        limit: 50
      });

      console.log(`Found ${twilioMessages.length} messages`);

      const conversations = twilioMessages.reduce((acc: any, msg: any) => {
        const isWhatsApp = msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:');
        if (!isWhatsApp) return acc;

        const channel = 'whatsapp';
        const contactNumber = (msg.direction === 'inbound' ? msg.from : msg.to)?.replace('whatsapp:', '');

        if (!contactNumber) return acc;

        if (!acc[contactNumber] || new Date(msg.dateCreated) > new Date(acc[contactNumber].latestMessage.createdAt)) {
          acc[contactNumber] = {
            contactNumber,
            latestMessage: {
              content: msg.body,
              direction: msg.direction,
              status: msg.status,
              createdAt: msg.dateCreated
            },
            channel
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
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber } = req.params;
      const formattedWhatsApp = `whatsapp:${contactNumber}`;

      // Fetch messages for both directions (to/from this contact)
      const messages = await twilioClient.messages.list({
        limit: 100,
      });

      // Filter messages for this contact's WhatsApp conversation
      const contactMessages = messages.filter(msg => {
        const isWhatsAppMessage = msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:');
        if (!isWhatsAppMessage) return false;

        const normalizedTo = msg.to?.replace('whatsapp:', '');
        const normalizedFrom = msg.from?.replace('whatsapp:', '');

        return normalizedTo === contactNumber || normalizedFrom === contactNumber;
      });

      // Map and format messages
      const formattedMessages = contactMessages.map(msg => ({
        id: msg.sid,
        contactNumber: msg.direction === 'inbound' ? 
          msg.from?.replace('whatsapp:', '') :
          msg.to?.replace('whatsapp:', ''),
        content: msg.body || '',
        direction: msg.direction,
        status: msg.status,
        twilioSid: msg.sid,
        metadata: {
          channel: 'whatsapp',
          profile: {
            name: msg.direction === 'inbound' ? msg.from : msg.to
          }
        },
        createdAt: msg.dateCreated
      }));

      // Sort messages by date
      formattedMessages.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      console.log(`Found ${formattedMessages.length} messages for contact ${contactNumber}`);
      res.json(formattedMessages);
    } catch (error: any) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ 
        message: "Failed to fetch messages",
        error: error.message
      });
    }
  });

  // Get Messaging Service details
  app.get("/api/twilio/status", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      if (!messagingServiceSid) {
        throw new Error('Messaging Service SID not configured');
      }

      // Get Messaging Service details
      const service = await twilioClient.messaging.v1.services(messagingServiceSid).fetch();

      // Get phone numbers associated with the Messaging Service
      const phoneNumbers = await twilioClient.messaging.v1
        .services(messagingServiceSid)
        .phoneNumbers
        .list();

      const primaryNumber = phoneNumbers.find(num => num.phoneNumber.endsWith('6311'));

      res.json({
        status: "connected",
        friendlyName: service.friendlyName || 'Messaging Service',
        whatsappNumber: primaryNumber?.phoneNumber || undefined,
        inboundRequestUrl: service.inboundRequestUrl,
        useInboundWebhookOnNumber: service.useInboundWebhookOnNumber,
        channels: ['sms', 'whatsapp', 'voice']
      });
    } catch (error: any) {
      console.error("Messaging Service connection error:", error);
      res.status(500).json({
        status: 'error',
        message: error.message,
        code: error.code || 'MESSAGING_SERVICE_ERROR'
      });
    }
  });

  // Test Messaging Service configuration
  app.get("/api/twilio/test", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      if (!messagingServiceSid) {
        throw new Error('Messaging Service SID not configured');
      }

      // Get Messaging Service details
      const service = await twilioClient.messaging.v1.services(messagingServiceSid).fetch();

      // Get phone numbers associated with the Messaging Service
      const phoneNumbers = await twilioClient.messaging.v1
        .services(messagingServiceSid)
        .phoneNumbers
        .list();

      const primaryNumber = phoneNumbers.find(num => num.phoneNumber.endsWith('6311'));

      if (!primaryNumber) {
        throw new Error('Primary phone number not found in Messaging Service');
      }

      // Send test message using Messaging Service
      const testMessage = await twilioClient.messages.create({
        messagingServiceSid,
        to: primaryNumber.phoneNumber, // Send to our own number for testing
        body: "Test message from Messaging Service"
      });

      res.json({
        status: "success",
        service: {
          sid: service.sid,
          friendlyName: service.friendlyName,
          inboundRequestUrl: service.inboundRequestUrl
        },
        message: {
          sid: testMessage.sid,
          status: testMessage.status,
          from: testMessage.from,
          to: testMessage.to
        },
        phoneNumbers: phoneNumbers.map(num => ({
          sid: num.sid,
          phoneNumber: num.phoneNumber,
          capabilities: num.capabilities
        }))
      });
    } catch (error: any) {
      console.error("Messaging Service test failed:", error);
      res.status(500).json({
        status: 'error',
        message: error.message,
        code: error.code || 'TEST_FAILED'
      });
    }
  });

  return httpServer;
}