import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTwilioConfig, useUpdateTwilioConfig } from "@/lib/api";
import { twilioConfigSchema, type TwilioFormData } from "@/lib/twilio";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function TwilioSetup() {
  const { data: config, isLoading } = useTwilioConfig();
  const updateConfig = useUpdateTwilioConfig();

  const form = useForm<TwilioFormData>({
    resolver: zodResolver(twilioConfigSchema),
    defaultValues: {
      accountSid: config?.accountSid || "",
      authToken: config?.authToken || "",
      phoneNumber: config?.phoneNumber || "",
    },
    values: config || undefined,
  });

  const onSubmit = async (data: TwilioFormData) => {
    await updateConfig.mutateAsync(data);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Configure your Twilio credentials to enable SMS messaging. You can find these
          details in your Twilio Console.
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="accountSid"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Account SID</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="authToken"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Auth Token</FormLabel>
                <FormControl>
                  <Input {...field} type="password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phoneNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="+1234567890" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full">
            Save Configuration
          </Button>
        </form>
      </Form>
    </div>
  );
}
