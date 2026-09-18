# Magisterial TypeScript SDK

The official TypeScript/JavaScript library for the [Magisterial](https://magisterial.ai)
developer API — college sports data across NCAA D1/D2/D3, NAIA, and NJCAA: players,
teams, rosters, schools, cross-program careers, games, the live transfer portal, an
agent-backed natural-language query endpoint, and (Enterprise) managed-athlete
authorizations for delegated coach-contact lookups.

- Interactive API reference: https://api.magisterial.ai/v1/docs
- OpenAPI spec: https://api.magisterial.ai/v1/openapi.json
- Agent-ready one-file reference: https://api.magisterial.ai/v1/llms.txt

Zero runtime dependencies; Node 18+ (or any runtime with global `fetch`). Fully typed —
all models are generated from the published OpenAPI spec.

## Installation

```bash
npm install magisterial
```

## Usage

Create an API key at [magisterial.ai/console/api-keys](https://magisterial.ai/console/api-keys)
and set `MAGISTERIAL_API_KEY` (or pass `apiKey` to the client).

```ts
import Magisterial from "magisterial";

const client = new Magisterial();

// Search players — `for await` follows the cursor across every page
const page = await client.players.search({
  sport: "soccer",
  division: "D1,NAIA,NJCAA-D1",
  gender: "women",
  position: "Forward",
  sort_by: "goals",
});
for await (const player of page) {
  console.log(player.name, player.team, player.stats?.goals);
}

// One player's full profile
const player = await client.players.get(184223, { sport: "soccer", division: "D3" });

// Live transfer portal (usage-billed; use `since` for incremental polling)
const portal = await client.portal.list({
  sport: "basketball",
  division: "D1",
  status: "INC",
});

// Natural-language query (usage-billed): submit and wait for the answer
const run = await client.query.createAndPoll({
  prompt: "Who led the NESCAC in assists this season?",
  sport: "soccer",
  division: "D3",
  gender: "men",
});
console.log(run.answer);

// Schools: look a school up by its federal IPEDS UNITID, then list its programs
const schools = await client.schools.list({ ipedsUnitid: 164465 });
const school = await client.schools.get(schools.data[0].id);

// Managed athletes (Enterprise): invite an athlete to authorize your account,
// then read coach contacts on their behalf
const grant = await client.athletes.create({ player_id: 184223 });
const staff = await client.teams.coaches(1873, {
  sport: "soccer",
  division: "D3",
  on_behalf_of: grant.player_id!,
});
```

### Errors

Non-2xx responses throw typed errors carrying the API's error envelope:

```ts
import Magisterial, { NotFoundError, RateLimitError } from "magisterial";

const client = new Magisterial();
try {
  await client.players.get(1, { sport: "soccer", division: "D1" });
} catch (err) {
  if (err instanceof NotFoundError) console.log(err.errorCode); // "player_not_found"
  if (err instanceof RateLimitError) console.log(err.retryAfter); // seconds
}
```

`BillingError` (402) means API billing is not enabled or the monthly budget is
exhausted — manage both in the [developer console](https://magisterial.ai/console).

### Retries

Idempotent requests (and `players.search`) are retried automatically on 429s, 5xx
and connection failures — up to `maxRetries` (default 2), honoring the server's
`Retry-After`. Billable creates (`query.create`, `alerts.create`) are never
retried automatically.

## Types

All request/response types live in the `types` export and are generated from the
published OpenAPI spec (`npm run sync-types`), so they cannot drift from the live
API contract:

```ts
import { types } from "magisterial";

const entry: types.PortalEntry = ...;
```

## License

MIT
