import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { MemberService } from '../services/member.service';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

/** The signed-in user, from the short-lived JWT the Next.js proxy attaches. */
export interface AuthUser {
  /** The sign-in's stable id, "provider:providerAccountId" (an Identity's authId, not a member id). */
  id: string;
  email?: string;
  name?: string;
  image?: string;
  /** Whether the sign-in provider vouched for the email address. */
  emailVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function decode(token: string): AuthUser {
  // Pin the algorithm so a token can't choose a weaker one.
  const claims = jwt.verify(token, config.authSecret, { algorithms: ['HS256'] });
  if (typeof claims === 'string' || typeof claims.sub !== 'string' || claims.sub === '') {
    throw new UnauthorizedError('Invalid session token.');
  }
  const user: AuthUser = { id: claims.sub, emailVerified: claims.email_verified === true };
  if (typeof claims.email === 'string') user.email = claims.email.toLowerCase();
  if (typeof claims.name === 'string') user.name = claims.name;
  if (typeof claims.picture === 'string') user.image = claims.picture;
  return user;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) throw new UnauthorizedError();
  try {
    req.user = decode(token);
  } catch {
    throw new UnauthorizedError('Your session has expired. Sign in again.');
  }
  next();
}

/** Sets req.user when a valid token is present, but never blocks the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = decode(token);
    } catch {
      // An invalid token on a public route is treated as signed out.
    }
  }
  next();
}

/** Use after authMiddleware. Admin status lives in the database, on the member, not the token. */
export function requireAdmin(members: MemberService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    const member = await members.find(req.user.id);
    if (member?.role !== 'ADMIN') throw new ForbiddenError('Only club admins can do this.');
    next();
  };
}
