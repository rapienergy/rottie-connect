import { useState, useEffect, useRef } from "react";
import { useMessages, useSendMessage, type Message } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  contactNumber: string;
}

export function MessageThread({ contactNumber }: MessageThreadProps) {
  const { data, isLoading } = useMessages(contactNumber);
  const sendMessage = useSendMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Message cannot be empty",
        variant: "destructive",
      });
      return;
    }

    try {
      await sendMessage.mutateAsync({
        contactNumber,
        content: message.trim(),
        channel: 'whatsapp'
      });
      setMessage(""); // Clear input after successful send
    } catch (error: any) {
      console.error("Failed to send message:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isRottieMessage = (direction: string) => {
    return direction === 'rottie' || direction === 'outbound-api' || direction.startsWith('outbound');
  };

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white">{contactNumber}</h2>
        {data?.stats && (
          <p className="font-mono text-sm text-zinc-400">
            WhatsApp Business • {data.stats.total} messages ({data.stats.sent} sent, {data.stats.received} received)
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono">
        {isLoading ? (
          <div className="text-center text-zinc-400">Loading messages...</div>
        ) : !data?.messages || data.messages.length === 0 ? (
          <div className="text-center text-zinc-400">
            <p>Ready to send messages</p>
            <p className="text-sm mt-2">Type your message below to start the conversation</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.messages.map((msg: Message) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  isRottieMessage(msg.direction) ? "justify-end" : "justify-start"
                )}
              >
                <div 
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-2 text-sm break-words",
                    isRottieMessage(msg.direction) 
                      ? "bg-blue-600 text-white" 
                      : "bg-green-600 text-white"
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="font-mono">
                      {msg.content}
                    </div>
                    <div className="text-[10px] opacity-70">
                      {new Date(msg.createdAt).toLocaleTimeString()} • {msg.status}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-zinc-800 flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          autoComplete="off"
          className="bg-zinc-900 border-zinc-700 text-white font-mono"
          disabled={sendMessage.isPending}
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="bg-green-900 hover:bg-green-800"
          disabled={sendMessage.isPending || !message.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}