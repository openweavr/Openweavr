import { useState, useEffect, useCallback, useRef } from 'react';

interface WebSocketMessage {
  type: string;
  payload: unknown;
  id?: string;
  timestamp?: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  messages: WebSocketMessage[];
  send: (message: WebSocketMessage) => void;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:3847`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        console.log('[ws] Connected to gateway');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setMessages((prev) => [...prev.slice(-99), message]);
        } catch (err) {
          console.error('[ws] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[ws] Disconnected, reconnecting in 3s...');
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[ws] Error:', err);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[ws] Failed to connect:', err);
      reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback((channels: string[]) => {
    send({ type: 'subscribe', payload: { channels } });
  }, [send]);

  const unsubscribe = useCallback((channels: string[]) => {
    send({ type: 'unsubscribe', payload: { channels } });
  }, [send]);

  return { connected, messages, send, subscribe, unsubscribe };
}
