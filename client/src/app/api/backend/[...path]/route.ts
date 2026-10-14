import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import jwt from 'jsonwebtoken';

// Server-to-server calls can use a private address (e.g. http://api:5000 inside
// Docker) instead of going out to the public API URL and back.
const backendUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const authSecret = process.env.AUTH_SECRET;

/**
 * Forwards /api/backend/* to the Express API. Signed-in requests carry a
 * short-lived JWT the API verifies with the shared AUTH_SECRET. Anonymous
 * requests pass through without one: the API decides which routes need auth,
 * so public pages such as tournaments keep working for signed-out visitors.
 */
async function handleProxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.some((segment) => segment === '.' || segment === '..')) {
    return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
  }

  const headers = new Headers();
  const session = await auth();

  if (session?.user?.id) {
    if (!authSecret) {
      console.error('AUTH_SECRET is missing');
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    const token = jwt.sign(
      {
        sub: session.user.id,
        email: session.user.email,
        email_verified: session.emailVerified === true,
        name: session.user.name,
        picture: session.user.image,
      },
      authSecret,
      { algorithm: 'HS256', expiresIn: '1m' }
    );
    headers.set('Authorization', `Bearer ${token}`);
  }

  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const init: RequestInit = { method: req.method, headers, cache: 'no-store' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    if (body) init.body = body;
  }

  const url = `${backendUrl}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  try {
    const response = await fetch(url, init);
    const noBody = response.status === 204 || response.status === 304;
    return new NextResponse(noBody ? null : await response.text(), {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ success: false, error: 'The API server is unreachable' }, { status: 502 });
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;
