import { AppError, createQlooClient, DEMO_MOVIES, findCommonGround, sampleResult } from './common-ground.mjs';
import { readBody, requireOwner, validateOrigin, errorResponse } from './http.mjs';

const tools = [
  { name: 'resolve_movie', description: 'Find selectable movie entities by title. Ask the user to choose when a title has multiple matches. Sample mode contains illustrative data only.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 100 }, mode: { type: 'string', enum: ['live', 'sample'], default: 'live' } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'find_common_ground', description: 'Find up to three new movie choices for two people using their selected movie entity IDs. Maximizes the worse of the two ranks in the common Qloo candidate pool. Ranks are relative positions, not likelihoods. Sample mode is illustrative only.', inputSchema: { type: 'object', properties: { people: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } } }, mode: { type: 'string', enum: ['live', 'sample'], default: 'live' } }, required: ['people'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
];

export async function handleMcp(request, key, fetcher = fetch) {
  try {
    validateOrigin(request);
    const accept = request.headers.get('accept') ?? '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new AppError('accept', 'Accept application/json and text/event-stream.', 406);
    const body = await readBody(request);
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length < 1 || messages.length > 4) throw new AppError('batch_limit', 'Use one to four messages per request.');
    const results = [];
    for (const message of messages) {
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (message.id !== undefined && message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number')) {
        results.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } });
        continue;
      }
      if (message.id === undefined) continue;
      let result;
      if (message.method === 'initialize') {
        result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'common-ground', version: '0.1.0' }, instructions: 'Resolve movie titles first and confirm ambiguous matches. Live mode requires owner authentication and a configured Qloo key. Sample results are illustrative, not Qloo recommendations.' };
      } else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools };
      else if (message.method === 'tools/call') {
        try {
          requireOwner(request);
          const args = message.params?.arguments ?? {};
          if (args.mode !== undefined && args.mode !== 'live' && args.mode !== 'sample') throw new AppError('needs_input', 'Choose live or sample mode.');
          const sample = args.mode === 'sample';
          const client = createQlooClient(key, fetcher);
          let value;
          if (message.params?.name === 'resolve_movie') {
            if (typeof args.query !== 'string' || args.query.trim().length < 2 || args.query.length > 100) throw new AppError('needs_input', 'Enter a movie title between 2 and 100 characters.');
            value = { mode: sample ? 'sample' : 'live', movies: sample ? DEMO_MOVIES.filter(movie => movie.name.toLowerCase().includes(args.query.toLowerCase())) : await client.search(args.query) };
          } else if (message.params?.name === 'find_common_ground') {
            value = sample ? sampleResult(args.people) : { ...await findCommonGround(args.people, client), mode: 'live' };
          } else throw new AppError('unknown_tool', 'Unknown tool name.');
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
        } catch (error) {
          result = { content: [{ type: 'text', text: error instanceof AppError ? error.message : 'The tool could not complete this request.' }], isError: true };
        }
      } else {
        results.push({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found.' } });
        continue;
      }
      results.push({ jsonrpc: '2.0', id: message.id, result });
    }
    if (!results.length) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? results : results[0], { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
