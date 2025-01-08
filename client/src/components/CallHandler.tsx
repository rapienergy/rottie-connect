import { useEffect, useState } from 'react';
import { Device } from 'twilio-client';
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// Ensure we have only one device instance
let currentDevice: any = null;
let reconnectTimeout: number | null = null;

export function CallHandler() {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeConnection, setActiveConnection] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;

    const setupDevice = async () => {
      try {
        // Clean up existing device if any
        if (currentDevice) {
          try {
            currentDevice.destroy();
          } catch (e) {
            console.warn('Error destroying device:', e);
          }
          currentDevice = null;
        }

        // Get capability token
        const response = await fetch('/api/voice/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to get token: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.token) {
          throw new Error('Token not received from server');
        }

        // Initialize Device with debug mode
        console.log('Initializing Twilio Device...');

        // Create device without type checking to avoid browser compatibility issues
        currentDevice = window.Twilio ? new window.Twilio.Device(data.token, {
          debug: true,
          warnings: true,
          enableRingingState: true,
          // Add audio constraints for better voice quality
          audioConstraints: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          }
        }) : null;

        if (!currentDevice) {
          throw new Error('Failed to initialize Twilio Device');
        }

        // Event Handlers
        currentDevice.on('ready', () => {
          console.log('Twilio Device Ready');
          if (isMounted) setIsReady(true);
        });

        currentDevice.on('error', (error: any) => {
          console.error('Twilio Device Error:', error);
          toast({
            title: "Call System Error",
            description: error.message || 'An error occurred with the call system',
            variant: "destructive",
          });
        });

        currentDevice.on('connect', (conn: any) => {
          console.log('Call Connected');
          if (isMounted) {
            setIsConnected(true);
            setActiveConnection(conn);
          }
        });

        currentDevice.on('disconnect', () => {
          console.log('Call Disconnected');
          if (isMounted) {
            setIsConnected(false);
            setActiveConnection(null);
            setIsMuted(false);
          }
        });

        currentDevice.on('incoming', (conn: any) => {
          console.log('Incoming call from:', conn.parameters.From);
          toast({
            title: "Incoming Call",
            description: `Call from ${conn.parameters.From}`,
          });
        });

      } catch (error: any) {
        console.error('Error setting up Twilio device:', error);
        toast({
          title: "Setup Error",
          description: error.message || 'Failed to initialize call system',
          variant: "destructive",
        });
      }
    };

    // Load Twilio Client script dynamically
    const loadTwilioScript = () => {
      return new Promise((resolve, reject) => {
        if (window.Twilio) {
          resolve(window.Twilio);
          return;
        }

        const script = document.createElement('script');
        script.src = "//sdk.twilio.com/js/client/releases/1.13.0/twilio.min.js";
        script.onload = () => resolve(window.Twilio);
        script.onerror = reject;
        document.body.appendChild(script);
      });
    };

    // Initialize device after loading Twilio script
    loadTwilioScript()
      .then(() => setupDevice())
      .catch(error => {
        console.error('Failed to load Twilio script:', error);
        toast({
          title: "Setup Error",
          description: "Failed to load call system. Please refresh the page.",
          variant: "destructive",
        });
      });

    // Cleanup function
    return () => {
      isMounted = false;
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (currentDevice) {
        console.log('Cleaning up Twilio Device');
        try {
          currentDevice.destroy();
        } catch (e) {
          console.warn('Error during cleanup:', e);
        }
        currentDevice = null;
      }
    };
  }, []);

  const toggleMute = () => {
    if (activeConnection) {
      if (isMuted) {
        console.log('Unmuting call');
        activeConnection.mute(false);
      } else {
        console.log('Muting call');
        activeConnection.mute(true);
      }
      setIsMuted(!isMuted);
    }
  };

  const disconnectCall = () => {
    console.log('Disconnecting all calls');
    if (currentDevice) {
      try {
        currentDevice.disconnectAll();
      } catch (e) {
        console.error('Error disconnecting calls:', e);
      }
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
            className="bg-zinc-800 hover:bg-zinc-700"
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
        <div className="bg-green-600/20 text-green-400 px-3 py-1 rounded-full text-sm flex items-center gap-2 border border-green-500/20">
          <Phone className="h-4 w-4" />
          Ready for calls
        </div>
      )}
    </div>
  );
}

// Add global Twilio type
declare global {
  interface Window {
    Twilio: any;
  }
}