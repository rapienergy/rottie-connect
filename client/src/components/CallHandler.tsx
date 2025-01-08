import { useEffect, useState } from 'react';
import { Device } from 'twilio-client';
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

let currentDevice: Device | null = null;

export function CallHandler() {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeConnection, setActiveConnection] = useState<any>(null);

  useEffect(() => {
    const setupDevice = async () => {
      try {
        // Get capability token from your endpoint
        const response = await fetch('/api/voice/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        const data = await response.json();
        if (!data.token) throw new Error('Failed to get token');

        // Setup Twilio Device
        if (!currentDevice) {
          console.log('Initializing Twilio Device...');
          currentDevice = new Device();
          await currentDevice.setup(data.token, {
            debug: true,
            warnings: true,
            enableRingingState: true
          });
        }

        currentDevice.on('ready', () => {
          console.log('Twilio.Device Ready!');
          setIsReady(true);
        });

        currentDevice.on('error', (error) => {
          console.error('Twilio.Device Error:', error);
          toast({
            title: "Call Error",
            description: error.message,
            variant: "destructive",
          });
        });

        currentDevice.on('connect', (conn) => {
          console.log('Call connected!');
          setIsConnected(true);
          setActiveConnection(conn);
        });

        currentDevice.on('disconnect', () => {
          console.log('Call disconnected');
          setIsConnected(false);
          setActiveConnection(null);
          setIsMuted(false);
        });

      } catch (error: any) {
        console.error('Error setting up Twilio device:', error);
        toast({
          title: "Setup Error",
          description: error.message,
          variant: "destructive",
        });
      }
    };

    setupDevice();

    return () => {
      if (currentDevice) {
        currentDevice.destroy();
        currentDevice = null;
      }
    };
  }, []);

  const toggleMute = () => {
    if (activeConnection) {
      if (isMuted) {
        activeConnection.mute(false);
      } else {
        activeConnection.mute(true);
      }
      setIsMuted(!isMuted);
    }
  };

  const disconnectCall = () => {
    if (currentDevice) {
      currentDevice.disconnectAll();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 flex gap-2">
      {isConnected && (
        <>
          <Button
            variant={isMuted ? "destructive" : "default"}
            size="icon"
            onClick={toggleMute}
          >
            {isMuted ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="destructive"
            size="icon"
            onClick={disconnectCall}
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
        </>
      )}
      {!isConnected && isReady && (
        <div className="bg-green-600 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Ready for calls
        </div>
      )}
    </div>
  );
}