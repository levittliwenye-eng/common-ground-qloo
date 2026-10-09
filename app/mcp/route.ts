import { handleMcp } from '@/lib/mcp.mjs';
import { qlooKey } from '@/lib/runtime';

export function POST(request: Request) { return handleMcp(request, qlooKey()); }
export function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
export function DELETE() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
