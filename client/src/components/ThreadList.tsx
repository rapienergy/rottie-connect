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

  return (
    <ScrollArea className="h-[calc(100vh-12rem)]">
      <div className="space-y-4 p-4">
        {messages?.map((message) => (
          <Card key={message.id} className="p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium">
                {message.direction === "inbound" ? "Received" : "Sent"}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm">{message.content}</p>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
