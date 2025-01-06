import { useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";

interface MessageThreadProps {
  contactNumber: string;
}

interface MessageResponse {
  messages: Array<{
    id: string | number;
    contactNumber: string;
    contactName?: string | null;
    content: string;
    direction: string;
    status: string;
    twilioSid?: string;
    metadata?: {
      channel?: string;
      type?: 'text' | 'media' | 'voice';
    };
    createdAt: string;
  }>;
  stats: {
    total: number;
    sent: number;
    received: number;
    firstInteraction?: string;
    lastInteraction?: string;
  };
}

export function MessageThread({ contactNumber }: MessageThreadProps) {
  const { data, isLoading } = useMessages(contactNumber);
  const messages = (data as MessageResponse)?.messages || [];
  const stats = (data as MessageResponse)?.stats;
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
    const date = new Date(dateStr);
    return format(date, 'h:mm:ss a');
  };

  const formatMessageDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMM d, yyyy');
  };

  const formatDirection = (direction: string) => {
    return direction.startsWith('outbound') ? 'rottie' : 'customer';
  };

  const formatInteractionTime = (dateStr?: string) => {
    if (!dateStr) return '';
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  };

  const getMessageColorClasses = (message: MessageResponse['messages'][0]) => {
    // Base styles for all messages
    const baseClasses = "text-sm whitespace-pre-wrap font-mono";

    // Direction-based colors
    const directionColor = message.direction.startsWith('outbound') 
      ? "text-blue-400" // Rottie messages
      : "text-green-400"; // Customer messages

    // Status-based background highlights
    let statusHighlight = "";
    switch (message.status) {
      case 'failed':
        statusHighlight = "bg-red-900/20";
        break;
      case 'delivered':
        statusHighlight = "bg-zinc-900/20";
        break;
      case 'sent':
        statusHighlight = "bg-blue-900/20";
        break;
      default:
        statusHighlight = "bg-zinc-900/10";
    }

    // Message type indicators
    const typeStyle = message.metadata?.type === 'media' 
      ? "italic"
      : message.metadata?.type === 'voice' 
        ? "font-bold" 
        : "";

    return cn(baseClasses, directionColor, statusHighlight, typeStyle);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'delivered':
        return "text-green-500";
      case 'sent':
        return "text-blue-500";
      case 'failed':
        return "text-red-500";
      default:
        return "text-zinc-500";
    }
  };

  // Group messages by date with proper typing
  const groupedMessages = messages.reduce<Record<string, typeof messages>>((groups, message) => {
    const date = format(new Date(message.createdAt), 'yyyy-MM-dd');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {});

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white">
          {messages[0]?.contactName || contactNumber}
        </h2>
        <p className="font-mono text-sm text-zinc-400">
          WhatsApp Business • {stats && (
            <>
              {stats.total} messages ({stats.sent} sent, {stats.received} received)
              {stats.firstInteraction && (
                <span className="ml-2">
                  • First interaction: {formatInteractionTime(stats.firstInteraction)}
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-3/4 bg-zinc-800" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedMessages).map(([date, dateMessages]) => (
              <div key={date} className="space-y-2">
                <div className="sticky top-0 bg-black/50 backdrop-blur-sm py-2">
                  <div className="text-xs text-zinc-500 text-center">
                    {formatMessageDate(date)}
                  </div>
                </div>
                {dateMessages.map((message) => (
                  <div
                    key={`${message.id}-${message.twilioSid}`}
                    className={getMessageColorClasses(message)}
                  >
                    {`${formatMessageTime(message.createdAt)} [${formatDirection(message.direction)}] ${message.content}`}
                    <span className={cn("ml-2", getStatusColor(message.status))}>
                      :: {message.status}
                    </span>
                  </div>
                ))}
              </div>
            ))}
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