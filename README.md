# Common Ground

A two-person movie decision tool with a browser walkthrough and a stateless HTTP MCP endpoint. AI agents developed this prototype under the participant’s direction to explore the Qloo Agentic Hackathon.

**The personal event key is configured as a server secret. Real search and the complete recommendation workflow passed both a direct client check and authenticated MCP calls on the private deployment on 2026-10-09. This is not a submitted entry.** See [INTEGRATION-STATUS.md](INTEGRATION-STATUS.md) for the verification snapshot and remaining entry requirements.

## Judge walkthrough

Open [the hosted demo](https://common-ground-oct2026.almondash.chatgpt.site/), select **Live Qloo**, search **Arrival** for Person 1 and choose the 2016 movie, then search **Before Sunrise** for Person 2 and choose the 1995 movie. Select **Find shared picks** to compare each person's relative rank. These are test inputs, not claimed participant preferences. Public access must be explicitly enabled before the entry is submitted.

For agent use, connect the hosted `/mcp` endpoint and sign in with ChatGPT. Resolve titles with `resolve_movie`, confirm ambiguous matches, then call `find_common_ground` with the chosen IDs and `mode: live`.

## Run the walkthrough

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by the server (normally http://127.0.0.1:5173). Sample mode starts with one preferred movie for each person. Remove or add titles, search the sample catalog, and select **Find shared picks**. The three result cards show each movie’s relative rank for each person.

The sample rankings are deliberately authored fixtures. They never claim to be Qloo results. Without a server key the Live Qloo control stays disabled.

For local live testing, place the issued event key in an ignored `.dev.vars` file as `QLOO_API_KEY`. Never add that file to Git. Hosted browser access defaults to signed-in visitors; an explicitly authorized public demo also requires `PUBLIC_DEMO=true` in its server environment. Shared live browser calls have a best-effort budget of 120 upstream request credits per ten minutes per Worker instance. Search costs one credit and recommendations reserve four. This is not a durable deployment-wide quota; Qloo also enforces its own limits. The key is never returned to a visitor. The demo records no IP addresses or user accounts. MCP tool calls still require sign-in.

## AI development disclosure

AI agents proposed most of the product design and produced the implementation, tests and entry draft under the account owner's authorization. The participant provided profile details, verified accounts and approved actions. No human ideation, coding or personal testing is claimed. Eligibility for this degree of AI involvement has not been confirmed by the organizer.

## Live integration design

The server uses `X-Api-Key` with the fixed https://hackathon.api.qloo.com origin required by the [official event developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide). Event keys do not work against the production or staging hosts. No credential reaches browser code, URLs or source files. Configure `QLOO_API_KEY` as a Sites runtime secret; never paste it into chat or commit it. The issued event key was received and configured on 2026-10-09. The guide states that keys remain active through judging and have rate and monthly quota limits; the email did not specify numeric limits. Requests remain bounded and upstream rate-limit responses are surfaced. Qloo response data must not be committed to a public repository.

1. Search titles through `/search`; select the exact entity, including a year when Qloo provides one. Ambiguous titles are not auto-selected.
2. Ask `/v2/insights` for up to 10 new movie candidates for each person.
3. Combine and deduplicate the lists, excluding both people’s preference films. The pool contains at most 20 movies.
4. Request affinity-sorted results for each person using the same `filter.results.entities` pool.
5. Keep movies returned for both people. Rank the common evidence set, minimize the worse individual rank, break ties by mean rank and then entity ID. Return up to three choices.

There are four Insights calls per recommendation, plus explicit title searches. Requests have a 12-second timeout and 1 MB response limit; no automatic retries. Errors do not include upstream response bodies or credentials. A failed participant request fails the operation; a missing candidate is excluded with a warning, never treated as zero preference.

Ranks are relative positions within this candidate pool, not enjoyment probabilities. The app does not verify streaming availability, prices or bookings. Real calls verified the Search `results` array and Insights `results.entities` array on 2026-10-09; unfamiliar responses fail clearly.

## Agentic tool interface

`POST /mcp` implements the MCP 2025-03-26 Streamable HTTP subset with JSON replies, initialization, discovery, tool calls, notifications and batches of at most four. GET/DELETE return 405; no SSE stream or session is required.

Tools:

- `resolve_movie`: `{ query, mode?: "live" | "sample" }` returns selectable movie entities.
- `find_common_ground`: `{ people: [[movieID], [movieID]], mode?: "live" | "sample" }` returns shared picks and individual ranks. Each participant may supply one to three resolved movie IDs.

The default is live mode. Agents must explicitly request sample mode, and sample outputs disclose their origin. Private hosted data calls require Sites authentication. Local loopback requests are allowed for development; discovery is free of personal data. The hosting boundary provides OAuth. Do not bypass it with spoofed identity headers on a public deployment.

Authenticated calls from the connected Codex client have verified both tools with sample and real Qloo data. This app does not spawn the official Qloo stdio CLI in a serverless Worker and does not claim that Qloo endorses this deployment route.

Local sample call:

```sh
curl http://127.0.0.1:5173/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_common_ground","arguments":{"people":[["demo-arrival"],["demo-before-sunrise"]],"mode":"sample"}}}'
```

## Verify

```sh
node --test tests/common-ground.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Tests cover compromise ranking, missing evidence, identical candidate pools, excluded seed films, bounded HTTP requests, credential-safe errors, invalid inputs and the MCP sample flow. They use fixtures/mocked HTTP responses, not paid APIs or a real Qloo key.

## Data and license

Preferences and results stay in browser memory and are cleared by reload. Live mode sends selected entity IDs and ranking requests to Qloo. There is no app database, analytics or account system. Sites provides access control for the current private preview.

Application code is MIT licensed. Bundled starter components and installed dependencies retain their own licenses; included vendor/build license notices are preserved. Movie titles in the sample are examples; the app includes no posters, clips or copied descriptions.
