import { z } from "zod";

export const twilioConfigSchema = z.object({
  accountSid: z.string().min(1, "Account SID is required"),
  authToken: z.string().min(1, "Auth Token is required"),
  phoneNumber: z.string().min(1, "Phone number is required"),
});

export type TwilioFormData = z.infer<typeof twilioConfigSchema>;

export function formatPhoneNumber(phone: string): string {
  // Remove whatsapp: prefix if present
  const withoutPrefix = phone.replace('whatsapp:', '');

  // Remove all spaces and non-digit characters except plus sign
  const cleaned = withoutPrefix.replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Handle Mexican numbers with country code
  if (cleaned.startsWith('52') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // Add Mexico country code for 10-digit numbers
  if (cleaned.length === 10) {
    return `+52${cleaned}`;
  }

  // If already has plus and proper length, return as is
  if (cleaned.startsWith('+') && cleaned.length >= 12) {
    return cleaned;
  }

  // Default: add +52 if no country code
  return cleaned.startsWith('+') ? cleaned : `+52${cleaned}`;
}

export function validatePhoneNumber(phone: string): boolean {
  // Remove whatsapp: prefix, spaces, and any other non-digit characters except plus
  const cleaned = phone.replace('whatsapp:', '').replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Valid formats:
  // +52XXXXXXXXXX (Mexican format with country code)
  // +1XXXXXXXXXX (US/Canada format)
  // XXXXXXXXXX (10 digits, will be assumed Mexican)
  const phoneRegex = /^\+?(?:52|1)?\d{10}$/;

  return phoneRegex.test(cleaned);
}