import { createQlooClient, findCommonGround, sampleResult } from '@/lib/common-ground.mjs';
import { errorResponse, readBody, requireDemoAccess, validateOrigin } from '@/lib/http.mjs';
import { publicDemoEnabled, qlooKey } from '@/lib/runtime';

export async function POST(request: Request) {
  try {
    validateOrigin(request);
    const body = await readBody(request);
    requireDemoAccess(request, publicDemoEnabled(), body.mode === 'sample' ? 0 : 4);
    const result = body.mode === 'sample' ? sampleResult(body.people) : { ...await findCommonGround(body.people, createQlooClient(qlooKey())), mode: 'live' };
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
