import { qlooKey } from '@/lib/runtime';

export function GET() {
  return Response.json({ liveConfigured: Boolean(qlooKey()) }, { headers: { 'Cache-Control': 'no-store' } });
}
