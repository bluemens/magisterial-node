// SDK behavior tests against an injected fetch stub — no network.
// Covers auth headers, error mapping from the {"error": {...}} envelope,
// Retry-After-honoring retries, cursor auto-pagination, and createAndPoll.

import { describe, expect, it, vi } from "vitest";

import Magisterial, {
  AuthenticationError,
  BillingError,
  InternalServerError,
  MagisterialError,
  NotFoundError,
  QueryPollTimeout,
  RateLimitError,
  VERSION,
} from "../src/index.js";

const API_KEY = "mag_test_abc123";

type Handler = (url: string, init: RequestInit) => Response;

function makeClient(handler: Handler, options: Record<string, unknown> = {}) {
  const fetchStub = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  );
  const client = new Magisterial({
    apiKey: API_KEY,
    fetch: fetchStub as unknown as typeof fetch,
    ...options,
  });
  // Never actually sleep in tests.
  const sleeps: number[] = [];
  vi.spyOn(client, "_sleep").mockImplementation(async (ms: number) => {
    sleeps.push(ms);
  });
  return { client, fetchStub, sleeps };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const errorBody = (type: string, code: string, message: string) => ({
  error: { type, code, message },
});

describe("construction", () => {
  it("requires an api key", () => {
    const saved = process.env.MAGISTERIAL_API_KEY;
    delete process.env.MAGISTERIAL_API_KEY;
    try {
      expect(() => new Magisterial()).toThrow(MagisterialError);
      expect(() => new Magisterial()).toThrow(/MAGISTERIAL_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.MAGISTERIAL_API_KEY = saved;
    }
  });

  it("strips trailing slash from baseURL", () => {
    const { client } = makeClient(() => json(200, {}), {
      baseURL: "https://staging.example.com/",
    });
    expect(client.baseURL).toBe("https://staging.example.com");
  });
});

describe("headers", () => {
  it("sends bearer auth and user-agent", async () => {
    let seen: Record<string, string> = {};
    const { client } = makeClient((_url, init) => {
      seen = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>),
      );
      return json(200, { data: [] });
    });
    await client.reference.divisions();
    expect(seen["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(seen["User-Agent"]).toBe(`magisterial-node/${VERSION}`);
  });
});

describe("error mapping", () => {
  it("maps 401 to AuthenticationError with envelope fields", async () => {
    const { client } = makeClient(() =>
      json(401, errorBody("unauthorized", "invalid_api_key", "Invalid or revoked API key.")),
    );
    const error = await client.reference.sports().catch((e) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.errorCode).toBe("invalid_api_key");
    expect(error.message).toMatch(/revoked/);
  });

  it("maps 402 to BillingError", async () => {
    const { client } = makeClient(() =>
      json(402, errorBody("billing", "budget_exceeded", "Monthly budget exhausted.")),
    );
    await expect(
      client.portal.list({ sport: "soccer", division: "D1" }),
    ).rejects.toBeInstanceOf(BillingError);
  });

  it("maps 404 to NotFoundError", async () => {
    const { client } = makeClient(() =>
      json(404, errorBody("not_found", "player_not_found", "No player with that id in scope.")),
    );
    await expect(
      client.players.get(999, { sport: "soccer", division: "D1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("retries", () => {
  it("retries 429 honoring Retry-After", async () => {
    let calls = 0;
    const { client, sleeps } = makeClient(() => {
      calls++;
      if (calls === 1) {
        return json(429, errorBody("rate_limited", "rate_limit_exceeded", "Slow down."), {
          "Retry-After": "3",
        });
      }
      return json(200, { data: ["D1"] });
    });
    const result = await client.reference.divisions();
    expect(result.data).toEqual(["D1"]);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([3000]);
  });

  it("does not auto-retry billable creates", async () => {
    let calls = 0;
    const { client } = makeClient(() => {
      calls++;
      return json(429, errorBody("rate_limited", "rate_limit_exceeded", "Slow down."));
    });
    const error = await client.query
      .create({ prompt: "who leads in goals?", sport: "soccer" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(calls).toBe(1);
  });

  it("exhausts retries then throws", async () => {
    let calls = 0;
    const { client } = makeClient(
      () => {
        calls++;
        return json(500, errorBody("internal", "boom", "x"));
      },
      { maxRetries: 2 },
    );
    await expect(client.reference.sports()).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toBe(3); // initial + 2 retries
  });
});

describe("pagination", () => {
  const player = (i: number) => ({ id: i, name: `Player ${i}`, stats: {} });

  it("auto-paginates search results, preserving filters", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const { client } = makeClient((_url, init) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (!body.cursor) {
        return json(200, { data: [player(1), player(2)], next_cursor: "c2", has_more: true });
      }
      expect(body.cursor).toBe("c2");
      return json(200, { data: [player(3)], next_cursor: null, has_more: false });
    });

    const mixedScope = "D1,NAIA,NJCAA-D1";
    const page = await client.players.search({ sport: "soccer", division: mixedScope, limit: 2 });
    const names: string[] = [];
    for await (const p of page) names.push(p.name!);
    expect(names).toEqual(["Player 1", "Player 2", "Player 3"]);
    expect(bodies[1].sport).toBe("soccer");
    expect(bodies[1].limit).toBe(2);
    expect(bodies[1].division).toBe(mixedScope);
  });

  it("exposes the current page without following", async () => {
    const { client } = makeClient(() =>
      json(200, { data: [player(1)], next_cursor: "c2", has_more: true }),
    );
    const page = await client.teams.list({ sport: "soccer", division: "D1" });
    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("c2");
  });

  it("preserves a roster season while paginating", async () => {
    const queries: Array<Record<string, string>> = [];
    const { client } = makeClient((url) => {
      const parsed = new URL(url);
      const query = Object.fromEntries(parsed.searchParams.entries());
      queries.push(query);
      expect(parsed.pathname).toBe("/v1/teams/1873/roster");
      if (!query.cursor) {
        return json(200, {
          season: "2026",
          data: [{ id: 1, name: "Player 1" }],
          next_cursor: "c2",
          has_more: true,
        });
      }
      return json(200, {
        season: "2026",
        data: [{ id: 2, name: "Player 2" }],
        next_cursor: null,
        has_more: false,
      });
    });

    const page = await client.teams.roster(1873, {
      sport: "soccer",
      division: "D3",
      season: "2026",
      limit: 1,
    });
    expect(page.season).toBe("2026");

    const nextPage = await page.getNextPage();
    expect(nextPage?.season).toBe("2026");
    expect(nextPage?.data[0].name).toBe("Player 2");
    expect(queries).toEqual([
      { sport: "soccer", division: "D3", season: "2026", limit: "1" },
      {
        sport: "soccer",
        division: "D3",
        season: "2026",
        limit: "1",
        cursor: "c2",
      },
    ]);
  });
});

describe("0.2.0 endpoints", () => {
  it("lists games with filters and typed fixtures", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/games?");
      expect(url).toContain("status=final");
      return json(200, {
        data: [{ id: 9001, home_team_name: "Amherst", away_team_name: "Tufts", status: "final" }],
        next_cursor: null,
        has_more: false,
      });
    });
    const page = await client.games.list({ sport: "soccer", division: "D3", status: "final" });
    expect(page.data[0].home_team_name).toBe("Amherst");
  });

  it("fetches team coaches", async () => {
    const { client } = makeClient(() =>
      json(200, { season: "2025-26", data: [{ name: "Sam Blake", role: "Head Coach" }] }),
    );
    const staff = await client.teams.coaches(1873, { sport: "soccer", division: "D3" });
    expect(staff.season).toBe("2025-26");
    expect(staff.data![0].name).toBe("Sam Blake");
  });

  it("lists published movements with filters", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/movements?");
      expect(url).toContain("kind=coach");
      expect(url).toContain("sport_path=womens-soccer");
      return json(200, {
        data: [
          {
            id: 59,
            kind: "coach",
            event_type: "title_changed",
            sport_path: "womens-soccer",
            school_name: "Macalester College",
            subject: { name: "Marissa Olson-Guillou", to_title: "Head Coach", is_head: true },
            resolution_kind: "head_coach_change_confirmed",
          },
        ],
        next_cursor: null,
        has_more: false,
      });
    });
    const page = await client.movements.list({ kind: "coach", sportPath: "womens-soccer" });
    expect(page.data[0].subject.name).toBe("Marissa Olson-Guillou");
    expect(page.data[0].resolution_kind).toBe("head_coach_change_confirmed");
    expect(page.hasMore).toBe(false);
  });

  it("export createAndPoll reaches succeeded", async () => {
    const statuses = ["queued", "running", "succeeded"][Symbol.iterator]();
    const { client } = makeClient((_url, init) =>
      init.method === "POST"
        ? json(202, { export_id: "e1", status: "queued" })
        : json(200, {
            export_id: "e1",
            status: statuses.next().value,
            dataset: "players",
            download_url: "https://example.com/f.csv.gz",
          }),
    );
    const job = await client.exports.createAndPoll({
      dataset: "players",
      sport: "soccer",
      division: "D3",
    });
    expect(job.status).toBe("succeeded");
    expect(job.download_url).toBeTruthy();
  });

  it("export create is not auto-retried", async () => {
    let calls = 0;
    const { client } = makeClient(() => {
      calls++;
      return json(429, errorBody("rate_limited", "rate_limit_exceeded", "Slow down."));
    });
    await expect(
      client.exports.create({ dataset: "players", sport: "soccer", division: "D3" }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toBe(1);
  });
});

describe("0.4.0 endpoints", () => {
  it("lists schools with filters, mapping ipedsUnitid to ipeds_unitid", async () => {
    const { client } = makeClient((url, init) => {
      expect(init.method).toBe("GET");
      expect(url).toContain("/v1/schools?");
      expect(url).toContain("q=Amherst");
      expect(url).toContain("state=MA");
      expect(url).toContain("ipeds_unitid=164465");
      return json(200, {
        data: [{ id: 812, name: "Amherst College", state: "MA", ipeds_unitid: 164465 }],
        next_cursor: null,
        has_more: false,
      });
    });
    const page = await client.schools.list({ q: "Amherst", state: "MA", ipedsUnitid: 164465 });
    expect(page.data[0].name).toBe("Amherst College");
  });

  it("gets one school with its programs", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/schools/812");
      return json(200, {
        id: 812,
        name: "Amherst College",
        teams: [{ id: 1873, name: "Amherst", sport_path: "mens-soccer" }],
      });
    });
    const school = await client.schools.get(812);
    expect(school.teams?.[0].sport_path).toBe("mens-soccer");
  });

  it("creates a managed athlete invitation and is not auto-retried", async () => {
    let calls = 0;
    let seenBody: Record<string, unknown> = {};
    const { client } = makeClient((url, init) => {
      calls++;
      expect(init.method).toBe("POST");
      expect(url).toContain("/v1/athletes");
      seenBody = JSON.parse(String(init.body));
      return json(429, errorBody("rate_limited", "rate_limit_exceeded", "Slow down."));
    });
    const error = await client.athletes
      .create({ player_id: 13232, sport_path: "mens-soccer", organization_name: "Northstar" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(calls).toBe(1);
    expect(seenBody).toEqual({
      player_id: 13232,
      sport_path: "mens-soccer",
      organization_name: "Northstar",
    });
  });

  it("creates a managed athlete invitation successfully", async () => {
    const { client } = makeClient(() =>
      json(201, { id: "grant_1", status: "invited", player_id: 13232 }),
    );
    const entry = await client.athletes.create({ player_id: 13232 });
    expect(entry.id).toBe("grant_1");
    expect(entry.status).toBe("invited");
  });

  it("lists managed athletes filtered by status", async () => {
    const { client } = makeClient((url, init) => {
      expect(init.method).toBe("GET");
      expect(url).toContain("/v1/athletes?");
      expect(url).toContain("status=active");
      return json(200, {
        data: [{ id: "grant_1", status: "active" }],
        next_cursor: null,
        has_more: false,
      });
    });
    const page = await client.athletes.list({ status: "active" });
    expect(page.data[0].status).toBe("active");
  });

  it("gets one managed athlete by grant id", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/athletes/grant_1");
      return json(200, { id: "grant_1", status: "active" });
    });
    const entry = await client.athletes.get("grant_1");
    expect(entry.status).toBe("active");
  });

  it("resends a managed athlete invite and is not auto-retried", async () => {
    let calls = 0;
    const { client } = makeClient((url, init) => {
      calls++;
      expect(init.method).toBe("POST");
      expect(url).toContain("/v1/athletes/grant_1/resend");
      return json(429, errorBody("rate_limited", "rate_limit_exceeded", "Slow down."));
    });
    const error = await client.athletes.resendInvite("grant_1").catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(calls).toBe(1);
  });

  it("revokes a managed athlete authorization", async () => {
    const { client } = makeClient((url, init) => {
      expect(init.method).toBe("DELETE");
      expect(url).toContain("/v1/athletes/grant_1");
      return json(200, { id: "grant_1", status: "revoked" });
    });
    const result = await client.athletes.revoke("grant_1");
    expect(result.status).toBe("revoked");
  });

  it("lists a managed athlete's delegated-access audit log", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/athletes/grant_1/access?");
      expect(url).toContain("limit=10");
      return json(200, {
        data: [{ id: 1, grant_id: "grant_1", capability: "team_coaches" }],
        next_cursor: null,
        has_more: false,
      });
    });
    const page = await client.athletes.listAccess("grant_1", { limit: 10 });
    expect(page.data[0].capability).toBe("team_coaches");
  });

  it("fetches team coaches on behalf of a managed athlete", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/teams/1873/coaches?");
      expect(url).toContain("on_behalf_of=13232");
      return json(200, { season: "2025-26", data: [{ name: "Sam Blake", role: "Head Coach" }] });
    });
    const staff = await client.teams.coaches(1873, {
      sport: "soccer",
      division: "D3",
      on_behalf_of: 13232,
    });
    expect(staff.data![0].name).toBe("Sam Blake");
  });

  it("lists teams filtered by IPEDS UNITID", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/teams?");
      expect(url).toContain("ipeds_unitid=164465");
      return json(200, { data: [], next_cursor: null, has_more: false });
    });
    await client.teams.list({ sport: "soccer", division: "D3", ipeds_unitid: 164465 });
  });

  it("lists movements filtered by feed tier", async () => {
    const { client } = makeClient((url) => {
      expect(url).toContain("/v1/movements?");
      expect(url).toContain("status=resolved");
      return json(200, { data: [], next_cursor: null, has_more: false });
    });
    await client.movements.list({ status: "resolved" });
  });
});

describe("query polling", () => {
  it("createAndPoll reaches done", async () => {
    const statuses = ["queued", "running", "done"][Symbol.iterator]();
    const { client } = makeClient((url, init) => {
      if (init.method === "POST") {
        return json(202, { run_id: "r1", status: "queued" });
      }
      expect(url).toContain("/v1/query/r1");
      return json(200, { run_id: "r1", status: statuses.next().value, answer: "42" });
    });
    const run = await client.query.createAndPoll({ prompt: "answer?", sport: "soccer" });
    expect(run.status).toBe("done");
    expect(run.answer).toBe("42");
  });

  it("createAndPoll times out with the run id", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 100_000));
    try {
      const { client } = makeClient((_url, init) =>
        init.method === "POST"
          ? json(202, { run_id: "r1", status: "queued" })
          : json(200, { run_id: "r1", status: "running" }),
      );
      const error = await client.query
        .createAndPoll({ prompt: "slow", sport: "soccer" }, { timeoutMs: 150_000 })
        .catch((e) => e);
      expect(error).toBeInstanceOf(QueryPollTimeout);
      expect(error.runId).toBe("r1");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
