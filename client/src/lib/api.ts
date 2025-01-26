import { useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { toast } from "@/hooks/use-toast";

interface SendMessageParams {
  contactNumber: string;
  content: string;
  channel?: 'whatsapp' | 'sms' | 'voice';
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