import { useState } from "react";
import { useContacts } from "@/lib/api";
import { ContactList } from "@/components/ContactList";
import { MessageThread } from "@/components/MessageThread";
import { ThreadList } from "@/components/ThreadList";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

export function Dashboard() {
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const { data: contacts, isLoading } = useContacts();

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
        <div className="md:col-span-3 h-full flex flex-col">
          <ContactList
            contacts={contacts || []}
            isLoading={isLoading}
            onSelect={setSelectedContactId}
            selectedId={selectedContactId}
          />
        </div>

        <div className="md:col-span-9 h-full flex flex-col">
          {selectedContactId ? (
            <MessageThread contactId={selectedContactId} />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-card rounded-lg border">
              {isLoading ? (
                <div className="space-y-4 w-72">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <MessageSquare className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>Select a contact to view messages</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
