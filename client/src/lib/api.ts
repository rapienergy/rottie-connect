import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { toast } from "@/hooks/use-toast";

export interface Message {
  id: string | number;
  contactNumber: string;
  contactName?: string | null;
  content: string;
  direction: string;
  status: string;
  twilioSid?: string;
  createdAt: string;
  metadata?: {
    channel: 'whatsapp' | 'sms' | 'voice';
    callDuration?: number;
    recordingUrl?: string;
    transcription?: string;
  };
}

interface SendMessageParams {
  contactNumber: string;
  content: string;
  channel?: 'whatsapp' | 'sms' | 'voice';
}

export function useMessages(contactNumber: string) {
  return useQuery<Message[]>({
    queryKey: [`/api/conversations/${contactNumber}/messages`],
    enabled: !!contactNumber,
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations"],
      });
      toast({ title: "Message sent successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}