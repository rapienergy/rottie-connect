import { useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  contactNumber: string;
}

export function MessageThread({ contactNumber }: MessageThreadProps) {
  const { data: messages, isLoading: messagesLoading } = useMessages(contactNumber);
  const sendMessage = useSendMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const systemNumber = import.meta.env.VITE_TWILIO_PHONE_NUMBER || '';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const content = new FormData(form).get("content") as string;

    if (!content.trim()) return;

    try {
      await sendMessage.mutateAsync({ 
        contactNumber,
        content,
        channel: 'whatsapp'
      });
      form.reset();
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const formatMessageTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  // Helper to determine if a message is from the system
  const isSystemMessage = (message: any) => {
    const formattedSystem = `whatsapp:${systemNumber}`;
    return message.direction === "outbound" || 
           (message.metadata?.from === formattedSystem) ||
           (message.metadata?.to === message.contactNumber);
  };

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white">
          {messages?.[0]?.contactName || contactNumber}
        </h2>
        <p className="font-mono text-sm text-zinc-400">WhatsApp Business</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono">
        {messagesLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-3/4 bg-zinc-800" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {messages?.map((message) => {
              const isSystem = isSystemMessage(message);
              return (
                <div
                  key={message.id}
                  className={cn(
                    "text-sm whitespace-pre-wrap font-mono p-1 rounded",
                    isSystem
                      ? "bg-red-900/50 text-red-400"
                      : "bg-green-900/50 text-green-400"
                  )}
                >
                  {`${formatMessageTime(message.createdAt)} [${isSystem ? 'outbound' : 'inbound'}] ${message.content}`}
                  <span className="text-zinc-500"> :: {message.status}</span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-zinc-800 flex gap-2">
        <Input
          ref={inputRef}
          name="content"
          placeholder="Type your message..."
          autoComplete="off"
          className="bg-zinc-900 border-zinc-700 text-white font-mono"
        />
        <Button 
          type="submit" 
          size="icon" 
          className="bg-green-900 hover:bg-green-800"
          disabled={sendMessage.isPending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}