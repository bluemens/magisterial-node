// Teams: list, profile, roster.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  RosterEntry,
  RosterPage,
  TeamDetail,
  TeamPage,
  TeamSummary,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface TeamListParams extends ScopeParams {
  conference?: string;
  limit?: number;
  cursor?: string;
}

export interface RosterParams extends ScopeParams {
  limit?: number;
  cursor?: string;
}

export class Teams {
  constructor(private client: Magisterial) {}

  /** Teams in a sport/division scope, alphabetical. */
  async list(params: TeamListParams): Promise<Page<TeamSummary>> {
    const fetch = async (query: TeamListParams): Promise<Page<TeamSummary>> => {
      const raw = await this.client.request<TeamPage>("GET", "/v1/teams", {
        query: { ...query },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One team plus its per-season records. */
  get(teamId: number, params: ScopeParams): Promise<TeamDetail> {
    return this.client.get(`/v1/teams/${teamId}`, { ...params });
  }

  /** A team's roster (identity fields only). */
  async roster(teamId: number, params: RosterParams): Promise<Page<RosterEntry>> {
    const fetch = async (query: RosterParams): Promise<Page<RosterEntry>> => {
      const raw = await this.client.request<RosterPage>(
        "GET",
        `/v1/teams/${teamId}/roster`,
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
