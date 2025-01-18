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
      VerificationRequest: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number to verify (Mexican format)',
            example: '+5215512345678'
          }
        },
        required: ['phoneNumber']
      },
      VerificationCheck: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number being verified',
            example: '+5215512345678'
          },
          code: {
            type: 'string',
            description: '6-digit verification code',
            example: '123456'
          }
        },
        required: ['phoneNumber', 'code']
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
    },
    '/api/verify/send': {
      post: {
        summary: 'Send verification code',
        description: 'Send a 6-digit verification code to the specified phone number via WhatsApp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/VerificationRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Verification code sent successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    message: {
                      type: 'string',
                      example: 'Verification code sent successfully'
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid phone number format',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '429': {
            description: 'Too many requests or cooldown period active',
            content: {
              'application/json': {
                schema: {
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
                          example: 'COOLDOWN_ACTIVE'
                        },
                        message: {
                          type: 'string',
                          example: 'Please wait 15 minutes before requesting a new code'
                        }
                      }
                    }
                  }
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
    },
    '/api/verify/check': {
      post: {
        summary: 'Verify code',
        description: 'Verify a 6-digit code sent to the specified phone number',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/VerificationCheck'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Code verified successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    message: {
                      type: 'string',
                      example: 'Code verified successfully'
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid code or phone number',
            content: {
              'application/json': {
                schema: {
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
                          example: 'INVALID_CODE'
                        },
                        message: {
                          type: 'string',
                          example: 'Invalid code. 2 attempts remaining.'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '429': {
            description: 'Maximum attempts exceeded',
            content: {
              'application/json': {
                schema: {
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
                          example: 'MAX_ATTEMPTS_EXCEEDED'
                        },
                        message: {
                          type: 'string',
                          example: 'Max attempts (3) exceeded. Please request a new code.'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '404': {
            description: 'No active verification code found',
            content: {
              'application/json': {
                schema: {
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
                          example: 'NO_ACTIVE_CODE'
                        },
                        message: {
                          type: 'string',
                          example: 'No active verification code found. Please request a new code.'
                        }
                      }
                    }
                  }
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