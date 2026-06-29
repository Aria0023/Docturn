import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface WebSocketContextValue {
  status: ConnectionStatus;
}

const WebSocketContext = createContext<WebSocketContextValue>({ status: 'closed' });

export function useWebSocketStatus() {
  return useContext(WebSocketContext);
}

const EVENT_INVALIDATIONS: Record<string, string[][]> = {
  'assignment.created': [['assignments']],
  'assignment.accepted': [['assignments']],
  'assignment.rejected': [['assignments']],
  'assignment.reassigned': [['assignments']],
  'assignment.cancelled': [['assignments']],
  'assignment.expired': [['assignments']],
  'message.new': [['conversations'], ['messages']],
  'message.deleted': [['messages']],
  'broadcast.new': [['broadcasts']],
  'presence.online': [['presence']],
  'presence.offline': [['presence']],
  'patient.created': [['patients']],
  'patient.updated': [['patients']],
  'hospitalist.updated': [['hospitalists']],
};

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      const url = `${location.origin.replace(/^http/, 'ws')}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        attemptsRef.current = 0;
        setStatus('open');
      };

      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (!data || typeof data !== 'object' || !('type' in data)) return;
        const type = String((data as { type: unknown }).type);
        const keys = EVENT_INVALIDATIONS[type];
        if (keys) {
          for (const key of keys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }
      };

      ws.onclose = () => {
        setStatus('closed');
        if (!closedRef.current) scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      const attempt = attemptsRef.current++;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      reconnectRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [queryClient]);

  return (
    <WebSocketContext.Provider value={{ status }}>
      {children}
    </WebSocketContext.Provider>
  );
}
