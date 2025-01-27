import { createRottieClient } from './rottie-config';

// Initialize the API client
const rottieClient = createRottieClient();

export async function makeApiRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  try {
    console.log(`Making RottieConnect API request to ${endpoint}`);

    return await rottieClient.request(endpoint, {
      method,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error: any) {
    console.error('RottieConnect API Error:', error);
    throw new Error(`API request failed: ${error.message}`);
  }
}

// Export common API operations
export const api = {
  // Add specific API operations here as needed
  async getStatus() {
    return makeApiRequest('/status');
  },
  
  async testConnection() {
    return makeApiRequest('/test-connection');
  }
};