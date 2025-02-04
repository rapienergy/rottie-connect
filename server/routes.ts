import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio } from "twilio";
import { randomBytes } from 'crypto';
import { VerificationService } from "./verification";
import { setupAuth } from "./auth";  // Add this import

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

// Update formatWhatsAppNumber function for better number formatting
function formatWhatsAppNumber(phone: string): string {
  // Remove all non-digit characters except plus sign
  const cleaned = phone.replace(/[^\d+]/g, '');

  // If number already starts with "whatsapp:", return as is
  if (phone.startsWith('whatsapp:')) {
    return phone;
  }

  // Format Mexican WhatsApp business number (remove spaces)
  if (process.env.TWILIO_PHONE_NUMBER) {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER.replace(/\s+/g, '');
    if (phone === fromNumber) {
      return `whatsapp:${fromNumber}`;
    }
  }

  // Handle Mexican numbers with country code
  if (cleaned.startsWith('52') && cleaned.length === 12) {
    return `whatsapp:+${cleaned}`;
  }

  // Add Mexico country code for 10-digit numbers
  if (cleaned.length === 10) {
    return `whatsapp:+52${cleaned}`;
  }

  // If already has plus and proper length, just add whatsapp: prefix
  if (cleaned.startsWith('+')) {
    return `whatsapp:${cleaned}`;
  }

  // Default: add whatsapp:+52 if no country code
  return `whatsapp:+52${cleaned}`;
}

// Update formatVoiceNumber function for better number formatting
function formatVoiceNumber(phone: string): string {
  // Remove all non-digit characters except plus sign
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Handle Mexican numbers
  if (cleaned.startsWith('52') && cleaned.length === 12) {
    return '+' + cleaned;
  }

  // Add Mexico country code for 10-digit numbers
  if (cleaned.length === 10) {
    return '+52' + cleaned;
  }

  // If already has plus and proper length, return as is
  if (cleaned.startsWith('+') && cleaned.length >= 12) {
    return cleaned;
  }

  // Default: add +52 if no country code
  return cleaned.startsWith('+') ? cleaned : '+52' + cleaned;
}

// Add message validation functions
function validateMessageContent(content: string): { isValid: boolean; error?: string } {
  if (!content || typeof content !== 'string') {
    return { isValid: false, error: 'Message content is required and must be a string' };
  }

  if (content.length > 4096) {
    return { isValid: false, error: 'Message content exceeds maximum length of 4096 characters' };
  }

  // Check for empty or whitespace-only content
  if (content.trim().length === 0) {
    return { isValid: false, error: 'Message content cannot be empty' };
  }

  return { isValid: true };
}

function validatePhoneNumber(phone: string): { isValid: boolean; error?: string } {
  // Remove whatsapp: prefix, spaces, and any other non-digit characters except plus
  const cleaned = phone.replace('whatsapp:', '').replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Valid formats:
  // +52XXXXXXXXXX (Mexican format with country code)
  // +1XXXXXXXXXX (US/Canada format)
  // XXXXXXXXXX (10 digits, will be assumed Mexican)
  const phoneRegex = /^\+?(?:52|1)?\d{10}$/;

  if (!phoneRegex.test(cleaned)) {
    return {
      isValid: false,
      error: 'Invalid phone number format. Must be a valid Mexican (+52) or US/Canada (+1) number'
    };
  }

  return { isValid: true };
}

// Add more detailed logging for message sending
async function logTwilioDetails() {
  if (!twilioClient) return;

  try {
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (!messagingServiceSid) {
      console.error('Missing TWILIO_MESSAGING_SERVICE_SID');
      return;
    }

    const service = await twilioClient.messaging.v1.services(messagingServiceSid).fetch();
    const phoneNumbers = await twilioClient.messaging.v1
      .services(messagingServiceSid)
      .phoneNumbers
      .list();

    console.log('\n=== Twilio Configuration ===');
    console.log('Account SID:', process.env.TWILIO_ACCOUNT_SID?.substring(0, 8) + '...');
    console.log('Service SID:', messagingServiceSid.substring(0, 8) + '...');
    console.log('Service Name:', service.friendlyName);
    console.log('Phone Numbers:', phoneNumbers.map(p => p.phoneNumber).join(', '));
    console.log('===========================\n');
  } catch (error) {
    console.error('Error logging Twilio details:', error);
  }
}

