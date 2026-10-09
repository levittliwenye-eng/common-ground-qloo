export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MOVIE = 'urn:entity:movie';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEMO_MOVIES = [
  { entity_id: 'demo-arrival', name: 'Arrival', subtype: MOVIE },
  { entity_id: 'demo-before-sunrise', name: 'Before Sunrise', subtype: MOVIE },
  { entity_id: 'demo-spirited-away', name: 'Spirited Away', subtype: MOVIE },
  { entity_id: 'demo-grand-budapest', name: 'The Grand Budapest Hotel', subtype: MOVIE },
  { entity_id: 'demo-truman', name: 'The Truman Show', subtype: MOVIE },
  { entity_id: 'demo-eternal', name: 'Eternal Sunshine of the Spotless Mind', subtype: MOVIE },
  { entity_id: 'demo-her', name: 'Her', subtype: MOVIE },
  { entity_id: 'demo-contact', name: 'Contact', subtype: MOVIE },
];

function movieEntity(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.entity_id !== 'string' || typeof raw.name !== 'string') return null;
  if (raw.subtype !== MOVIE && !(Array.isArray(raw.types) && raw.types.includes(MOVIE))) return null;
  const year = raw.properties?.release_year;
  return { entity_id: raw.entity_id, name: raw.name.slice(0, 200), subtype: MOVIE, ...(Number.isInteger(year) ? { year } : {}), ...(typeof raw.disambiguation === 'string' ? { disambiguation: raw.disambiguation.slice(0, 250) } : {}) };
}

// A key-backed check on 2026-10-09 confirmed results.entities for Insights
// and a results array for Search. Keep the alternate documented wrapper too.
export function readMovies(payload, search = false) {
  if (payload?.success === false) throw new AppError('upstream_error', 'Qloo could not complete this request.', 502);
  const raw = Array.isArray(payload?.results?.entities) ? payload.results.entities : search && Array.isArray(payload?.results) ? payload.results : null;
  if (!raw) throw new AppError('response_contract', 'Qloo returned an unfamiliar response. The integration needs a contract check.', 502);
  return raw.map(movieEntity).filter(Boolean);
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('upstream_error', 'Qloo returned an empty response.', 502);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new AppError('response_limit', 'Qloo returned more data than this tool can process.', 502);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(merged)); }
  catch { throw new AppError('upstream_error', 'Qloo returned an unreadable response.', 502); }
}

export function createQlooClient(key, fetcher = fetch) {
  async function get(path, params) {
    if (!key) throw new AppError('not_configured', 'Live Qloo access is not configured. You can use the sample walkthrough.', 503);
    const url = new URL(path, 'https://hackathon.api.qloo.com');
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response;
    try {
      // workerd rejects redirect: 'error' before sending the request.
      // Manual mode keeps the credential on this fixed origin only.
      response = await fetcher(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new AppError('connection_error', 'Qloo did not respond in time. Please try again later.', 504);
    }
    if (response.status >= 300 && response.status < 400) throw new AppError('redirect_refused', 'Qloo returned an unexpected redirect. The request was stopped.', 502);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AppError('authentication', 'Qloo access was rejected. The owner needs to check the server credential.', 502);
      if (response.status === 429) throw new AppError('rate_limit', 'Qloo is limiting requests. Please wait before trying again.', 429);
      throw new AppError('upstream_error', 'Qloo is temporarily unavailable.', 502);
    }
    return boundedJson(response);
  }
  return {
    async search(query) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) throw new AppError('needs_input', 'Enter a movie title between 2 and 100 characters.');
      return readMovies(await get('/search', { query: query.trim(), take: 10 }), true);
    },
    async insights(seeds, pool) {
      const params = { 'filter.type': MOVIE, 'signal.interests.entities': seeds.join(','), sort_by: 'affinity', take: pool ? Math.min(pool.length, 50) : 10 };
      if (pool) params['filter.results.entities'] = pool.join(',');
      return readMovies(await get('/v2/insights', params));
    },
  };
}

