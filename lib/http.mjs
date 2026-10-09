import { AppError } from './common-ground.mjs';

export function validateOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new AppError('origin', 'This request came from an unsupported origin.', 403);
}

export function requireOwner(request) {
  const hostname = new URL(request.url).hostname;
  if (!request.headers.get('oai-authenticated-user-id') && hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') throw new AppError('access', 'Please sign in to use this private demo.', 401);
}

// The public demo has no saved user data or write actions. Limit upstream
// calls per Worker instance; Qloo's own limits remain the final quota boundary.
export function createDemoAccessGuard({ maxCredits = 120, windowMs = 600_000, now = Date.now } = {}) {
  let windowStart;
  let credits = 0;
  return function requireDemoAccess(request, publicEnabled = false, cost = 0) {
    if (!publicEnabled) { requireOwner(request); return; }
    const time = now();
    if (windowStart === undefined || time - windowStart >= windowMs) { windowStart = time; credits = 0; }
    if (credits + cost > maxCredits) throw new AppError('demo_limit', 'The shared live demo is busy. Please try again in a few minutes.', 429);
    credits += cost;
  };
}

export const requireDemoAccess = createDemoAccessGuard();

export async function readBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('content_type', 'Send a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('body', 'The request body is missing.');
  let size = 0;
  const parts = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) { await reader.cancel(); throw new AppError('body_limit', 'The request is too large.', 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AppError('body', 'The request is not valid JSON.'); }
}

export function errorResponse(error) {
  const known = error instanceof AppError;
  return Response.json({ code: known ? error.code : 'internal_error', message: known ? error.message : 'The request could not be completed.' }, { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
