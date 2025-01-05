import { TwilioSetup } from "@/components/TwilioSetup";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings as SettingsIcon } from "lucide-react";

export function Settings() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-6 w-6" />
              <CardTitle>Settings</CardTitle>
            </div>
            <CardDescription>
              Configure your Twilio integration and messaging preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TwilioSetup />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
