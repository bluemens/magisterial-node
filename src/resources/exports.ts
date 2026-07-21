// Bulk exports (usage-billed by result size): async jobs, submitted then
// polled; succeeded jobs carry a short-lived download_url minted per read.

import type { Magisterial } from "../client.js";
import { ExportPollTimeout } from "../error.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  ExportCreateResponse,
  ExportJobStatus,
  ExportListPage,
} from "../types.js";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "expired"]);

export interface ExportCreateParams {
  /** 'players' | 'teams' | 'games' | 'coaches' */
  dataset: string;
  sport: string;
  division: string;
  /** 'csv' (default) or 'jsonl'; the file is always gzipped. */
  format?: string;
  gender?: string;
  /** Season filter (championship year, e.g. "2025"). */
  season?: string;
  /** Conference filter (players/teams/coaches). */
  conference?: string;
}

export interface ExportPollOptions {
  /** Milliseconds between polls. Default 5000. */
  pollIntervalMs?: number;
  /** Give up after this long. Default 600_000 (10 minutes). */
  timeoutMs?: number;
}

export class Exports {
  constructor(private client: Magisterial) {}

  /** Submit an export job (one dataset in one scope, gzipped flat file).
   * Billed by result size once it finishes; not retried automatically. */
  create(params: ExportCreateParams): Promise<ExportCreateResponse> {
    return this.client.request("POST", "/v1/exports", { body: params });
  }

  /** Job status. `download_url` appears once succeeded and is minted fresh
   * (short-lived) on every read — re-poll for a new one. */
  get(exportId: string): Promise<ExportJobStatus> {
    return this.client.get(`/v1/exports/${exportId}`);
  }

  /** This account's export jobs, newest first. */
  async list(
    params: { limit?: number; cursor?: string } = {},
  ): Promise<Page<ExportJobStatus>> {
    const fetch = async (query: {
      limit?: number;
      cursor?: string;
    }): Promise<Page<ExportJobStatus>> => {
      const raw = await this.client.request<ExportListPage>("GET", "/v1/exports", {
        query: { ...query },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** Submit an export and wait until it reaches a terminal state
   * (succeeded / failed / expired). Throws ExportPollTimeout if still running
   * after `timeoutMs` — the job keeps executing server-side and stays
   * fetchable via `get(exportId)`. */
  async createAndPoll(
    params: ExportCreateParams,
    options: ExportPollOptions = {},
  ): Promise<ExportJobStatus> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const timeoutMs = options.timeoutMs ?? 600_000;
    const created = await this.create(params);
    const deadline = Date.now() + timeoutMs;
    let job = await this.get(created.export_id);
    while (!TERMINAL_STATUSES.has(job.status)) {
      if (Date.now() >= deadline) {
        throw new ExportPollTimeout(created.export_id, job.status, timeoutMs);
      }
      await this.client._sleep(pollIntervalMs);
      job = await this.get(created.export_id);
    }
    return job;
  }
}
