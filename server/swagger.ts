import { type OpenAPIV3 } from 'openapi-types';

export const swaggerDocument: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'RottieConnect API',
    version: '1.0.0',
    description: 'Enterprise Messaging Platform providing multi-channel communication solutions through Twilio integration.',
    contact: {
      name: 'Rapienergy Support',
      url: 'https://rapienergy.live'
    }
  },
  servers: [
    {
      url: process.env.BASE_URL || 'http://localhost:5000',
      description: 'RottieConnect API Server'
    }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for authentication'
      }
    },
    schemas: {
      Message: {
        type: 'object',
        properties: {
          contactNumber: {
            type: 'string',
            description: 'The recipient phone number',
            example: '+5215512345678'
          },
          content: {
            type: 'string',
            description: 'Message content',
            example: 'Hello from RottieConnect!'
          },
          channel: {
            type: 'string',
            enum: ['whatsapp', 'sms', 'voice'],
            default: 'whatsapp',
            description: 'Communication channel'
          }
        },
        required: ['contactNumber', 'content']
      },
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                example: 'MESSAGE_SEND_FAILED'
              },
              message: {
                type: 'string',
                example: 'Failed to send message'
              },
              details: {
                type: 'string',
                example: 'Invalid phone number format'
              }
            }
          }
        }
      }
    }
  },
  paths: {
    '/api/messages': {
      post: {
        summary: 'Send a message',
        description: 'Send a message through WhatsApp or other channels',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Message'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Message sent successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    data: {
                      type: 'object',
                      properties: {
                        message: {
                          $ref: '#/components/schemas/Message'
                        },
                        twilioSid: {
                          type: 'string'
                        },
                        status: {
                          type: 'string',
                          enum: ['queued', 'sent', 'delivered', 'failed']
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized - Invalid or missing API key',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '500': {
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          }
        }
      }
    }
  }
};
