import { useState, useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
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
      toast({
        title: "Success",
        description: "Message sent successfully",
      });
    } catch (error: any) {
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
    //This function was removed in the edited code, but its usage remains in the original, so I have restored it.  It may need further adjustments depending on the date-fns library version.
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


  // Group messages by date
  const groupedMessages = data?.messages?.reduce<Record<string, typeof data.messages>>((groups, msg) => {
    const date = format(new Date(msg.createdAt), 'yyyy-MM-dd');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(msg);
    return groups;
  }, {}) || {};

  const messages = (data as MessageResponse)?.messages || [];
  const stats = (data as MessageResponse)?.stats;

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
            {Object.entries(groupedMessages).map(([date, messages]) => (
              <div key={date} className="space-y-2">
                <div className="sticky top-0 bg-black/50 backdrop-blur-sm py-2">
                  <div className="text-xs text-zinc-500 text-center">
                    {formatMessageDate(date)}
                  </div>
                </div>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "text-sm whitespace-pre-wrap",
                      msg.metadata?.channel === 'voice' ? "flex items-center gap-2" : "",
                      isRottieMessage(msg.direction) ? "text-blue-400" : "text-green-400"
                    )}
                  >
                    {msg.metadata?.channel === 'voice' ? (
                      <>
                        {getCallIcon(msg.status)}
                        <span>
                          {`${formatMessageTime(msg.createdAt)} [${formatDirection(msg.direction)}] Voice Call - ${msg.status}`}
                          {msg.metadata.callDuration && (
                            <span className="text-zinc-500"> • Duration: {formatCallDuration(msg.metadata.callDuration)}</span>
                          )}
                          {msg.metadata.recordingUrl && (
                            <a
                              href={msg.metadata.recordingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-blue-500 hover:underline"
                            >
                              Recording
                            </a>
                          )}
                          {msg.metadata.transcription && (
                            <div className="mt-1 text-zinc-400 text-xs">
                              Transcription: {msg.metadata.transcription}
                            </div>
                          )}
                        </span>
                      </>
                    ) : (
                      `${formatMessageTime(msg.createdAt)} [${formatDirection(msg.direction)}] ${msg.content}`
                    )}
                    <span className="text-zinc-500"> :: {msg.status}</span>
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