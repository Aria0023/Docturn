import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { WebSocketProvider } from '@/components/WebSocketProvider';
import { App } from '@/App';
import '@/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
