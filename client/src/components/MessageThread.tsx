import { useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  contactNumber: string;
}

export function MessageThread({ contactNumber }: MessageThreadProps) {
  const { data: messages, isLoading: messagesLoading } = useMessages(contactNumber);
  const sendMessage = useSendMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'read':
        return <CheckCheck className="h-3 w-3 inline-block ml-1" />;
      case 'delivered':
        return <Check className="h-3 w-3 inline-block ml-1" />;
      default:
        return null;
    }
  };

  // Helper to determine if a message is outbound (from us to client)
  const isOutboundMessage = (message: any) => {
    return message.direction === "outbound";
  };

  // Sort messages by time
  const sortedMessages = messages?.slice().sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white">
          {sortedMessages?.[0]?.contactName || contactNumber}
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
            {sortedMessages?.map((message) => {
              const isOutbound = isOutboundMessage(message);
              return (
                <div
                  key={message.id}
                  className={cn(
                    "text-sm whitespace-pre-wrap font-mono p-2 rounded flex items-start gap-2",
                    isOutbound ? "bg-red-900 text-red-400" : "bg-green-900 text-green-400"
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs opacity-70">{formatMessageTime(message.createdAt)}</span>
                      <span className="text-xs px-1 rounded bg-opacity-20 bg-current">
                        {isOutbound ? 'outbound' : 'inbound'}
                      </span>
                    </div>
                    <div className="mt-1">{message.content}</div>
                  </div>
                  <div className="text-xs opacity-70 flex items-center">
                    {message.status}
                    {getStatusIcon(message.status)}
                  </div>
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