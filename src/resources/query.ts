// Natural-language query (usage-billed): async runs, submitted then polled.

import type { Magisterial } from "../client.js";
import { QueryPollTimeout } from "../error.js";
import type { QueryCreateResponse, QueryRunStatus } from "../types.js";

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled"]);

export interface QueryCreateParams {
  prompt: string;
  sport: string;
  division?: string;
  gender?: string;
}

export interface PollOptions {
  /** Milliseconds between polls. Default 2000. */
  pollIntervalMs?: number;
  /** Give up after this long. Default 300_000 (5 minutes). */
  timeoutMs?: number;
}

export class Query {
  constructor(private client: Magisterial) {}

  /** Submit a natural-language query run (returns immediately; the run
   * executes server-side). Billed by token usage once it finishes.
   * Not retried automatically: each accepted submission bills. */
  create(params: QueryCreateParams): Promise<QueryCreateResponse> {
    return this.client.request("POST", "/v1/query", { body: params });
  }

  /** Status of a query run; `answer` and `usage` appear once terminal. */
  get(runId: string): Promise<QueryRunStatus> {
    return this.client.get(`/v1/query/${runId}`);
  }

  /** Submit a query and wait until it reaches a terminal state
   * (done / error / cancelled). Throws QueryPollTimeout if the run is still
   * going after `timeoutMs` — the run keeps executing server-side and stays
   * fetchable via `get(runId)`. */
  async createAndPoll(
    params: QueryCreateParams,
    options: PollOptions = {},
  ): Promise<QueryRunStatus> {
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? 300_000;
    const created = await this.create(params);
    const deadline = Date.now() + timeoutMs;
    let run = await this.get(created.run_id);
    while (!TERMINAL_STATUSES.has(run.status)) {
      if (Date.now() >= deadline) {
        throw new QueryPollTimeout(created.run_id, run.status, timeoutMs);
      }
      await this.client._sleep(pollIntervalMs);
      run = await this.get(created.run_id);
    }
    return run;
  }
}
