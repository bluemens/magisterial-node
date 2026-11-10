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

  it("types a search row's stats by the sport searched", async () => {
    const row = {
      id: 184223, name: "Jordan Rivera", team_id: 1873, person_id: 90211,
      sport: "soccer", gender: "men", home_state: "OR", season: "2026",
      // every stat field of the sport, null when unpublished; the keys the
      // API returned before 2026-10-09 ride along until 2027-01-12
      stats: { gp: 18, g: 7, sh_pct: 0.171, yc: 3, rc: 0, pk_made: 1, pk_att: 2, sv: null,
               "sh%": 0.171, "yc-rc": "3-0", team_id: 1873 },
    };
    const { client } = makeClient((_url, init) => {
      expect(JSON.parse(String(init.body)).sort_by).toBe("g");
      return json(200, { data: [row], next_cursor: null, has_more: false });
    });

    const page = await client.players.search({ sport: "soccer", division: "D3", sort_by: "g" });
    const top = page.data[0];
    // number | null | undefined: no cast, because `sport` was a literal
    const goals: number | null | undefined = top.stats?.g;
    const yellows: number | null | undefined = top.stats?.yc;
    expect([goals, yellows, top.stats?.sv, top.team_id, top.home_state]).toEqual([7, 3, null, 1873, "OR"]);

    // A sport only known at run time keeps the open record.
    const sport: string = "soccer";
    const loose = await client.players.search({ sport, division: "D3", sort_by: "g" });
    const value: unknown = loose.data[0].stats?.g;
    expect(value).toBe(7);
  });

  it("lists a player's seasons newest first with the same stat object", async () => {
    const { client } = makeClient(() =>
      json(200, {
        id: 184223, sport: "soccer",
        stats_by_season: [
          { season: "2026", team_id: 1873, stats: { gp: 18, g: 7 } },
          { season: "2025", team_id: 1873, stats: { gp: 16, g: 3 } },
        ],
        stats_totals: { gp: 34, g: 10 },
        track_bests: [],
      }),
    );
    const detail = await client.players.get(184223, { sport: "soccer", division: "D3" });
    expect(detail.stats_by_season?.map((s) => s.season)).toEqual(["2026", "2025"]);
    const first: number | null | undefined = detail.stats_by_season?.[0].stats?.g;
    expect([first, detail.stats_totals?.g]).toEqual([7, 10]);
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

describe("0.7.0 endpoints", () => {
  const emptyPage = { data: [], next_cursor: null, has_more: false };

  /** A client whose every response is `body`; records the last request. */
  function recording(body: unknown, status = 200) {
    const seen: { method: string; url: URL } = { method: "", url: new URL("http://x") };
    const { client, fetchStub } = makeClient((url, init) => {
      seen.method = init.method ?? "";
      seen.url = new URL(url);
      return json(status, body);
    });
    return { client, seen, fetchStub };
  }

  it("lists commitments with filters and paginates", async () => {
    const calls: URL[] = [];
    const { client } = makeClient((url, init) => {
      expect(init.method).toBe("GET");
      const u = new URL(url);
      calls.push(u);
      return json(200, {
        data: [{ id: calls.length, status: "committed" }],
        next_cursor: calls.length === 1 ? "c2" : null,
        has_more: calls.length === 1,
      });
    });
    const page = await client.commitments.list({
      sport_path: "womens-volleyball",
      division: "D2,D3",
      grad_year: "2027",
      status: "committed",
      ipeds_unitid: 164465,
      conference_not: "SEC",
      committed_since: "2026-09-01",
      sort: "committed_on",
      limit: 1,
    });
    expect(calls[0].pathname).toBe("/v1/commitments");
    const q = Object.fromEntries(calls[0].searchParams);
    expect(q).toEqual({
      sport_path: "womens-volleyball",
      division: "D2,D3",
      grad_year: "2027",
      status: "committed",
      ipeds_unitid: "164465",
      conference_not: "SEC",
      committed_since: "2026-09-01",
      sort: "committed_on",
      limit: "1",
    });
    const ids: number[] = [];
    for await (const c of page) ids.push(c.id!);
    expect(ids).toEqual([1, 2]);
    expect(calls[1].searchParams.get("cursor")).toBe("c2");
    expect(calls[1].searchParams.get("grad_year")).toBe("2027");
  });

  it("gets one commitment", async () => {
    const { client, seen } = recording({ id: 77, status: "signed" });
    const c = await client.commitments.get(77);
    expect(seen.method).toBe("GET");
    expect(seen.url.pathname).toBe("/v1/commitments/77");
    expect(c.status).toBe("signed");
  });

  it("lists commitment changes and sources", async () => {
    const { client, seen } = recording({
      data: [{ id: 5, change_type: "decommitted" }],
      next_cursor: null,
      has_more: false,
    });
    const page = await client.commitments.changes({
      since: "2026-10-01T00:00:00Z",
      sport: "soccer",
      gender: "women",
      grad_year: "2027",
    });
    expect(seen.url.pathname).toBe("/v1/commitments/changes");
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      since: "2026-10-01T00:00:00Z",
      sport: "soccer",
      gender: "women",
      grad_year: "2027",
    });
    expect(page.data).toHaveLength(1);

    const src = recording({ data: [{ key: "tds", name: "Top Drawer Soccer" }] });
    const list = await src.client.commitments.sources();
    expect(src.seen.method).toBe("GET");
    expect(src.seen.url.pathname).toBe("/v1/commitments/sources");
    expect(list.data).toHaveLength(1);
  });

  it("lists portal supply counts and their change log", async () => {
    const { client, seen } = recording({
      data: [{ id: 9, team_id: 3, lane: "GK", in_portal: 2, in_portal_returning: 1, signed_out: 0 }],
      next_cursor: null,
      has_more: false,
    });
    const page = await client.portalSupply.list({
      sport: "soccer",
      gender: "women",
      division: "D1",
      lane: "GK,none",
      include_zero: true,
    });
    expect(seen.method).toBe("GET");
    expect(seen.url.pathname).toBe("/v1/portal/supply");
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      sport: "soccer",
      gender: "women",
      division: "D1",
      lane: "GK,none",
      include_zero: "true",
    });
    expect(page.data).toHaveLength(1);

    const log = recording({
      data: [{ changed_at: "2026-11-02T00:00:00Z", revision: 2, supply: { id: 9, in_portal: 0 } }],
      next_cursor: null,
      has_more: false,
    });
    const changes = await log.client.portalSupply.changes({
      since: "2026-11-01T00:00:00Z",
      team_id: "3,4",
    });
    expect(log.seen.url.pathname).toBe("/v1/portal/supply/changes");
    expect(Object.fromEntries(log.seen.url.searchParams)).toEqual({
      since: "2026-11-01T00:00:00Z",
      team_id: "3,4",
    });
    expect(changes.data[0].revision).toBe(2);
  });

  it("lists movement changes, mapping sportPath to sport_path", async () => {
    const { client, seen } = recording({
      data: [{ changed_at: "2026-10-02T00:00:00Z", movement: { id: 59, kind: "coach" } }],
      next_cursor: null,
      has_more: false,
    });
    const page = await client.movements.changes({
      since: "2026-10-01T00:00:00Z",
      kind: "coach",
      sportPath: "womens-volleyball",
      division: "D1,D2",
      limit: 50,
    });
    expect(seen.method).toBe("GET");
    expect(seen.url.pathname).toBe("/v1/movements/changes");
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      since: "2026-10-01T00:00:00Z",
      kind: "coach",
      sport_path: "womens-volleyball",
      division: "D1,D2",
      limit: "50",
    });
    expect(page.data[0].movement.id).toBe(59);
  });

  it("sends movements.list region filters", async () => {
    const { client, seen } = recording(emptyPage);
    await client.movements.list({ region: "NJCAA Region IV", regionNot: "Region 3" });
    expect(seen.url.pathname).toBe("/v1/movements");
    expect(seen.url.searchParams.get("region")).toBe("NJCAA Region IV");
    expect(seen.url.searchParams.get("region_not")).toBe("Region 3");
  });

  it("lists regions and eligibility rules", async () => {
    const r = recording({ data: ["NJCAA Region IV"] });
    const regions = await r.client.reference.regions({
      sport: "soccer",
      division: "NJCAA-D1",
      gender: "women",
    });
    expect(r.seen.url.pathname).toBe("/v1/regions");
    expect(Object.fromEntries(r.seen.url.searchParams)).toEqual({
      sport: "soccer",
      division: "NJCAA-D1",
      gender: "women",
    });
    expect(regions.data).toEqual(["NJCAA Region IV"]);

    const e = recording({ data: [{ association: "NCAA" }] });
    const rules = await e.client.reference.eligibilityRules();
    expect(e.seen.method).toBe("GET");
    expect(e.seen.url.pathname).toBe("/v1/eligibility/rules");
    expect(rules.data).toHaveLength(1);
  });

  it("reads team postseason and rankings with an optional division", async () => {
    const p = recording({ team_id: 1873, data: [{ kind: "bowl_game" }], coverage: [] });
    const post = await p.client.teams.postseason(1873, {
      sport: "soccer",
      season: "2025,2024",
      kind: "national_tournament",
    });
    expect(p.seen.url.pathname).toBe("/v1/teams/1873/postseason");
    expect(Object.fromEntries(p.seen.url.searchParams)).toEqual({
      sport: "soccer",
      season: "2025,2024",
      kind: "national_tournament",
    });
    expect(post.team_id).toBe(1873);

    const r = recording({ team_id: 1873, data: [{ ranking_system: "RPI" }] });
    const ranks = await r.client.teams.rankings(1873, {
      sport: "volleyball",
      division: "D1",
      gender: "women",
      ranking_system: "RPI",
    });
    expect(r.seen.url.pathname).toBe("/v1/teams/1873/rankings");
    expect(Object.fromEntries(r.seen.url.searchParams)).toEqual({
      sport: "volleyball",
      division: "D1",
      gender: "women",
      ranking_system: "RPI",
    });
    expect(ranks.team_id).toBe(1873);
  });

  it("sends the new teams.list and teams.roster filters, booleans as true/false", async () => {
    const t = recording(emptyPage);
    await t.client.teams.list({
      sport: "soccer",
      division: "NJCAA-D1",
      region: "NJCAA Region IV",
      region_not: "Region 3",
      roster_changed_since: "2026-10-01T00:00:00Z",
      coaches_changed_since: "2026-10-02T00:00:00Z",
    });
    expect(Object.fromEntries(t.seen.url.searchParams)).toEqual({
      sport: "soccer",
      division: "NJCAA-D1",
      region: "NJCAA Region IV",
      region_not: "Region 3",
      roster_changed_since: "2026-10-01T00:00:00Z",
      coaches_changed_since: "2026-10-02T00:00:00Z",
    });

    const r = recording({ ...emptyPage, season: "2026" });
    const page = await r.client.teams.roster(1873, {
      sport: "soccer",
      division: "D3",
      class_level: "SR,GR",
      class_level_not: "FR",
      class_redshirt: true,
      seasons_remaining_min: 2,
      eligibility_confidence: "high",
    });
    expect(r.seen.url.pathname).toBe("/v1/teams/1873/roster");
    expect(r.seen.url.searchParams.get("class_redshirt")).toBe("true");
    expect(r.seen.url.searchParams.get("seasons_remaining_min")).toBe("2");
    expect(r.seen.url.searchParams.get("class_level")).toBe("SR,GR");
    expect(r.seen.url.searchParams.get("class_level_not")).toBe("FR");
    expect(r.seen.url.searchParams.get("eligibility_confidence")).toBe("high");
    expect(page.season).toBe("2026");

    const f = recording(emptyPage);
    await f.client.teams.roster(1873, { sport: "soccer", division: "D3", class_redshirt: false });
    expect(f.seen.url.searchParams.get("class_redshirt")).toBe("false");
  });

  it("sends games.list region", async () => {
    const { client, seen } = recording(emptyPage);
    await client.games.list({ sport: "soccer", division: "NJCAA-D1", region: "Region IV" });
    expect(seen.url.searchParams.get("region")).toBe("Region IV");
  });

  it("lists schools with profile filters, returning SchoolSummary rows", async () => {
    const { client, seen } = recording({
      data: [
        {
          id: 812,
          name: "Amherst College",
          profile: { control: "Private not-for-profit", admission_rate: 0.07 },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    const page = await client.schools.list({
      control: "Private not-for-profit",
      religiousAffiliation: "Roman Catholic",
      admissionRateMin: 0.05,
      admissionRateMax: 0.2,
      undergradEnrollmentMin: 1000,
      undergradEnrollmentMax: 3000,
      region: "NJCAA Region IV",
    });
    expect(seen.url.pathname).toBe("/v1/schools");
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      control: "Private not-for-profit",
      religious_affiliation: "Roman Catholic",
      admission_rate_min: "0.05",
      admission_rate_max: "0.2",
      undergrad_enrollment_min: "1000",
      undergrad_enrollment_max: "3000",
      region: "NJCAA Region IV",
    });
    expect(page.data[0].profile?.admission_rate).toBe(0.07);
  });

  it("gets a swimmer's times with best_only sent as true", async () => {
    const { client, seen } = recording({
      data: [{ event: "SCY-100-FR", course: "SCY" }],
      next_cursor: null,
      has_more: false,
    });
    const page = await client.players.times(184223, {
      sport: "swimming-and-diving",
      division: "D1",
      gender: "women",
      event: "SCY-100-FR,SCY-200-FR",
      course: "SCY",
      season: "2027",
      best_only: true,
      limit: 20,
    });
    expect(seen.method).toBe("GET");
    expect(seen.url.pathname).toBe("/v1/players/184223/times");
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      sport: "swimming-and-diving",
      division: "D1",
      gender: "women",
      event: "SCY-100-FR,SCY-200-FR",
      course: "SCY",
      season: "2027",
      best_only: "true",
      limit: "20",
    });
    expect(page.data[0].event).toBe("SCY-100-FR");
  });

  it("lists and gets golf tournaments and ratings", async () => {
    const t = recording({ data: [{ id: 4, name: "Southern Intercollegiate" }], next_cursor: null, has_more: false });
    const page = await t.client.golf.listTournaments({
      sport: "golf",
      division: "D1",
      gender: "women",
      season: "2027",
      team_id: "1,2",
      status: "final",
      start_date_min: "2026-09-01",
      start_date_max: "2026-11-01",
      limit: 10,
    });
    expect(t.seen.url.pathname).toBe("/v1/golf/tournaments");
    expect(Object.fromEntries(t.seen.url.searchParams)).toEqual({
      sport: "golf",
      division: "D1",
      gender: "women",
      season: "2027",
      team_id: "1,2",
      status: "final",
      start_date_min: "2026-09-01",
      start_date_max: "2026-11-01",
      limit: "10",
    });
    expect(page.data[0].name).toBe("Southern Intercollegiate");

    const d = recording({ id: 4, name: "Southern Intercollegiate" });
    const detail = await d.client.golf.getTournament(4, { sport: "golf", division: "D1", gender: "women" });
    expect(d.seen.method).toBe("GET");
    expect(d.seen.url.pathname).toBe("/v1/golf/tournaments/4");
    expect(Object.fromEntries(d.seen.url.searchParams)).toEqual({
      sport: "golf",
      division: "D1",
      gender: "women",
    });
    expect(detail.id).toBe(4);

    const r = recording({ data: [{ entity: "team", rating: 70.1 }], next_cursor: null, has_more: false });
    const ratings = await r.client.golf.listRatings({
      sport: "golf",
      division: "D1",
      entity: "team",
      team_id: "9",
      as_of: "2026-10-15",
    });
    expect(r.seen.url.pathname).toBe("/v1/golf/ratings");
    expect(Object.fromEntries(r.seen.url.searchParams)).toEqual({
      sport: "golf",
      division: "D1",
      entity: "team",
      team_id: "9",
      as_of: "2026-10-15",
    });
    expect(ratings.data).toHaveLength(1);
  });

  it("lists and gets swim meets and keeps meet_id on result pages", async () => {
    const m = recording({ data: [{ id: 12, name: "Zippy Invite" }], next_cursor: null, has_more: false });
    const meets = await m.client.swim.listMeets({
      sport: "swimming-and-diving",
      division: "D1",
      season: "2027",
      meet_type: "invitational",
      course: "SCY",
      team_id: "5",
      start_date_min: "2026-10-01",
      start_date_max: "2026-11-30",
    });
    expect(m.seen.url.pathname).toBe("/v1/swim/meets");
    expect(Object.fromEntries(m.seen.url.searchParams)).toEqual({
      sport: "swimming-and-diving",
      division: "D1",
      season: "2027",
      meet_type: "invitational",
      course: "SCY",
      team_id: "5",
      start_date_min: "2026-10-01",
      start_date_max: "2026-11-30",
    });
    expect(meets.data[0].id).toBe(12);

    const d = recording({ id: 12, name: "Zippy Invite" });
    const detail = await d.client.swim.getMeet(12, { sport: "swimming-and-diving", division: "D1" });
    expect(d.seen.url.pathname).toBe("/v1/swim/meets/12");
    expect(detail.id).toBe(12);

    const calls: URL[] = [];
    const { client } = makeClient((url) => {
      calls.push(new URL(url));
      const first = calls.length === 1;
      return json(200, {
        meet_id: 12,
        data: [{ event: { code: "SCY-100-FR" }, gender: "women", results: [] }],
        next_cursor: first ? "r2" : null,
        has_more: first,
      });
    });
    const page = await client.swim.listMeetResults(12, {
      sport: "swimming-and-diving",
      division: "D1",
      event: "SCY-100-FR",
      round: "final",
      limit: 100,
    });
    expect(calls[0].pathname).toBe("/v1/swim/meets/12/results");
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({
      sport: "swimming-and-diving",
      division: "D1",
      event: "SCY-100-FR",
      round: "final",
      limit: "100",
    });
    expect(page.meetId).toBe(12);
    let n = 0;
    for await (const group of page) {
      expect(group.gender).toBe("women");
      n++;
    }
    expect(n).toBe(2);
    expect(calls[1].searchParams.get("cursor")).toBe("r2");
    expect(calls[1].searchParams.get("round")).toBe("final");
  });

  it("lists tennis matches and ITA rankings", async () => {
    const m = recording({ data: [{ id: 1, match_type: "singles" }], next_cursor: null, has_more: false });
    const matches = await m.client.tennis.listMatches({
      sport: "tennis",
      division: "D1",
      gender: "women",
      player_id: "10,11",
      team_id: "3",
      season: "2027",
      match_type: "singles",
      status: "completed",
      date_min: "2026-09-01",
      date_max: "2026-10-31",
    });
    expect(m.seen.method).toBe("GET");
    expect(m.seen.url.pathname).toBe("/v1/tennis/matches");
    expect(Object.fromEntries(m.seen.url.searchParams)).toEqual({
      sport: "tennis",
      division: "D1",
      gender: "women",
      player_id: "10,11",
      team_id: "3",
      season: "2027",
      match_type: "singles",
      status: "completed",
      date_min: "2026-09-01",
      date_max: "2026-10-31",
    });
    expect(matches.data[0].match_type).toBe("singles");

    const r = recording({ data: [{ rank: 1 }], next_cursor: null, has_more: false });
    const rankings = await r.client.tennis.listItaRankings({
      sport: "tennis",
      division: "D1",
      type: "doubles",
      season: "2027",
      release_date: "2026-10-20",
      team_id: "3",
      player_id: "10",
    });
    expect(r.seen.url.pathname).toBe("/v1/rankings/ita");
    expect(Object.fromEntries(r.seen.url.searchParams)).toEqual({
      sport: "tennis",
      division: "D1",
      type: "doubles",
      season: "2027",
      release_date: "2026-10-20",
      team_id: "3",
      player_id: "10",
    });
    expect(rankings.data[0].rank).toBe(1);
  });

  it("creates a sandbox event and does not auto-retry it", async () => {
    const { client, seen } = recording({
      event_id: "evt_1",
      type: "portal_entry",
      created: {},
      deliveries: 0,
    });
    const res = await client.sandbox.createEvent({
      type: "portal_entry",
      sport: "soccer",
      division: "D1",
      gender: "men",
      team_id: 5,
    });
    expect(seen.method).toBe("POST");
    expect(seen.url.pathname).toBe("/v1/sandbox/events");
    expect(res.event_id).toBe("evt_1");

    let calls = 0;
    const flaky = makeClient(() => {
      calls++;
      return json(503, errorBody("server_error", "unavailable", "down"));
    });
    await expect(
      flaky.client.sandbox.createEvent({ type: "coach_movement", sport: "soccer", division: "D1" }),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toBe(1);
  });

  it("reports the 0.8.0 version", () => {
    expect(VERSION).toBe("0.8.0");
  });
});

it("discovers a school and retains its program ID and evidence in player search", async () => {
  const name = "California State University, Bakersfield";
  const selected = { kind: "college", name, school_id: 990, in_scope_team_ids: [1554] };
  const result = { kind: "college", status: "resolved", selected, next_step: "Use the program ID." };
  const { client } = makeClient((url, init) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/v1/schools/resolve")) {
      expect(init.method).toBe("POST");
      expect(body.query).toBe(name);
      return json(200, result);
    }
    expect(url).toContain("/v1/players/search");
    expect(body.team_id).toEqual([1554]);
    expect(body.school).toEqual([name]);
    return json(200, { data: [], has_more: false, school_resolutions: [result] });
  });
  const scope = { sport: "soccer", gender: "women", division: "D1" };
  const discovery = await client.schools.resolve({ ...scope, kind: "college", query: name });
  const page = await client.players.search({
    ...scope, school: [name], team_id: discovery.selected?.in_scope_team_ids,
  });
  expect(page.schoolResolutions[0].selected).toEqual(selected);
});
