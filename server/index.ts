import { config } from './config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { prisma } from './services/db.service';
import { redis } from './services/redis.service';
import { ChessComClient } from './services/chess.service';
import { startSyncJob } from './services/cron.service';
import { TournamentService } from './services/tournament.service';
import { MemberService } from './services/member.service';
import { SwissPairing } from './domain/pairing/swiss';
import { createAuthRouter } from './routes/auth.routes';
import { createPlayerRouter } from './routes/player.routes';
import { createTournamentRouter } from './routes/tournament.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

// Composition root: build every dependency once and hand it to the routers.
const chess = new ChessComClient(config.chessComUserAgent);
const members = new MemberService(prisma, config.instituteEmailDomain);
const tournaments = new TournamentService(prisma, new SwissPairing());

const app = express();
app.disable('x-powered-by');
// Only the web app's origin may call the API from a browser.
app.use(cors({ origin: config.clientOrigins }));
app.use(express.json({ limit: '32kb' }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: config.clientOrigins, methods: ['GET', 'POST'] } });

app.get('/', (_req, res) => {
  res.json({ success: true, data: { name: 'IITR Chess Leaderboard API' } });
});

// For uptime checks and the host's health probe: fails if the database is unreachable.
app.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ success: true, data: { status: 'ok', uptime: Math.round(process.uptime()) } });
});

app.use(
  '/api/auth',
  createAuthRouter({
    db: prisma,
    members,
    chess,
    io,
    authSecret: config.authSecret,
  })
);
app.use('/api/tournaments', createTournamentRouter({ members, tournaments }));
app.use('/api', createPlayerRouter({ db: prisma }));
app.use(notFoundHandler);
app.use(errorHandler);

const syncTask = startSyncJob(io, chess, config.syncSchedule);

httpServer.listen(config.port, () => {
  console.log(`Server is running on port ${config.port} (allowing ${config.clientOrigins.join(', ')})`);
});

// Hosts send SIGTERM before replacing an instance: stop taking work, then close connections.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  setTimeout(() => process.exit(1), 10_000).unref();

  await syncTask.stop();
  await new Promise<void>((resolve) => io.close(() => resolve())); // also closes the HTTP server
  await prisma.$disconnect();
  await redis?.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
