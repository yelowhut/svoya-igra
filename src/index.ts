import { Server } from 'socket.io';
import { config } from './config.js';
import { openDb } from './persistence/db.js';
import { EventStore } from './persistence/eventStore.js';
import { SessionRegistry } from './realtime/session.js';
import { buildServer } from './http/server.js';
import { attachGateway } from './realtime/gateway.js';

const db = openDb(config.dbPath);
const store = new EventStore(db, config.snapshotEvery);
const sessions = new SessionRegistry();
const app = buildServer({ store, db, config });

await app.ready();
const io = new Server(app.server, { cors: { origin: true } });
attachGateway(io, { store, db, sessions, config });

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Сервер на http://0.0.0.0:${config.port}`);
