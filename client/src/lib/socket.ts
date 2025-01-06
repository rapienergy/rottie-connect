import { queryClient } from "./queryClient";

let socket: WebSocket | null = null;
let reconnectTimeout: number | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;

export type WebSocketStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
let socketStatus: WebSocketStatus = 'disconnected';
const statusListeners: ((status: WebSocketStatus) => void)[] = [];

export function subscribeToSocketStatus(listener: (status: WebSocketStatus) => void) {
  statusListeners.push(listener);
  // Immediately notify of current status
  listener(socketStatus);

  // Return unsubscribe function
  return () => {
    const index = statusListeners.indexOf(listener);
    if (index > -1) {
      statusListeners.splice(index, 1);
    }
  };
}

function updateSocketStatus(newStatus: WebSocketStatus) {
  socketStatus = newStatus;
  statusListeners.forEach(listener => listener(newStatus));
}

function getReconnectDelay(): number {
  // Exponential backoff with a maximum of 30 seconds
  return Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 30000);
}

export function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN) return;

  updateSocketStatus('connecting');

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    console.log('WebSocket connected');
    updateSocketStatus('connected');
    reconnectAttempts = 0; // Reset reconnect attempts on successful connection
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      switch (data.type) {
        case "message_created":
          // Ensure we don't duplicate messages by checking if they already exist
          const messageExists = (queryData: any[], message: any) => {
            return queryData?.some(msg => msg.id === message.id || msg.twilioSid === message.twilioSid);
          };

          // Update the messages cache for the specific conversation
          queryClient.setQueryData(
            [`/api/conversations/${data.message.contactNumber}/messages`],
            (oldData: any) => {
              if (!oldData) return [data.message];
              if (messageExists(oldData, data.message)) return oldData;
              return [...oldData, data.message];
            }
          );

          // Update conversations list
          queryClient.setQueryData(['/api/conversations'], (oldData: any) => {
            if (!oldData) return [data.message];

            const existingConversationIndex = oldData.findIndex(
              (conv: any) => conv.contactNumber === data.message.contactNumber
            );

            if (existingConversationIndex === -1) {
              return [{
                contactNumber: data.message.contactNumber,
                contactName: data.message.contactName,
                latestMessage: {
                  content: data.message.content,
                  direction: data.message.direction,
                  status: data.message.status,
                  createdAt: data.message.createdAt
                },
                channel: data.message.metadata?.channel || 'whatsapp'
              }, ...oldData];
            }

            const updatedConversations = [...oldData];
            updatedConversations[existingConversationIndex] = {
              ...updatedConversations[existingConversationIndex],
              contactName: data.message.contactName,
              latestMessage: {
                content: data.message.content,
                direction: data.message.direction,
                status: data.message.status,
                createdAt: data.message.createdAt
              }
            };
            return updatedConversations;
          });
          break;

        case "message_status_updated":
          // Update message status in the messages cache
          queryClient.setQueryData(
            [`/api/conversations/${data.message.contactNumber}/messages`],
            (oldData: any) => {
              if (!oldData) return oldData;
              return oldData.map((msg: any) => 
                msg.twilioSid === data.message.twilioSid 
                  ? { ...msg, status: data.message.status }
                  : msg
              );
            }
          );

          // Update status in conversations list
          queryClient.setQueryData(['/api/conversations'], (oldData: any) => {
            if (!oldData) return oldData;
            return oldData.map((conv: any) => {
              if (conv.contactNumber === data.message.contactNumber) {
                return {
                  ...conv,
                  latestMessage: {
                    ...conv.latestMessage,
                    status: data.message.status
                  }
                };
              }
              return conv;
            });
          });
          break;

        case "pong":
          console.log('Server pong received');
          break;
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateSocketStatus('error');
  };

  socket.onclose = () => {
    console.log('WebSocket closed');
    socket = null;
    updateSocketStatus('disconnected');

    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Attempt to reconnect if we haven't exceeded max attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = getReconnectDelay();
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      reconnectTimeout = window.setTimeout(connectWebSocket, delay);
    } else {
      console.log('Max reconnection attempts reached');
      updateSocketStatus('error');
    }
  };

  // Keep connection alive with ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" }));
    } else if (!socket || socket.readyState === WebSocket.CLOSED) {
      clearInterval(pingInterval);
    }
  }, 30000);
}

export function disconnectWebSocket() {
  statusListeners.length = 0; // Clear all listeners

  if (socket) {
    socket.close();
    socket = null;
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  reconnectAttempts = 0;
  updateSocketStatus('disconnected');
}

// Automatically reconnect when the window regains focus
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reconnectAttempts = 0; // Reset attempts when user actively tries to reconnect
      connectWebSocket();
    }
  });
}