export function validatePeople(input, demo = false) {
  if (!Array.isArray(input) || input.length !== 2) throw new AppError('needs_input', 'Add movie preferences for exactly two people.');
  return input.map((ids) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || ids.some(id => typeof id !== 'string' || (demo ? !DEMO_MOVIES.some(m => m.entity_id === id) : !UUID.test(id)))) throw new AppError('needs_input', 'Choose one to three valid movie matches for each person.');
    return [...new Set(ids.map(id => demo ? id : id.toLowerCase()))];
  });
}

export function balanceRankings(pool, orderedByPerson) {
  const unique = [...new Map(pool.map(movie => [movie.entity_id.toLowerCase(), movie])).values()];
  const index = orderedByPerson.map(ids => new Map(ids.map((id, i) => [id.toLowerCase(), i])));
  const common = unique.filter(movie => index.every(ranks => ranks.has(movie.entity_id.toLowerCase())));
  // Re-rank only the shared evidence set; a missing item is never assigned zero.
  const commonIds = new Set(common.map(movie => movie.entity_id.toLowerCase()));
  const ranks = orderedByPerson.map(ids => {
    const seen = new Set();
    return new Map(ids.map(id => id.toLowerCase()).filter(id => commonIds.has(id) && !seen.has(id) && seen.add(id)).map((id, i) => [id, i + 1]));
  });
  const candidates = common.map(movie => {
    const perPersonRanks = ranks.map(rank => rank.get(movie.entity_id.toLowerCase()));
    return { movie, perPersonRanks, worstRank: Math.max(...perPersonRanks), meanRank: perPersonRanks.reduce((a, b) => a + b, 0) / perPersonRanks.length };
  });
  candidates.sort((a, b) => a.worstRank - b.worstRank || a.meanRank - b.meanRank || a.movie.entity_id.localeCompare(b.movie.entity_id));
  const excludedCount = unique.length - common.length;
  return { candidates: candidates.slice(0, 3), poolSize: common.length, excludedCount, status: common.length ? excludedCount ? 'partial' : 'ok' : 'empty', warnings: excludedCount ? [`${excludedCount} candidates were excluded because Qloo did not rank them for both people.`] : [] };
}

export async function findCommonGround(input, client) {
  const people = validatePeople(input);
  const seeds = new Set(people.flat().map(id => id.toLowerCase()));
  const initial = await Promise.all(people.map(ids => client.insights(ids)));
  const pool = [...new Map(initial.flat().filter(movie => !seeds.has(movie.entity_id.toLowerCase())).map(movie => [movie.entity_id.toLowerCase(), movie])).values()].slice(0, 20);
  if (!pool.length) return { status: 'empty', candidates: [], poolSize: 0, excludedCount: 0, warnings: ['No new movie candidates were returned. Try different preference movies.'] };
  const reranked = await Promise.all(people.map(ids => client.insights(ids, pool.map(movie => movie.entity_id))));
  return balanceRankings(pool, reranked.map(list => list.map(movie => movie.entity_id)));
}

export function sampleResult(input) {
  const people = validatePeople(input, true);
  const selected = new Set(people.flat());
  const pool = DEMO_MOVIES.filter(movie => !selected.has(movie.entity_id));
  const preferenceOrder = people.map(ids => {
    const sciFi = ids.includes('demo-arrival') || ids.includes('demo-contact');
    const order = sciFi ? ['demo-contact', 'demo-her', 'demo-truman', 'demo-eternal', 'demo-grand-budapest', 'demo-spirited-away', 'demo-before-sunrise', 'demo-arrival'] : ['demo-eternal', 'demo-her', 'demo-grand-budapest', 'demo-spirited-away', 'demo-before-sunrise', 'demo-truman', 'demo-arrival', 'demo-contact'];
    return order.filter(id => pool.some(movie => movie.entity_id === id));
  });
  return { ...balanceRankings(pool, preferenceOrder), mode: 'sample', warnings: ['Illustrative rankings written for this walkthrough. These are not Qloo results.'] };
}
