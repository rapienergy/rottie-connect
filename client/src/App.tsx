import { Switch, Route, Link } from "wouter";
import { Dashboard } from "@/pages/Dashboard";
import AuthPage from "@/pages/auth-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { connectWebSocket, disconnectWebSocket } from "@/lib/socket";

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      connectWebSocket();
      return () => disconnectWebSocket();
    }
  }, [token]);

  // If no token, show auth page
  if (!token) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex flex-col items-start">
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-6 w-6" />
                <span className="font-semibold text-lg">Rottie Connect</span>
              </div>
              <span className="text-sm text-muted-foreground ml-8">
                Rapienergy Enterprise Interactions Platform
              </span>
            </Link>
            <Button 
              variant="outline" 
              onClick={() => {
                localStorage.removeItem('token');
                setToken(null);
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <Switch>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-[calc(100vh-4rem)] w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 p-6">
        <div className="flex gap-2 mb-4">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <h1 className="text-2xl font-bold">404 Page Not Found</h1>
        </div>
        <p className="text-muted-foreground mb-4">
          The page you're looking for doesn't exist.
        </p>
        <Link href="/">
          <Button>Return Home</Button>
        </Link>
      </Card>
    </div>
  );
}

export default App;