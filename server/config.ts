import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

const contact = process.env.CHESS_COM_CONTACT;

/** Read once at startup, so a missing secret fails immediately rather than on the first request. */
export const config = {
  port: Number(process.env.PORT ?? 5000),
  authSecret: required('AUTH_SECRET'),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL || null,
  /** Browser origins allowed to call the API and open sockets (comma-separated). */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  instituteEmailDomain: (process.env.INSTITUTE_EMAIL_DOMAIN ?? '@iitr.ac.in').toLowerCase(),
  /** Chess.com asks API clients for a recognisable User-Agent with contact details. */
  chessComUserAgent: `IITR-Chess-Leaderboard/1.0 (+https://github.com/Totemish/IITR-Chess-Leaderboard${contact ? `; ${contact}` : ''})`,
  syncSchedule: process.env.SYNC_CRON ?? '*/10 * * * *',
};
