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

    const page = await client.players.search({ sport: "soccer", division: "D1", limit: 2 });
    const names: string[] = [];
    for await (const p of page) names.push(p.name!);
    expect(names).toEqual(["Player 1", "Player 2", "Player 3"]);
    expect(bodies[1].sport).toBe("soccer");
    expect(bodies[1].limit).toBe(2);
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
