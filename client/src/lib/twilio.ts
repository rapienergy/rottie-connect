import { z } from "zod";

export const twilioConfigSchema = z.object({
  accountSid: z.string().min(1, "Account SID is required"),
  authToken: z.string().min(1, "Auth Token is required"),
  phoneNumber: z.string().min(1, "Phone number is required"),
});

export type TwilioFormData = z.infer<typeof twilioConfigSchema>;

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  } else if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+${cleaned}`;
  }
  return phone;
}

export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?1?\d{10,11}$/;
  return phoneRegex.test(phone.replace(/\D/g, ""));
}
