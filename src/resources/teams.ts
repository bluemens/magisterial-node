// Teams: list, profile, roster.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  RosterEntry,
  RosterPage,
  TeamCoachesResponse,
  TeamDetail,
  TeamPage,
  TeamSummary,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface TeamListParams extends ScopeParams {
  conference?: string;
  /** Filter to the school with this federal IPEDS UNITID. */
  ipeds_unitid?: number;
  limit?: number;
  cursor?: string;
}

export interface RosterParams extends ScopeParams {
  season?: string;
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

  /** A team's roster for a season (identity fields only). */
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

  /** A team's coaching staff for a season (defaults to the most recent
   * season on record). `on_behalf_of` (Enterprise): the player id of a
   * managed athlete who has authorized your account — contact fields are
   * then evaluated against that athlete's verified claim, audited, and
   * billed at the delegated coach-contact rate. */
  coaches(
    teamId: number,
    params: ScopeParams & { season?: string; on_behalf_of?: number },
  ): Promise<TeamCoachesResponse> {
    return this.client.get(`/v1/teams/${teamId}/coaches`, { ...params });
  }
}
