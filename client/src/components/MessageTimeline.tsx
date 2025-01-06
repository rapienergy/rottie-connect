import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface TimelineProps {
  messages: Array<{
    id: string | number;
    direction: string;
    status: string;
    createdAt: string;
    content: string;
  }>;
  onSelectMessage?: (messageId: string | number) => void;
  selectedMessageId?: string | number;
}

export function MessageTimeline({ messages, onSelectMessage, selectedMessageId }: TimelineProps) {
  // Group messages by date for the timeline
  const messagesByDate = messages.reduce<Record<string, typeof messages>>((acc, message) => {
    const date = format(new Date(message.createdAt), 'yyyy-MM-dd');
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(message);
    return acc;
  }, {});

  return (
    <div className="w-full p-4 bg-black border-t border-zinc-800">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-blue-400" />
        <span className="text-xs font-mono text-zinc-400">Outgoing</span>
        <div className="h-2 w-2 rounded-full bg-green-400 ml-4" />
        <span className="text-xs font-mono text-zinc-400">Incoming</span>
      </div>
      
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-2 top-0 bottom-0 w-px bg-zinc-800" />
        
        {/* Timeline events */}
        <div className="space-y-4">
          {Object.entries(messagesByDate).map(([date, dateMessages]) => (
            <div key={date} className="relative">
              {/* Date label */}
              <div className="sticky top-0 z-10 bg-black/50 backdrop-blur-sm py-2 mb-2">
                <span className="text-xs font-mono text-zinc-500 ml-6">
                  {format(new Date(date), 'MMM d, yyyy')}
                </span>
              </div>
              
              {/* Messages for this date */}
              <div className="space-y-2">
                {dateMessages.map((message) => (
                  <button
                    key={message.id}
                    onClick={() => onSelectMessage?.(message.id)}
                    className={cn(
                      "relative flex items-center group w-full pl-6 py-1",
                      "hover:bg-zinc-900/50 rounded transition-colors",
                      selectedMessageId === message.id && "bg-zinc-900/50"
                    )}
                  >
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute left-2 w-2 h-2 rounded-full transform -translate-x-1/2",
                        message.direction === 'inbound' ? "bg-green-400" : "bg-blue-400"
                      )}
                    />
                    
                    {/* Message preview */}
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-xs font-mono",
                          message.direction === 'inbound' ? "text-green-400" : "text-blue-400"
                        )}>
                          {format(new Date(message.createdAt), 'h:mm:ss a')}
                        </span>
                        <span className="text-xs font-mono text-zinc-500">
                          [{message.direction === 'inbound' ? 'inbound' : 'rottie'}]
                        </span>
                      </div>
                      <p className="text-xs font-mono text-zinc-400 truncate">
                        {message.content}
                      </p>
                    </div>
                    
                    {/* Status indicator */}
                    <span className="text-xs font-mono text-zinc-600 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {message.status}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
