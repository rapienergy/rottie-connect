import { z } from 'zod';

// Validation schema for API configuration
const rottieConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().regex(/^rk_[a-f0-9]{48}$/, 'Invalid API key format'),
});

export type RottieConfig = z.infer<typeof rottieConfigSchema>;

// Get and validate configuration with development fallbacks
function getDevConfig(): RottieConfig {
  console.warn('Using development configuration for RottieConnect');
  return {
    baseUrl: 'http://localhost:5000',
    apiKey: 'rk_' + '0'.repeat(48)
  };
}

// Get and validate configuration with development fallbacks
export function getRottieConfig(): RottieConfig {
  const isDevelopment = process.env.NODE_ENV === 'development';

  try {
    // If in development and no env vars, use dev config directly
    if (isDevelopment && (!process.env.ROTTIE_CONNECT_URL || !process.env.ROTTIE_API_KEY)) {
      return getDevConfig();
    }

    const config = {
      baseUrl: process.env.ROTTIE_CONNECT_URL || 'http://localhost:5000',
      apiKey: process.env.ROTTIE_API_KEY || ('rk_' + '0'.repeat(48))
    };

    // In production, validate strictly
    if (!isDevelopment) {
      return rottieConfigSchema.parse(config);
    }

    // In development, be more lenient
    return config;
  } catch (error) {
    if (isDevelopment) {
      console.warn('Failed to load RottieConnect configuration, using development defaults');
      return getDevConfig();
    }

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
  console.log('Initializing RottieConnect client with base URL:', config.baseUrl);

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