import { useState } from "react";
import { useConversations } from "@/lib/api";
import { MessageThread } from "@/components/MessageThread";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

export function Dashboard() {
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const { data: conversations, isLoading } = useConversations();

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
        {/* Conversations List */}
        <div className="md:col-span-3 h-full flex flex-col bg-black rounded-lg border border-zinc-800">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="font-mono text-white mb-2">Conversations</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-zinc-800" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {conversations?.map((conversation) => {
                  const time = new Date(conversation.latestMessage.createdAt)
                    .toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true
                    });

                  return (
                    <button
                      key={conversation.contactNumber}
                      onClick={() => setSelectedNumber(conversation.contactNumber)}
                      className="w-full p-3 rounded-md text-left font-mono hover:bg-zinc-900 transition-colors"
                    >
                      <div className="text-white">
                        {`${time} [${conversation.channel}] ${conversation.contactName || conversation.contactNumber}`}
                      </div>
                      <div className="text-sm text-zinc-400 truncate">
                        {conversation.latestMessage.content}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Message Thread */}
        <div className="md:col-span-9 h-full flex flex-col">
          {selectedNumber ? (
            <MessageThread contactNumber={selectedNumber} />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-black rounded-lg border border-zinc-800">
              {isLoading ? (
                <div className="space-y-4 w-72">
                  <Skeleton className="h-4 w-full bg-zinc-800" />
                  <Skeleton className="h-4 w-3/4 bg-zinc-800" />
                </div>
              ) : (
                <div className="text-center text-zinc-400 font-mono">
                  <MessageSquare className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>Select a conversation to view messages</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}