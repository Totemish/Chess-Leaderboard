import { BadRequestError } from './errors';

export const TIME_CONTROLS = ['rapid', 'blitz', 'bullet'] as const;
export type TimeControl = (typeof TIME_CONTROLS)[number];

export const GAME_RESULTS = ['white', 'black', 'draw'] as const;
export type GameResult = (typeof GAME_RESULTS)[number];

// Chess.com usernames: 3 to 25 letters, digits, underscores or hyphens.
const CHESS_USERNAME = /^[A-Za-z0-9_-]{3,25}$/;

/** A single route parameter as a non-empty string (Express 5 types allow arrays for repeated params). */
export function routeParam(params: Record<string, string | string[] | undefined>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string' || value === '') throw new BadRequestError(`Missing ${name}.`);
  return value;
}

export function parseTimeControl(value: unknown): TimeControl {
  if (typeof value === 'string' && (TIME_CONTROLS as readonly string[]).includes(value)) return value as TimeControl;
  throw new BadRequestError(`Time control must be one of: ${TIME_CONTROLS.join(', ')}.`);
}

export function parseChessUsername(value: unknown): string {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!CHESS_USERNAME.test(username)) {
    throw new BadRequestError('Enter a valid Chess.com username (3–25 letters, numbers, _ or -).');
  }
  return username;
}

export function parseTournamentName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 3 || name.length > 80) throw new BadRequestError('Tournament names must be 3–80 characters.');
  return name;
}

export function parseGameResult(value: unknown): GameResult {
  if (typeof value === 'string' && (GAME_RESULTS as readonly string[]).includes(value)) return value as GameResult;
  throw new BadRequestError('Result must be "white", "black" or "draw".');
}
