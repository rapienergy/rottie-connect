import { useState } from "react";
import { useConversations } from "@/lib/api";
import { MessageThread } from "@/components/MessageThread";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, AlertCircle, Phone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function Dashboard() {
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const { data: conversations, isLoading } = useConversations();
  const { data: twilioStatus } = useQuery({
    queryKey: ["/api/twilio/status"],
    refetchInterval: 30000, // Check connection every 30 seconds
  });

  const initiateVoiceCall = async (contactNumber: string) => {
    try {
      const response = await fetch('/api/voice/calls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contactNumber }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Call initiated",
          description: `Calling ${contactNumber}...`,
        });
      } else {
        throw new Error(data.message || 'Failed to initiate call');
      }
    } catch (error: any) {
      toast({
        title: "Call failed",
        description: error.message,
        variant: "destructive",
      });
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

  const isRottieMessage = (direction: string) => {
    return direction === 'rottie' || direction === 'outbound-api' || direction.startsWith('outbound');
  };

  const formatDirection = (direction: string) => {
    return isRottieMessage(direction) ? 'rottie' : direction;
  };

  return (
    <div className="container mx-auto px-4 py-6">
      {twilioStatus && (
        <div className={`mb-4 p-2 rounded-md font-mono text-sm ${
          twilioStatus.status === 'connected'
            ? 'bg-zinc-800 text-green-400'
            : 'bg-red-900/50 text-red-400'
        }`}>
          {twilioStatus.status === 'connected' ? (
            `Connected to WhatsApp Business API (${twilioStatus.friendlyName}) - Number: ${twilioStatus.whatsappNumber}`
          ) : (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>WhatsApp Connection Error: {twilioStatus.message}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
        <div className="md:col-span-3 h-full flex flex-col bg-black rounded-lg border border-zinc-800">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="font-mono text-white mb-2">WhatsApp Conversations</h2>
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
                {conversations?.filter(conv => conv.channel === 'whatsapp').map((conversation) => (
                  <div key={conversation.contactNumber} className="flex flex-col gap-2">
                    <button
                      onClick={() => setSelectedNumber(conversation.contactNumber)}
                      className={cn(
                        "w-full p-3 rounded-md text-left font-mono hover:bg-zinc-900 transition-colors",
                        selectedNumber === conversation.contactNumber ? 'bg-zinc-900' : ''
                      )}
                    >
                      <div className="text-sm text-white">
                        {conversation.contactNumber}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {`${formatMessageTime(conversation.latestMessage.createdAt)} [${
                          formatDirection(conversation.latestMessage.direction)
                        }]`}
                      </div>
                      <div className={cn(
                        "text-sm truncate",
                        isRottieMessage(conversation.latestMessage.direction) ? "text-blue-400" : "text-zinc-400"
                      )}>
                        {conversation.latestMessage.content}
                      </div>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-zinc-900 hover:bg-zinc-800 border-zinc-700"
                      onClick={() => initiateVoiceCall(conversation.contactNumber)}
                    >
                      <Phone className="w-4 h-4 mr-2" />
                      Call as Landline
                    </Button>
                  </div>
                ))}

                {conversations?.length === 0 && (
                  <div className="text-center text-zinc-400 font-mono p-4">
                    <p>No WhatsApp conversations yet</p>
                    <p className="text-xs mt-2">Messages will appear here when received</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

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