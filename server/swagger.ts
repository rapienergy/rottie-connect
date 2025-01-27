import { type OpenAPIV3 } from 'openapi-types';
import { CONFIG } from './config';

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
      RottieApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-ROTTIE-API-KEY',
        description: 'ROTTIE API key for authentication'
      },
      TwoStepAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-verification-code',
        description: 'Verification code received via WhatsApp'
      },
      PhoneNumberAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-phone-number',
        description: 'Phone number used for verification'
      }
    },
    schemas: {
      Message: {
        type: 'object',
        properties: {
          contactNumber: {
            type: 'string',
            description: 'The recipient phone number in E.164 format (e.g., +5215512345678)',
            example: '+5215512345678',
            pattern: '\\+[1-9]\\d{1,14}'
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
            description: 'Phone number in E.164 format (e.g., +5215512345678)',
            example: '+5215512345678',
            pattern: '\\+[1-9]\\d{1,14}'
          }
        },
        required: ['phoneNumber']
      },
      VerificationCheck: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number in E.164 format',
            example: '+5215512345678',
            pattern: '\\+[1-9]\\d{1,14}'
          },
          code: {
            type: 'string',
            description: `${CONFIG.VERIFICATION.CODE_LENGTH}-digit verification code`,
            example: '123456',
            pattern: `^\\d{${CONFIG.VERIFICATION.CODE_LENGTH}}$`
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
                type: 'object',
                properties: {
                  moreInfo: {
                    type: 'string'
                  },
                  status: {
                    type: 'string'
                  }
                }
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
        description: 'Send a message through WhatsApp or other channels. Requires ROTTIE API key and two-step verification.',
        security: [
          {
            RottieApiKey: [],
            TwoStepAuth: [],
            PhoneNumberAuth: []
          }
        ],
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
                        },
                        details: {
                          type: 'object',
                          properties: {
                            from: {
                              type: 'string',
                              description: 'Sender phone number'
                            },
                            to: {
                              type: 'string',
                              description: 'Recipient phone number'
                            },
                            direction: {
                              type: 'string',
                              description: 'Message direction'
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized - Invalid API key or missing verification',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'boolean',
                      example: true
                    },
                    code: {
                      type: 'string',
                      enum: ['INVALID_API_KEY', 'VERIFICATION_REQUIRED']
                    },
                    message: {
                      type: 'string',
                      example: 'Invalid or missing ROTTIE API key'
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid request parameters',
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
        description: `Send a ${CONFIG.VERIFICATION.CODE_LENGTH}-digit verification code to the specified phone number via WhatsApp. Rate limited to 1 request per ${CONFIG.VERIFICATION.COOLDOWN_MINUTES} minutes.`,
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
                          example: `Please wait ${CONFIG.VERIFICATION.COOLDOWN_MINUTES} minutes before requesting a new code`
                        },
                        details: {
                          type: 'object',
                          properties: {
                            remainingTime: {
                              type: 'number',
                              description: 'Remaining cooldown time in minutes'
                            }
                          }
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
        description: `Verify a ${CONFIG.VERIFICATION.CODE_LENGTH}-digit code sent to the specified phone number. Limited to ${CONFIG.VERIFICATION.MAX_ATTEMPTS} attempts per code.`,
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
                        },
                        details: {
                          type: 'object',
                          properties: {
                            remainingAttempts: {
                              type: 'number',
                              description: 'Number of verification attempts remaining'
                            }
                          }
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
                          example: `Max attempts (${CONFIG.VERIFICATION.MAX_ATTEMPTS}) exceeded. Please request a new code.`
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