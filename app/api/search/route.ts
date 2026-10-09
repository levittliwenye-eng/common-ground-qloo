import { createQlooClient, DEMO_MOVIES } from '@/lib/common-ground.mjs';
import { errorResponse, requireDemoAccess, validateOrigin } from '@/lib/http.mjs';
import { publicDemoEnabled, qlooKey } from '@/lib/runtime';

export async function GET(request: Request) {
  try {
    validateOrigin(request);
    const params = new URL(request.url).searchParams;
    const query = params.get('query') ?? '';
    const sample = params.get('mode') === 'sample';
    requireDemoAccess(request, publicDemoEnabled(), sample ? 0 : 1);
    const movies = sample ? DEMO_MOVIES.filter(movie => movie.name.toLowerCase().includes(query.toLowerCase())) : await createQlooClient(qlooKey()).search(query);
    return Response.json({ movies, mode: sample ? 'sample' : 'live' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
