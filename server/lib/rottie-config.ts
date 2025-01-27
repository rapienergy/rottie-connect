import { z } from 'zod';

// Validation schema for API configuration
const rottieConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().regex(/^rk_[a-f0-9]{48}$/, 'Invalid API key format'),
});

export type RottieConfig = z.infer<typeof rottieConfigSchema>;

export function getRottieConfig(): RottieConfig {
  // Simple development mode check
  const isDevelopment = process.env.NODE_ENV === 'development';
  console.log('Environment:', process.env.NODE_ENV);

  // Development configuration - no validation
  if (isDevelopment) {
    const devConfig = {
      baseUrl: 'http://localhost:5000',
      apiKey: 'rk_' + '0'.repeat(48)
    };
    console.log('Using development configuration:', {
      ...devConfig,
      apiKey: '[REDACTED]'
    });
    return devConfig;
  }

  // Production configuration - with validation
  const config = {
    baseUrl: process.env.ROTTIE_CONNECT_URL,
    apiKey: process.env.ROTTIE_API_KEY
  };

  // In production, both values must be present
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('ROTTIE_CONNECT_URL and ROTTIE_API_KEY environment variables are required in production');
  }

  try {
    return rottieConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path}: ${i.message}`).join(', ');
      throw new Error(`Invalid RottieConnect configuration: ${issues}`);
    }
    throw error;
  }
}

// Initialize API client
export function createRottieClient() {
  const config = getRottieConfig();
  console.log('RottieConnect client initialized with base URL:', config.baseUrl);

  return {
    baseUrl: config.baseUrl,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    async request(endpoint: string, options: RequestInit = {}) {
      const url = new URL(endpoint, config.baseUrl).toString();

      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.headers,
            ...options.headers,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`RottieConnect API Error: ${response.status} - ${error}`);
        }

        return response.json();
      } catch (error: any) {
        console.error('RottieConnect API request failed:', {
          url,
          status: error.status,
          message: error.message
        });
        throw error;
      }
    }
  };
}