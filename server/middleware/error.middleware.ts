import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: 'Not found' });
}

/** The single place where errors become HTTP responses. Express 5 routes rejected promises here. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  // Malformed JSON from express.json().
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'The request body is not valid JSON.' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'That already exists.' });
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: 'Not found.' });
  }
  console.error(err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
}
