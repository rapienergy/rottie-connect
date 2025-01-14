import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@db";
import { messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import twilio from "twilio";
import type { Twilio } from "twilio";
import { apiKeyAuth, rateLimit, validateRequest } from "./middleware/auth";

// Utility functions for phone number formatting
function formatWhatsAppNumber(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  let formatted = cleaned;

  if (formatted.startsWith('whatsapp:')) {
    formatted = formatted.substring(9);
  }

  if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }

  if (!formatted.startsWith('+52') && formatted.length === 11) {
    formatted = '+52' + formatted.substring(1);
  }

  return `whatsapp:${formatted}`;
}

function formatVoiceNumber(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('52') && cleaned.length === 12) {
    return '+' + cleaned;
  }

  if (cleaned.length === 10) {
    return '+52' + cleaned;
  }

  if (cleaned.startsWith('+') && cleaned.length >= 12) {
    return cleaned;
  }

  return cleaned.startsWith('+') ? cleaned : '+52' + cleaned;
}

// Initialize Twilio client
let twilioClient: Twilio | null = null;
try {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
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

  // Apply API middlewares
  app.use(apiKeyAuth);
  app.use(rateLimit);
  app.use(validateRequest);

  // WebSocket setup with improved error handling
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

      const { contactNumber, content, channel = 'whatsapp' } = req.body;

      if (!contactNumber || !content) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Contact number and content are required',
            code: 'MISSING_REQUIRED_FIELDS'
          }
        });
      }

      const toNumber = channel === 'whatsapp' ?
        formatWhatsAppNumber(contactNumber) :
        formatVoiceNumber(contactNumber);

      console.log('\n=== Sending message ===');
      console.log('Channel:', channel);
      console.log('To:', toNumber);
      console.log('Content:', content);

      const messagingOptions = {
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
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
          contactNumber: contactNumber.replace('whatsapp:', ''),
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel,
            profile: null
          },
        })
        .returning();

      broadcast({
        type: "message_created",
        message: message
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

  // Voice token generation endpoint
  app.post("/api/voice/token", async (req, res) => {
    try {
      if (!process.env.TWILIO_TWIML_APP_SID) {
        throw new Error('TWILIO_TWIML_APP_SID environment variable is not set');
      }

      const capability = new twilio.jwt.ClientCapability({
        accountSid: process.env.TWILIO_ACCOUNT_SID!,
        authToken: process.env.TWILIO_AUTH_TOKEN!,
        ttl: 3600
      });

      // Add capability to receive incoming calls
      capability.addScope(
        new twilio.jwt.ClientCapability.IncomingClientScope('rottie-agent')
      );

      // Add capability to make outgoing calls
      capability.addScope(
        new twilio.jwt.ClientCapability.OutgoingClientScope({
          applicationSid: process.env.TWILIO_TWIML_APP_SID,
          clientName: 'rottie-agent'
        })
      );

      const token = capability.toJwt();
      console.log('Generated capability token');

      res.json({ token });
    } catch (error: any) {
      console.error('Error generating token:', error);
      res.status(500).json({
        status: 'error',
        message: error.message,
        code: 'TOKEN_GENERATION_ERROR'
      });
    }
  });

  // Voice Calls API
  app.post("/api/v1/calls", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, recordCall = true, machineDetection = true } = req.body;

      console.log('\n=== Initiating Voice Call API ===');
      console.log('To:', contactNumber);
      console.log('Record:', recordCall);
      console.log('Machine Detection:', machineDetection);

      if (!process.env.TWILIO_PHONE_NUMBER) {
        throw new Error('TWILIO_PHONE_NUMBER environment variable is not set');
      }

      const toNumber = formatVoiceNumber(contactNumber);
      console.log('Formatted number:', toNumber);

      const callOptions = {
        to: toNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Say voice="Polly.Mia-Neural" language="es-MX">
                Hola, gracias por atender nuestra llamada. Le estamos contactando de Rottie Connect.
                Un representante se unirá a la llamada en breve.
            </Say>
            <Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">
                <Client>rottie-agent</Client>
            </Dial>
            <Say voice="Polly.Mia-Neural" language="es-MX">
                La llamada ha finalizado. Gracias por usar Rottie Connect.
            </Say>
        </Response>`,
        statusCallback: `${process.env.BASE_URL}/webhook`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: recordCall,
        trim: 'trim-silence',
        machineDetection: machineDetection ? 'Enable' : 'Disable'
      };

      const call = await twilioClient.calls.create(callOptions);

      console.log('Call initiated:', call.sid);
      console.log('==========================\n');

      res.json({
        success: true,
        call: {
          sid: call.sid,
          status: call.status,
          direction: call.direction,
          from: call.from,
          to: call.to
        }
      });
    } catch (error: any) {
      console.error("Error initiating call:", error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'CALL_INITIATION_ERROR',
          details: error.details || {}
        }
      });
    }
  });

  // Messages API
  app.post("/api/v1/messages", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { contactNumber, content, channel = 'whatsapp' } = req.body;

      if (!contactNumber || !content) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Contact number and content are required',
            code: 'MISSING_REQUIRED_FIELDS'
          }
        });
      }

      // Format number based on channel
      const toNumber = channel === 'whatsapp' ?
        formatWhatsAppNumber(contactNumber) :
        formatVoiceNumber(contactNumber);

      console.log('\n=== Sending message via API ===');
      console.log('Channel:', channel);
      console.log('To:', toNumber);
      console.log('Content:', content);

      if (!process.env.TWILIO_MESSAGING_SERVICE_SID) {
        throw new Error('TWILIO_MESSAGING_SERVICE_SID environment variable is not set');
      }

      // Prepare message options
      const messagingOptions = {
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: content,
        // Add additional parameters for better tracking
        statusCallback: `${process.env.BASE_URL}/webhook`,
        // Persist message properties for better tracking
        persistentAction: ['status_callback'],
      };

      const twilioMessage = await twilioClient.messages.create(messagingOptions);
      console.log('Message sent successfully:', twilioMessage.sid);

      // Store in database with enhanced metadata
      const [dbMessage] = await db
        .insert(messages)
        .values({
          contactNumber: contactNumber.replace('whatsapp:', ''),
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel,
            profile: {
              name: null
            }
          },
        })
        .returning();

      // Broadcast to WebSocket clients for real-time updates
      broadcast({
        type: "message_created",
        message: dbMessage
      });

      // Return detailed success response
      res.json({
        success: true,
        message: {
          ...dbMessage,
          twilioStatus: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          to: twilioMessage.to,
          from: twilioMessage.from
        }
      });
    } catch (error: any) {
      console.error("Error sending message:", error);
      console.error("Error details:", {
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
        details: error.details
      });

      // Return detailed error response
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'MESSAGE_SEND_ERROR',
          details: {
            status: error.status,
            moreInfo: error.moreInfo
          }
        }
      });
    }
  });

  // Get Call Status API
  app.get("/api/v1/calls/:callSid", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { callSid } = req.params;
      const call = await twilioClient.calls(callSid).fetch();

      res.json({
        success: true,
        call: {
          sid: call.sid,
          status: call.status,
          direction: call.direction,
          from: call.from,
          to: call.to,
          duration: call.duration,
          startTime: call.startTime,
          endTime: call.endTime,
          price: call.price,
          priceUnit: call.priceUnit
        }
      });
    } catch (error: any) {
      console.error("Error fetching call status:", error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'CALL_STATUS_ERROR'
        }
      });
    }
  });

  // Get Message Status API
  app.get("/api/v1/messages/:messageSid", async (req, res) => {
    try {
      if (!twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const { messageSid } = req.params;
      const message = await twilioClient.messages(messageSid).fetch();

      res.json({
        success: true,
        message: {
          sid: message.sid,
          status: message.status,
          direction: message.direction,
          from: message.from,
          to: message.to,
          body: message.body,
          numSegments: message.numSegments,
          price: message.price,
          priceUnit: message.priceUnit
        }
      });
    } catch (error: any) {
      console.error("Error fetching message status:", error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: error.code || 'MESSAGE_STATUS_ERROR'
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
                <Client>rottie-agent</Client>
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
          const [message] = await db
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
              ...message,
              createdAt: new Date().toISOString()
            }
          });

          console.log(`Processed Voice call event in ${Date.now() - start}ms`);
          console.log('Call details stored:', message);
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
      const [message] = await db
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
            transcription: TranscriptionText,
            callDuration: CallDuration ? parseInt(CallDuration) : null
          },
        })
        .returning();

      // Optimized broadcast with pre-formatted message
      const broadcastMessage = {
        type: "message_created",
        message: {
          ...message,
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
      const toNumber = formatWhatsAppNumber(contactNumber);

      console.log('Sending message via Messaging Service:');
      console.log('Channel:', channel);
      console.log('To:', toNumber);
      console.log('Content:', content);

      // Send message via Twilio Messaging Service
      const messagingOptions = {
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        to: toNumber,
        body: content,
        statusCallback: `${process.env.BASE_URL}/webhook`,
        persistentAction: ['status_callback'],
      };

      const twilioMessage = await twilioClient.messages.create(messagingOptions);

      console.log('Message sent successfully:', twilioMessage.sid);

      // Store message in database
      const [message] = await db
        .insert(messages)
        .values({
          contactNumber: contactNumber.replace('whatsapp:', ''),
          content,
          direction: "rottie",
          status: twilioMessage.status,
          twilioSid: twilioMessage.sid,
          metadata: {
            channel,
            profile: null
          },
        })
        .returning();

      // Broadcast the new message to all connected clients
      broadcast({
        type: "message_created",
        message: message
      });

      res.json(message);
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