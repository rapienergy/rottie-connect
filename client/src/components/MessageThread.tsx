import { useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Send } from "lucide-react";
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
      channel: 'whatsapp'
    });
    form.reset();
  };

  const sortedMessages = messages?.slice().sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ) || [];

  return (
    <div className="h-full flex flex-col bg-black rounded-lg border border-zinc-800">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="font-mono text-white mb-1">
          {messages?.[0]?.contactName || contactNumber}
        </h2>
        <p className="text-xs text-zinc-400">WhatsApp Conversation</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messagesLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-3/4 bg-zinc-800" />
            ))}
          </div>
        ) : (
          sortedMessages.map((message) => {
            const time = new Date(message.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });

            const isOutbound = message.direction === "outbound";
            const messageClass = cn(
              "flex flex-col max-w-[80%] space-y-1 rounded-lg p-3",
              isOutbound ? 
                "bg-green-600/20 text-green-400 ml-auto" : 
                "bg-zinc-800 text-white"
            );

            return (
              <div key={message.id} className={messageClass}>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="flex-1">{message.content}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{time}</span>
                  <span>{message.status}</span>
                </div>
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