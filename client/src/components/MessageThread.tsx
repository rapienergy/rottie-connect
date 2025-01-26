import { useEffect, useRef, useState } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, Phone, PhoneOff, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";

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
    createdAt: string;
    metadata?: {
      channel: 'whatsapp' | 'sms' | 'voice' | 'mail';
      callDuration?: number;
      recordingUrl?: string;
      transcription?: string;
    };
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
  const [content, setContent] = useState("");

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!content.trim()) {
      toast({
        title: "Cannot send empty message",
        variant: "destructive",
      });
      return;
    }

    try {
      await sendMessage.mutateAsync({
        contactNumber,
        content: content.trim(),
        channel: 'whatsapp'
      });

      // Clear input after successful send
      setContent("");
      inputRef.current?.focus();

      toast({
        title: "Message sent",
        description: "Your message has been sent successfully.",
      });
    } catch (error: any) {
      console.error('Failed to send message:', error);
      toast({
        title: "Failed to send message",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
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

  const isRottieMessage = (direction: string) => {
    return direction === 'rottie' || direction === 'outbound-api' || direction.startsWith('outbound');
  };

  const formatDirection = (direction: string) => {
    return isRottieMessage(direction) ? 'rottie' : direction;
  };

  const formatInteractionTime = (dateStr?: string) => {
    if (!dateStr) return '';
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  };

  const formatCallDuration = (seconds?: number) => {
    if (!seconds) return '0s';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 
      ? `${minutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`;
  };

  const getCallIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <Phone className="h-4 w-4 text-green-400" />;
      case 'failed':
      case 'busy':
      case 'no-answer':
        return <PhoneOff className="h-4 w-4 text-red-400" />;
      default:
        return <PhoneCall className="h-4 w-4 text-yellow-400" />;
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

      <div className="flex-1 overflow-y-auto p-4 space-y-6 font-mono">
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
                    className={cn(
                      "text-sm whitespace-pre-wrap",
                      message.metadata?.channel === 'voice' 
                        ? "flex items-center gap-2" 
                        : "",
                      isRottieMessage(message.direction) ? "text-blue-400" : "text-green-400"
                    )}
                  >
                    {message.metadata?.channel === 'voice' ? (
                      <>
                        {getCallIcon(message.status)}
                        <span>
                          {`${formatMessageTime(message.createdAt)} [${formatDirection(message.direction)}] Voice Call - ${message.status}`}
                          {message.metadata.callDuration && (
                            <span className="text-zinc-500"> • Duration: {formatCallDuration(message.metadata.callDuration)}</span>
                          )}
                          {message.metadata.recordingUrl && (
                            <a 
                              href={message.metadata.recordingUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="ml-2 text-blue-500 hover:underline"
                            >
                              Recording
                            </a>
                          )}
                          {message.metadata.transcription && (
                            <div className="mt-1 text-zinc-400 text-xs">
                              Transcription: {message.metadata.transcription}
                            </div>
                          )}
                        </span>
                      </>
                    ) : (
                      `${formatMessageTime(message.createdAt)} [${formatDirection(message.direction)}] ${message.content}`
                    )}
                    <span className="text-zinc-500"> :: {message.status}</span>
                  </div>
                ))}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-800 flex gap-2">
        <Input
          ref={inputRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          autoComplete="off"
          className="bg-zinc-900 border-zinc-700 text-white font-mono"
          disabled={sendMessage.isPending}
        />
        <Button 
          type="submit"
          size="icon"
          className="bg-green-900 hover:bg-green-800"
          disabled={sendMessage.isPending || !content.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}