export function registerRoutes(app: Express): Server {
  // Initialize authentication first
  setupAuth(app);

  const httpServer = createServer(app);

  // Add API key generation endpoint
  app.post("/api/keys/generate", async (req, res) => {
    try {
      // In production, this endpoint should be protected and only accessible by admins
      if (process.env.NODE_ENV === 'production' && !req.headers['x-admin-key']) {
        return res.status(401).json({
          error: true,
          message: 'Unauthorized. Admin access required.',
          code: 'UNAUTHORIZED'
        });
      }

      const apiKey = `rk_${randomBytes(24).toString('hex')}`;

      // In a production environment, store this key in a database
      // For now, we'll just return it
      res.json({
        success: true,
        data: {
          apiKey,
          createdAt: new Date().toISOString(),
          expiresAt: null, // Implement expiration if needed
          scopes: ['messages:write', 'calls:write'] // Implement scopes if needed
        }
      });
    } catch (error: any) {
      console.error('Error generating API key:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'KEY_GENERATION_FAILED',
          message: error.message
        }
      });
    }
  });

  // Voice call endpoint for landline calls (placed first to ensure it's registered before other routes)
  app.post("/api/voice/calls", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber } = req.body;
      if (!contactNumber) {
        throw new Error('Contact number is required');
      }

      console.log('\n=== Initiating Voice Call ===');
      console.log('To:', contactNumber);
      console.log('Using Twilio number:', process.env.TWILIO_PHONE_NUMBER);

      // Ensure we have the required environment variables
      if (!process.env.TWILIO_PHONE_NUMBER) {
        throw new Error('TWILIO_PHONE_NUMBER environment variable is not set');
      }

      // Format numbers for voice calls - using regular phone number format, not WhatsApp
      let toNumber = formatVoiceNumber(contactNumber);
      console.log('Formatted number:', toNumber);

      // Initiate the voice call with direct TwiML
      const call = await twilioClient.calls.create({
        to: toNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Say voice="Polly.Mia-Neural" language="es-MX">
                Hola, gracias por atender nuestra llamada. Le estamos contactando de Rottie Connect.
                Un representante se unirá a la llamada en breve.
            </Say>
            <Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">
                <Number>+525584277211</Number>
            </Dial>
            <Say voice="Polly.Mia-Neural" language="es-MX">
                La llamada ha finalizado. Gracias por usar Rottie Connect.
            </Say>
        </Response>`,
        statusCallback: `${process.env.BASE_URL}/webhook`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: true,
        trim: 'trim-silence',
        machineDetection: 'Enable'
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
        console.log('\n=== Voice Call Event ===');
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
              content: `Voice Call - ${CallStatus} - Duration: ${CallDuration || 0}s`,
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

          console.log(`Processed Voice call event in ${Date.now() - start}ms`);
          console.log('Call details stored:', message[0]);
        } catch (err) {
          console.error('Failed to process call event:', err);
        }
        // Return TwiML response for calls
        return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Say voice="alice" language="es-MX">
                Gracias por contestar. Esta es una llamada de prueba de Rottie Connect.
            </Say>
            <Play digits="1234"></Play>
            <Pause length="1"/>
            <Say voice="alice" language="es-MX">
                Fin de la llamada de prueba. Gracias.
            </Say>
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

  // The message sending endpoint implementation
  app.post("/api/messages", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, content, channel = 'whatsapp' } = req.body;

      // Validate required fields
      if (!contactNumber || !content) {
        return res.status(400).json({
          error: true,
          code: 'INVALID_REQUEST',
          message: 'Contact number and content are required'
        });
      }

      // Validate message content
      const contentValidation = validateMessageContent(content);
      if (!contentValidation.isValid) {
        return res.status(400).json({
          error: true,
          code: 'INVALID_CONTENT',
          message: contentValidation.error
        });
      }

      if (!process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('Messaging Service SID not configured');
      }

      // Format the destination number for WhatsApp
      const toNumber = formatWhatsAppNumber(contactNumber);

      console.log('\n=== Sending WhatsApp Message ===');
      console.log('To:', toNumber);
      console.log('Content:', content);
      console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

      // Send message via Twilio Messaging Service
      const messagingOptions = {
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: content,
        statusCallback: `${process.env.BASE_URL}/webhook`
      };

      console.log('Message options:', JSON.stringify(messagingOptions, null, 2));

      const twilioMessage = await twilioClient.messages.create(messagingOptions);

      console.log('Message sent successfully:', twilioMessage.sid);
      console.log('Message status:', twilioMessage.status);
      console.log('Message direction:', twilioMessage.direction);
      console.log('Message from:', twilioMessage.from);
      console.log('Message to:', twilioMessage.to);
      console.log('==========================\n');

      // Store message in database
      const message = await db
        .insert(messages)
        .values({
          contactNumber: contactNumber.replace('whatsapp:', ''),
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel: 'whatsapp',
            profile: {
              name: twilioMessage.to
            }
          },
        })
        .returning();

      // Broadcast the new message to all connected clients
      broadcast({
        type: "message_created",
        message: message[0]
      });

      // Return standardized API response
      res.json({
        success: true,
        data: {
          message: message[0],
          twilioSid: twilioMessage.sid,
          status: twilioMessage.status,
          details: {
            from: twilioMessage.from,
            to: twilioMessage.to,
            direction: twilioMessage.direction
          }
        }
      });
    } catch (error: any) {
      console.error("\n=== WhatsApp Message Error ===");
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
        stack: error.stack
      });
      console.error("==========================\n");

      // Return standardized error response
      res.status(error.status || 500).json({
        success: false,
        error: {
          code: error.code || 'MESSAGE_SEND_FAILED',
          message: error.message || 'Failed to send message',
          details: {
            moreInfo: error.moreInfo,
            status: error.status
          }
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
        limit: 5000 // Increased limit to get more historical messages
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

      console.log('\n=== Testing Messaging Service Configuration ===');
      console.log('Messaging Service SID:', messagingServiceSid);

      // Get Messaging Service details
      const service = await twilioClient.messaging.v1.services(messagingServiceSid).fetch();
      console.log('Service details:', service.friendlyName);

      // Get phone numbers associated with the Messaging Service
      const phoneNumbers = await twilioClient.messaging.v1
        .services(messagingServiceSid)
        .phoneNumbers
        .list();

      console.log('Phone numbers:', phoneNumbers.length);
      phoneNumbers.forEach(num => {
        console.log('- Number:', num.phoneNumber);
        console.log('  Capabilities:', num.capabilities);
      });

      const primaryNumber = phoneNumbers.find(num => num.phoneNumber.endsWith('6311'));

      res.json({
        status: 'success',
        service: {
          sid: service.sid,
          friendlyName: service.friendlyName,
          inboundRequestUrl: service.inboundRequestUrl,
          useInboundWebhookOnNumber: service.useInboundWebhookOnNumber
        },
        message: 'Messaging Service configuration verified',
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

  // Test WhatsApp number formatting
  app.get("/api/twilio/test-format", async (req, res) => {
    const testNumbers = [
      process.env.TWILIO_PHONE_NUMBER || '',  // Business number
      '5215512345678',                       // With country code
      '5512345678',                          // Without country code
      'whatsapp:+5215512345678',            // Already formatted
      '+5215512345678'                       // With plus
    ];

    const formatted = testNumbers.map(num => ({
      original: num,
      formatted: formatWhatsAppNumber(num)
    }));

    res.json({
      businessNumber: process.env.TWILIO_PHONE_NUMBER,
      testResults: formatted
    });
  });

  // Send verification code
  app.post("/api/verify/send", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          error: true,
          code: 'MISSING_PHONE',
          message: 'Phone number is required'
        });
      }

      // Generate and store verification code
      try {
        const code = await VerificationService.createVerification(phoneNumber);

        console.log('\n=== Sending Verification Code ===');
        console.log('To:', phoneNumber);
        console.log('Code:', code);

        // Format number for WhatsApp
        const toNumber = formatWhatsAppNumber(phoneNumber);

        if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID) {
          throw new Error('Twilio client or messaging service not configured');
        }

        // Send code via WhatsApp
        const message = await twilioClient.messages.create({
          messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
          to: toNumber,
          body: `Your RottieConnect verification code is: ${code}\n\nThis code will expire in 5 minutes.`
        });

        console.log('Message sent successfully:', message.sid);
        console.log('==========================\n');

        res.json({
          success: true,
          message: 'Verification code sent successfully'
        });
      } catch (error: any) {
        // Handle specific verification service errors
        if (error.message.includes('Please wait')) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'COOLDOWN_ACTIVE',
              message: error.message
            }
          });
        }
        throw error;
      }
    } catch (error: any) {
      console.error("Error sending verification code:", error);
      res.status(500).json({
        success: false,
        error: {
          code: error.code || 'VERIFICATION_SEND_FAILED',
          message: error.message || 'Failed to send verification code'
        }
      });
    }
  });

  // Verify code
  app.post("/api/verify/check", async (req, res) => {
    try {
      const { phoneNumber, code } = req.body;

      if (!phoneNumber || !code) {
        return res.status(400).json({
          error: true,
          code: 'MISSING_FIELDS',
          message: 'Phone number and verification code are required'
        });
      }
      // Validate code format
      if (!VerificationService.isValidCode(code)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALIDCODE_FORMAT',
            message: 'Verification code must be 6digits'
          }
        });
      }

      try {
        await VerificationService.verifyCode(phoneNumber, code);

        res.json({
          success: true,
          message: 'Code verified successfully'
        });
      } catch (error: any) {
        // Handle specific verification errors with appropriate status codes
        if (error.message.includes('Max attempts')) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'MAX_ATTEMPTS_EXCEEDED',
              message: error.message
            }
          });
        } else if (error.message.includes('attempts remaining')) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_CODE',
              message: error.message
            }
          });
        } else if (error.message.includes('No active verification')) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'NO_ACTIVE_CODE',
              message: error.message
            }
          });
        }
        throw error;
      }
    } catch (error: any) {
      console.error("Error verifying code:", error);
      res.status(500).json({
        success: false,
        error: {
          code: error.code || 'VERIFICATION_ERROR',
          message: error.message || 'Failed to verify code'
        }
      });
    }
  });

  // Add a new test endpoint to check configuration
  app.get("/api/verify/test-config", async (_req, res) => {
    try {
      console.log('\n=== Testing Configuration ===');
      console.log('Twilio Account SID exists:', !!process.env.TWILIO_ACCOUNT_SID);
      console.log('Twilio Auth Token exists:', !!process.env.TWILIO_AUTH_TOKEN);
      console.log('Twilio Messaging Service SID exists:', !!process.env.TWILIO_MESSAGING_SERVICE_SID);
      console.log('Twilio Phone Number:', process.env.TWILIO_PHONE_NUMBER);

      // Check if Twilio client is initialized
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      // Try to fetch messaging service details to verify credentials
      const service = await twilioClient.messaging.v1
        .services(process.env.TWILIO_MESSAGING_SERVICE_SID!)
        .fetch();

      res.json({
        success: true,
        config: {
          twilioConfigured: true,
          messagingService: {
            sid: service.sid,
            friendlyName: service.friendlyName,
            inboundRequestUrl: service.inboundRequestUrl
          }
        }
      });
    } catch (error: any) {
      console.error('Configuration test failed:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          moreInfo: error.moreInfo
        }
      });
    }
  });

  // Add this test endpoint after the /api/verify/check endpoint
  // Test verification code sending
  app.get("/api/verify/test", async (_req, res) => {
    try {
      console.log('\n=== Testing Verification Code Sending ===');
      const testNumber = CONFIG.VERIFICATION.TEST_PHONE_NUMBER;
      console.log('Test number:', testNumber);

      if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID) {
        console.error('Twilio client or messaging service not configured');
        throw new Error('Messaging service not configured');
      }

      // Format number for WhatsApp
      const toNumber = `whatsapp:${testNumber}`;
      console.log('Sending to:', toNumber);

      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `RottieConnect Test Message\n\nThis is a test message to verify WhatsApp integration.`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('Message status:', message.status);

      res.json({
        success: true,
        message: `Test message sent to ${testNumber}`,
        messageId: message.sid,
        status: message.status
      });
    } catch (error: any) {
      console.error('Test message failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.moreInfo
      });
    }
  });

  // Test verification code sending
  app.post("/api/test-verification", async (req, res) => {
    try {
      if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('Twilio client or messaging service not configured');
      }

      const testNumber = "+5215584277211"; // Static code for testing
      const testCode = "123456"; // Static code for testing

      console.log('\n=== Testing Verification Code ===');
      console.log('To:', testNumber);
      console.log('Code:', testCode);

      // Format number for WhatsApp
      const toNumber = formatWhatsAppNumber(testNumber);
      console.log('Formatted number:', toNumber);

      // Send test code via WhatsApp
      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `Your RottieConnect test verification code is: ${testCode}\n\nThis is a test message.`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('==========================\n');

      res.json({
        success: true,
        message: 'Test verification code sent successfully',
        details: {
          to: toNumber,
          messageId: message.sid,
          status: message.status
        }
      });
    } catch (error: any) {
      console.error("\n=== WhatsApp Verification Error ===");
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo
      });
      console.error("==========================\n");

      res.status(500).json({
        success: false,
        error: {
          code: error.code || 'TEST_VERIFICATION_FAILED',
          message: error.message || 'Failed to send test verification code'
        }
      });
    }
  });

  // Add this test endpoint after the /api/verify/check endpoint
  app.post("/api/verify/send-test", async (_req, res) => {
    try {
      if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('Twilio client or messaging service not configured');
      }

      const testNumber = "+5215584277211"; // Hard-coded test number
      console.log('\n=== Testing WhatsApp Message ===');
      console.log('Test number:', testNumber);

      // Format number for WhatsApp with proper + prefix
      const toNumber = `whatsapp:+${testNumber.replace(/^\+/, '')}`;
      console.log('Sending to:', toNumber);
      console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `RottieConnect Test Message\n\nThis is a test message to verify WhatsApp integration.`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('Message status:', message.status);
      console.log('==============================\n');

      res.json({
        success: true,
        message: `Test message sent to ${testNumber}`,
        messageId: message.sid,
        status: message.status
      });
    } catch (error: any) {
      console.error('Error sending test message:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          moreInfo: error.moreInfo,
          details: error.details
        }
      });
    }
  });

  // Test sending a WhatsApp message
  app.post("/api/verify/test-message", async (_req, res) => {
    try {
      if (!twilioClient || !process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('Twilio client or messaging service not configured');
      }

      const testNumber = "+5215584277211"; // Hard-coded test number
      console.log('\n=== Testing WhatsApp Message ===');
      console.log('Test number:', testNumber);

      // Format number for WhatsApp with proper prefix handling
      const toNumber = testNumber.startsWith('+')
        ? `whatsapp:${testNumber.substring(1)}`
        : `whatsapp:${testNumber}`;

      console.log('Sending to:', toNumber);
      console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `RottieConnect Test Message\n\nThis is a test message sent at ${new Date().toISOString()}`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('Message status:', message.status);
      console.log('==============================\n');

      res.json({
        success: true,
        message: `Test message sent to ${testNumber}`,
        messageId: message.sid,
        status: message.status
      });
    } catch (error: any) {
      console.error('Error sending test message:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          moreInfo: error.moreInfo,
          details: error.details
        }
      });
    }
  });

  // Add test WhatsApp message endpoint
  app.post("/api/messages/test", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const testNumber = "+5215584277211";
      console.log('\n=== Sending Test WhatsApp Message ===');
      console.log('To:', testNumber);
      console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

      const toNumber = formatWhatsAppNumber(testNumber);
      console.log('Formatted number:', toNumber);

      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `Test message from RottieConnect at ${new Date().toLocaleTimeString()}`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('Message status:', message.status);
      console.log('==========================\n');

      res.json({
        success: true,
        message: 'Test message sent successfully',
        details: {
          messageId: message.sid,
          status: message.status,
          to: message.to
        }
      });
    } catch (error: any) {
      console.error('Error sending test message:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code,
          moreInfo: error.moreInfo
        }
      });
    }
  });

  // Add test configuration verification endpoint
  app.get("/api/verify/test-config", async (_req, res) => {
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

      console.log('\n=== Twilio Configuration Status ===');
      console.log('Service SID:', messagingServiceSid);
      console.log('Service Name:', service.friendlyName);
      console.log('Phone Numbers:', phoneNumbers.map(p => p.phoneNumber).join(', '));
      console.log('================================\n');

      res.json({
        success: true,
        config: {
          accountSid: process.env.TWILIO_ACCOUNT_SID?.substring(0, 8) + '...',
          messagingServiceSid: messagingServiceSid.substring(0, 8) + '...',
          phoneNumber: process.env.TWILIO_PHONE_NUMBER,
          service: {
            friendlyName: service.friendlyName,
            inboundRequestUrl: service.inboundRequestUrl
          },
          phoneNumbers: phoneNumbers.map(p => ({
            number: p.phoneNumber,
            capabilities: p.capabilities
          }))
        }
      });
    } catch (error: any) {
      console.error('Error checking Twilio configuration:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'CONFIG_CHECK_FAILED',
          moreInfo: error.moreInfo
        }
      });
    }
  });

  // Add test message sending endpoint
  app.post("/api/verify/test-message", async (_req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const testNumber = "+5215584277211";
      console.log('\n=== Sending Test Message ===');
      console.log('To:', testNumber);
      console.log('Using Messaging Service:', process.env.TWILIO_MESSAGING_SERVICE_SID);

      const toNumber = formatWhatsAppNumber(testNumber);
      console.log('Formatted number:', toNumber);

      const message = await twilioClient.messages.create({
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: `Test message from RottieConnect at ${new Date().toLocaleTimeString()}`
      });

      console.log('Message sent successfully:', message.sid);
      console.log('Message status:', message.status);
      console.log('==========================\n');

      res.json({
        success: true,
        message: 'Test message sent successfully',
        details: {
          messageId: message.sid,
          status: message.status,
          to: message.to
        }
      });
    } catch (error: any) {
      console.error('Error sending test message:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'TEST_MESSAGE_FAILED',
          moreInfo: error.moreInfo
        }
      });
    }
  });

  return httpServer;
}