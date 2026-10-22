import { NextResponse } from 'next/server';

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Validate the browser's public origin before the internal API rewrite. A
// forwarded frontend URL need not be added to the backend's CORS allowlist.
export function proxy(request) {
  const headers = new Headers(request.headers);
  const origin = headers.get('origin');
  if (stateChangingMethods.has(request.method) && origin) {
    const protocol = headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    const expectedOrigin = `${protocol}://${headers.get('host')}`;
    if (origin !== expectedOrigin || headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ detail: {
        code: 'INVALID_ORIGIN', message: 'This request origin is not allowed.',
      } }, { status: 403 });
    }
    // Server-only setting; this must be an explicit backend CORS_ORIGINS entry.
    headers.set('origin', process.env.API_PROXY_ORIGIN || 'http://localhost:3000');
  }
  // Missing Origin is deliberately preserved: the API still rejects cookie-
  // authenticated mutations without it. Never reflect these headers to clients.
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/api/:path*' };
