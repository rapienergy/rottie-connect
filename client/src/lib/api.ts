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

export interface MessageResponse {
  messages: Message[];
  stats: {
    total: number;
    sent: number;
    received: number;
    firstInteraction?: string;
    lastInteraction?: string;
  };
}

export interface Conversation {
  contactNumber: string;
  contactName?: string;
  latestMessage: {
    content: string;
    direction: string;
    status: string;
    createdAt: string;
  };
  channel: 'whatsapp' | 'sms' | 'voice';
}

interface SendMessageParams {
  contactNumber: string;
  content: string;
  channel?: 'whatsapp' | 'sms' | 'voice';
}

export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
    staleTime: 0, // This ensures we always fetch fresh data
    refetchInterval: 5000, // Refetch every 5 seconds to keep conversations up to date
  });
}

export function useMessages(contactNumber: string) {
  return useQuery<MessageResponse>({
    queryKey: [`/api/conversations/${contactNumber}/messages`],
    enabled: !!contactNumber,
    staleTime: 0, // Always fetch fresh data
    refetchInterval: 3000, // Refetch every 3 seconds
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