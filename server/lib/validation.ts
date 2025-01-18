export function validatePhoneNumber(phone: string): { isValid: boolean; error?: string } {
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

export function validateMessageContent(content: string): { isValid: boolean; error?: string } {
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
