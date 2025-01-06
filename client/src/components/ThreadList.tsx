import { useMessages } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

interface ThreadListProps {
  contactId: number;
}

export function ThreadList({ contactId }: ThreadListProps) {
  const { data: messages, isLoading } = useMessages(contactId);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const formatMessageTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatDirection = (direction: string) => {
    return direction === 'outbound' ? 'rottie' : direction;
  };

  const isFromMainNumber = (number: string) => number.endsWith('6311');

  return (
    <ScrollArea className="h-[calc(100vh-12rem)]">
      <div className="space-y-4 p-4">
        {messages?.map((message) => {
          const fromNumber = message.direction === 'inbound' ? message.contactNumber : contactId.toString();
          const isMain = isFromMainNumber(fromNumber);

          return (
            <div
              key={message.id}
              className={`text-sm whitespace-pre-wrap font-mono ${
                isMain ? "text-red-400" : "text-green-400"
              }`}
            >
              {`${formatMessageTime(message.createdAt)} [${formatDirection(message.direction)}] ${message.content}`}
              <span className="text-zinc-500"> :: {message.status}</span>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}