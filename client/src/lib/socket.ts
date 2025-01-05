import { queryClient } from "./queryClient";

let socket: WebSocket | null = null;
let reconnectTimeout: number | null = null;

export function connectWebSocket() {
  if (socket) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "message_created":
        // Invalidate both the messages list and conversations list
        queryClient.invalidateQueries({
          queryKey: [`/api/conversations/${data.message.contactNumber}/messages`],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/conversations"],
        });
        break;
      case "contact_created":
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        break;
    }
  };

  socket.onclose = () => {
    socket = null;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = window.setTimeout(connectWebSocket, 5000);
  };

  // Keep connection alive
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
}

export function disconnectWebSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}