import { useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Phone, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  contactNumber: string;
}

export function MessageThread({ contactNumber }: MessageThreadProps) {
  const { data: messages, isLoading: messagesLoading } = useMessages(contactNumber);
  const sendMessage = useSendMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const content = new FormData(form).get("content") as string;

    if (!content.trim()) return;

    await sendMessage.mutateAsync({ 
      contactNumber, 
      content,
      channel: messages?.[0]?.metadata?.channel || 'whatsapp' 
    });
    form.reset();
  };

  const sortedMessages = messages?.slice().sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ) || [];

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white">
          {messages?.[0]?.contactName || contactNumber}
        </h2>
        <p className="font-mono text-sm text-zinc-400">
          Channel: {messages?.[0]?.metadata?.channel || 'whatsapp'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono bg-black">
        {messagesLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-3/4 bg-zinc-800" />
            ))}
          </div>
        ) : (
          sortedMessages.map((message) => {
            const time = new Date(message.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            });

            const isOutbound = message.direction === "outbound";
            const messageClass = cn(
              "flex items-center gap-2 p-3 rounded-lg",
              isOutbound ? "bg-green-600/20 text-green-400" : "bg-zinc-800 text-white"
            );

            const channelIcon = message.metadata?.channel === 'whatsapp' 
              ? <MessageSquare className="h-4 w-4" /> 
              : <Phone className="h-4 w-4" />;

            return (
              <div key={message.id} className={messageClass}>
                <span className="text-xs text-zinc-500">{time}</span>
                {channelIcon}
                <span>{message.content}</span>
                <span className="text-xs text-zinc-500 ml-auto">{message.status}</span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-zinc-800 flex gap-2">
        <Input
          name="content"
          placeholder="Type your message..."
          autoComplete="off"
          className="bg-zinc-900 border-zinc-700 text-white font-mono"
        />
        <Button type="submit" size="icon" className="bg-zinc-800 hover:bg-zinc-700">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}