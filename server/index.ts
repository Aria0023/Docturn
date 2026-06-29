import { createServer } from 'http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { expiry } from './services/expiry.js';

const PORT = Number(process.env.PORT || 3001);

const app = createApp();
const server = createServer(app);

attachWebSocket(server);
expiry.start();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[docturn] server listening on http://localhost:${PORT}`);
  console.log(`[docturn] health: http://localhost:${PORT}/api/health`);
});

export { server, app };
