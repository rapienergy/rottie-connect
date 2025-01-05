import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { toast } from "@/hooks/use-toast";

export interface Message {
  id: number;
  contactNumber: string;
  contactName?: string;
  content: string;
  direction: "inbound" | "outbound";
  status: string;
  twilioSid?: string;
  metadata?: {
    channel: 'whatsapp' | 'sms' | 'voice';
    profile?: {
      name?: string;
      avatar?: string;
    };
  };
  createdAt: string;
}

export interface Conversation {
  contactNumber: string;
  contactName?: string;
  latestMessage: Message;
  channel: 'whatsapp' | 'sms' | 'voice';
}

export function useConversations() {
  return useQuery<Conversation[]>({ queryKey: ["/api/conversations"] });
}

export function useMessages(contactNumber: string) {
  return useQuery<Message[]>({
    queryKey: [`/api/conversations/${contactNumber}/messages`],
    enabled: !!contactNumber,
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({
      contactNumber,
      content,
    }: {
      contactNumber: string;
      content: string;
    }) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactNumber, content }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/conversations/${variables.contactNumber}/messages`],
      });
      toast({ title: "Message sent successfully" });
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}