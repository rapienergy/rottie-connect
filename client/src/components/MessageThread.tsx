import { useEffect, useRef } from "react";
import { useMessages, useContacts, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  contactId: number;
}

export function MessageThread({ contactId }: MessageThreadProps) {
  const { data: messages, isLoading: messagesLoading } = useMessages(contactId);
  const { data: contacts } = useContacts();
  const sendMessage = useSendMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contact = contacts?.find((c) => c.id === contactId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const content = new FormData(form).get("content") as string;
    
    if (!content.trim()) return;
    
    await sendMessage.mutateAsync({ contactId, content });
    form.reset();
  };

  if (!contact) return null;

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border">
      <div className="p-4 border-b">
        <h2 className="font-semibold">{contact.name}</h2>
        <p className="text-sm text-muted-foreground">{contact.phone}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messagesLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : (
          messages?.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[75%] rounded-lg p-3",
                message.direction === "outbound"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              <p>{message.content}</p>
              <span className="text-xs opacity-70">
                {new Date(message.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          name="content"
          placeholder="Type your message..."
          autoComplete="off"
        />
        <Button type="submit" size="icon">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
