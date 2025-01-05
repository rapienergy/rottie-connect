import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { toast } from "@/hooks/use-toast";

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email?: string;
}

export interface Message {
  id: number;
  contactId: number;
  content: string;
  direction: "inbound" | "outbound";
  status: string;
  createdAt: string;
}

export function useContacts() {
  return useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
}

export function useMessages(contactId: number) {
  return useQuery<Message[]>({
    queryKey: [`/api/messages/${contactId}`],
    enabled: !!contactId,
  });
}

export function useCreateContact() {
  return useMutation({
    mutationFn: async (contact: Omit<Contact, "id">) => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact created successfully" });
    },
    onError: (error) => {
      toast({
        title: "Failed to create contact",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({
      contactId,
      content,
    }: {
      contactId: number;
      content: string;
    }) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, content }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/messages/${variables.contactId}`],
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