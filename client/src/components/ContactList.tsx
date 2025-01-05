import { Plus } from "lucide-react";
import { Contact, useCreateContact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { validatePhoneNumber, formatPhoneNumber } from "@/lib/twilio";
import { cn } from "@/lib/utils";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  onSelect: (id: number) => void;
  selectedId: number | null;
}

export function ContactList({ contacts, isLoading, onSelect, selectedId }: ContactListProps) {
  const [open, setOpen] = useState(false);
  const createContact = useCreateContact();
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const phone = formatPhoneNumber(formData.get("phone") as string);
    const email = formData.get("email") as string;

    if (!validatePhoneNumber(phone)) {
      alert("Please enter a valid phone number");
      return;
    }

    await createContact.mutateAsync({ name, phone, email });
    setOpen(false);
  };

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Contacts</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Contact</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" name="phone" placeholder="+1" required />
                </div>
                <div>
                  <Label htmlFor="email">Email (Optional)</Label>
                  <Input id="email" name="email" type="email" />
                </div>
                <Button type="submit" className="w-full">
                  Add Contact
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <Input placeholder="Search contacts..." className="w-full" />
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => onSelect(contact.id)}
                className={cn(
                  "w-full p-3 rounded-md text-left hover:bg-accent transition-colors",
                  selectedId === contact.id && "bg-accent"
                )}
              >
                <div className="font-medium">{contact.name}</div>
                <div className="text-sm text-muted-foreground">{contact.phone}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
