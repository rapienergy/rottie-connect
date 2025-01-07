import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";
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

// Optimize phone number formatting with a single regex
const phoneNumberRegex = /^\+?1?\d{10,11}$/;
function formatPhoneNumber(phoneNumber: string, channel: 'whatsapp' | 'sms' | 'voice' | 'mail'): string {
  if (!phoneNumber) return '';

  // Remove all non-digit characters except plus sign
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');

  // Ensure number starts with + and country code
  const formatted = !cleaned.startsWith('+')
    ? (cleaned.length === 10 ? `+1${cleaned}` : `+${cleaned}`)
    : cleaned;

  // Add channel-specific prefix
  switch (channel) {
    case 'whatsapp':
      return `whatsapp:${formatted}`;
    case 'voice':
      return formatted;
    case 'mail':
      return formatted;
    default:
      return formatted;
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

  // Optimize WebSocket client tracking with Set
  const clients = new Set<WebSocket>();

  // Optimize broadcast with single stringification
  const broadcast = (message: any) => {
    if (clients.size === 0) return; // Skip if no clients

    const messageStr = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  };

  // WebSocket connection handler with improved error handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket client connected');
    clients.add(ws);

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    const cleanup = () => {
      clients.delete(ws);
      console.log('WebSocket client disconnected');
    };

    ws.on('close', cleanup);
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      cleanup();
    });
  });

  // Optimized webhook handler with improved validation and testing support
  app.post("/webhook", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const start = Date.now();
      console.log('Received webhook request');
      console.log('Webhook payload:', JSON.stringify(req.body, null, 2));

      // Always skip signature validation during local development
      const isDevEnvironment = app.get('env') === 'development';
      console.log('Environment:', app.get('env'), 'Development mode:', isDevEnvironment);

      if (!isDevEnvironment) {
        const twilioSignature = req.headers['x-twilio-signature'];
        const webhookUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/webhook`;

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
      }

      const {
        From,
        To,
        Body,
        MessageSid,
        ProfileName,
        MessageStatus,
        CallStatus,
        CallSid,
        RecordingUrl,
        TranscriptionText,
        CallDuration,
        Direction,
        ForwardedFrom,
        AccountSid,
        ApiVersion
      } = req.body;

      // Enhanced logging for call events
      if (CallSid) {
        console.log('\n=== WhatsApp Call Event ===');
        console.log('Call SID:', CallSid);
        console.log('Status:', CallStatus);
        console.log('From:', From);
        console.log('To:', To);
        console.log('Duration:', CallDuration);
        console.log('Direction:', Direction);
        if (ForwardedFrom) console.log('Forwarded From:', ForwardedFrom);
        if (RecordingUrl) console.log('Recording URL:', RecordingUrl);
        if (TranscriptionText) console.log('Transcription:', TranscriptionText);
        console.log('API Version:', ApiVersion);
        console.log('Account SID:', AccountSid);
        console.log('==========================\n');

        try {
          // Store call event in database
          const message = await db
            .insert(messages)
            .values({
              contactNumber: From?.replace('whatsapp:', '') || '',
              content: `WhatsApp Call - ${CallStatus} - Duration: ${CallDuration || 0}s`,
              direction: Direction || "inbound",
              status: CallStatus || 'unknown',
              twilioSid: CallSid,
              metadata: {
                channel: 'voice',
                callDuration: parseInt(CallDuration || '0'),
                recordingUrl: RecordingUrl,
                transcription: TranscriptionText,
                profile: {
                  name: ProfileName
                }
              },
            })
            .returning();

          // Broadcast call event to connected clients
          broadcast({
            type: "call_event",
            call: {
              ...message[0],
              createdAt: new Date().toISOString()
            }
          });

          console.log(`Processed WhatsApp call event in ${Date.now() - start}ms`);
          console.log('Call details stored:', message[0]);
        } catch (err) {
          console.error('Failed to process call event:', err);
        }

        // Return TwiML response for calls
        return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Thank you for calling. This is a test call handler.</Say>
    <Record action="/webhook" method="POST"/>
</Response>`);
      }

      // Handle message status updates efficiently
      if (MessageStatus) {
        broadcast({
          type: "message_status_updated",
          message: {
            twilioSid: MessageSid,
            status: MessageStatus,
            contactNumber: From?.replace('whatsapp:', '')
          }
        });
        return res.status(200).send('OK');
      }

      // Determine channel type with single check
      const channel = From?.startsWith('whatsapp:') ? 'whatsapp'
        : CallSid ? 'voice'
          : 'sms';

      const contactNumber = channel === 'whatsapp' ? From.replace('whatsapp:', '') : From;

      console.log(`Received ${channel} interaction from ${From}`);
      console.log('Details:', { From, To, Body, MessageSid, CallSid });

      // Efficiently store interaction in database
      const message = await db
        .insert(messages)
        .values({
          contactNumber,
          contactName: ProfileName || undefined,
          content: Body || TranscriptionText || `${channel.toUpperCase()} interaction`,
          direction: "inbound",
          status: "delivered",
          twilioSid: MessageSid || CallSid,
          metadata: {
            channel,
            profile: {
              name: ProfileName
            },
            recordingUrl: RecordingUrl,
            transcription: TranscriptionText
          },
        })
        .returning();

      // Optimized broadcast with pre-formatted message
      const broadcastMessage = {
        type: "message_created",
        message: {
          ...message[0],
          createdAt: new Date().toISOString(),
          direction: "inbound",
          status: "delivered",
          metadata: {
            channel,
            profile: {
              name: ProfileName
            },
            recordingUrl: RecordingUrl,
            transcription: TranscriptionText
          }
        }
      };

      console.log(`Processed ${channel} interaction in ${Date.now() - start}ms`);
      broadcast(broadcastMessage);

      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
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
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel
          },
        })
        .returning();

      // Broadcast the new message to all connected clients
      broadcast({
        type: "message_created",
        message: message[0]
      });

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

  // Initiate WhatsApp call
  app.post("/api/calls", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber } = req.body;
      if (!contactNumber) {
        throw new Error('Contact number is required');
      }

      console.log('\n=== Initiating WhatsApp Call ===');
      console.log('To:', contactNumber);
      console.log('Using Twilio number:', process.env.TWILIO_PHONE_NUMBER);

      // Ensure we have the required environment variables
      if (!process.env.TWILIO_PHONE_NUMBER) {
        throw new Error('TWILIO_PHONE_NUMBER environment variable is not set');
      }

      const call = await twilioClient.calls.create({
        url: `${process.env.BASE_URL || 'http://localhost:5000'}/webhook`,
        to: `whatsapp:${contactNumber}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        statusCallback: `${process.env.BASE_URL || 'http://localhost:5000'}/webhook`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: true
      });

      console.log('Call initiated:', call.sid);
      console.log('Call status:', call.status);
      console.log('Call direction:', call.direction);
      console.log('Call from:', call.from);
      console.log('Call to:', call.to);
      console.log('==========================\n');

      res.json({
        status: 'success',
        callDetails: {
          sid: call.sid,
          status: call.status,
          direction: call.direction,
          from: call.from,
          to: call.to
        }
      });
    } catch (error: any) {
      console.error("Error initiating call:", error);
      console.error("Error details:", {
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
        details: error.details
      });

      res.status(500).json({
        status: 'error',
        message: error.message,
        code: error.code || 'CALL_INITIATION_ERROR',
        details: {
          status: error.status,
          moreInfo: error.moreInfo
        }
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
        const channel = isWhatsApp ? 'whatsapp' : 'sms';
        const contactNumber = (isWhatsApp ?
          (msg.to?.startsWith('whatsapp:') ? msg.from : msg.to)?.replace('whatsapp:', '') :
          (msg.direction === 'inbound' ? msg.from : msg.to));

        if (!acc[contactNumber]) {
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
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber } = req.params;
      console.log(`Fetching all historical messages related to ${contactNumber}`);

      // Get all messages from database first
      const dbMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.contactNumber, contactNumber))
        .orderBy(desc(messages.createdAt));

      console.log(`Found ${dbMessages.length} messages in database for ${contactNumber}`);

      // Fetch messages from Twilio with increased limit
      const twilioMessages = await twilioClient.messages.list({
        limit: 5000, // Increased limit for more historical data
      });

      // Filter messages for this specific contact's conversation
      const contactMessages = twilioMessages.filter(msg => {
        // Get clean numbers without whatsapp: prefix for comparison
        const normalizedTo = msg.to?.replace('whatsapp:', '');
        const normalizedFrom = msg.from?.replace('whatsapp:', '');
        const searchNumber = contactNumber.replace('whatsapp:', '');

        // Include messages where this contact is either sender or receiver
        return normalizedTo === searchNumber || normalizedFrom === searchNumber;
      });

      console.log(`Found ${contactMessages.length} messages in Twilio for ${contactNumber}`);

      // Map Twilio messages to our format
      const formattedTwilioMessages = contactMessages.map(msg => ({
        id: msg.sid,
        contactNumber: msg.direction === 'inbound' ?
          msg.from?.replace('whatsapp:', '') :
          msg.to?.replace('whatsapp:', ''),
        content: msg.body || '',
        direction: msg.direction,
        status: msg.status,
        twilioSid: msg.sid,
        metadata: {
          channel: msg.to?.startsWith('whatsapp:') || msg.from?.startsWith('whatsapp:') ? 'whatsapp' : 'sms',
          profile: {
            name: msg.direction === 'inbound' ? msg.from : msg.to
          }
        },
        createdAt: msg.dateCreated
      }));

      // Combine messages from both sources and remove duplicates
      const allMessages = [...dbMessages, ...formattedTwilioMessages];
      const uniqueMessages = Array.from(
        new Map(allMessages.map(msg => [msg.twilioSid || msg.id, msg])).values()
      );

      // Sort messages chronologically
      uniqueMessages.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Get comprehensive conversation statistics
      const stats = {
        total: uniqueMessages.length,
        sent: uniqueMessages.filter(m => m.direction.startsWith('outbound')).length,
        received: uniqueMessages.filter(m => m.direction === 'inbound').length,
        firstInteraction: uniqueMessages[0]?.createdAt,
        lastInteraction: uniqueMessages[uniqueMessages.length - 1]?.createdAt,
      };

      console.log(`Total unique messages for ${contactNumber}:`, stats);

      res.json({
        messages: uniqueMessages,
        stats: stats
      });
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