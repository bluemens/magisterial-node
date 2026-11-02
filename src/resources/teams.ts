// Teams: list, profile, roster.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  RosterEntry,
  RosterPage,
  TeamCoachesResponse,
  TeamDetail,
  TeamPage,
  TeamPostseasonResponse,
  TeamRankingsResponse,
  TeamSummary,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface TeamListParams extends ScopeParams {
  conference?: string;
  /** Filter to the school with this federal IPEDS UNITID. */
  ipeds_unitid?: number;
  /** An association's region, e.g. 'NJCAA Region IV'. */
  region?: string;
  /** Exclude these regions (comma-separated). */
  region_not?: string;
  /** ISO 8601 timestamp; only teams whose roster `freshness.changed_at` is
   * at/after it. Pass the time of your last sync. */
  roster_changed_since?: string;
  /** ISO 8601 timestamp; only teams whose coaching staff
   * `freshness.changed_at` is at/after it. */
  coaches_changed_since?: string;
  limit?: number;
  cursor?: string;
}

export interface RosterParams extends ScopeParams {
  season?: string;
  /** The season's class reading: 'FR', 'SO', 'JR', 'SR' or 'GR'
   * (`class_standing.level`). Comma-separated for any of. */
  class_level?: string;
  /** Exclude these class levels (comma-separated). */
  class_level_not?: string;
  /** true: the class carries a published redshirt marker; false: a readable
   * class without one. */
  class_redshirt?: boolean;
  /** At least this many seasons of eligibility left after the reading's
   * season (`eligibility.seasons_remaining`). */
  seasons_remaining_min?: number;
  /** 'high', 'medium' or 'low' (`eligibility.confidence`). */
  eligibility_confidence?: string;
  limit?: number;
  cursor?: string;
}

/** Scope for the team-season endpoints: `division` is optional and defaults
 * to the team's own current division. */
export interface TeamSeasonScopeParams {
  sport: string;
  division?: string;
  gender?: string;
  /** Team season, e.g. '2025'. Comma-separated for any of. */
  season?: string;
}

export interface TeamPostseasonParams extends TeamSeasonScopeParams {
  /** 'national_tournament', 'bowl_game', 'conference_regular_season' or
   * 'conference_tournament'. Comma-separated for any of. */
  kind?: string;
}

export interface TeamRankingsParams extends TeamSeasonScopeParams {
  /** Ranking system, e.g. 'RPI', 'Coaches Poll', 'ITA', 'Clippd' or
   * 'USCHO Poll'. Comma-separated for any of. */
  ranking_system?: string;
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

  /** A team's postseason history: tournaments, bowls, conference finishes. */
  postseason(
    teamId: number,
    params: TeamPostseasonParams,
  ): Promise<TeamPostseasonResponse> {
    return this.client.get(`/v1/teams/${teamId}/postseason`, { ...params });
  }

  /** A team's rankings and polls by season. */
  rankings(
    teamId: number,
    params: TeamRankingsParams,
  ): Promise<TeamRankingsResponse> {
    return this.client.get(`/v1/teams/${teamId}/rankings`, { ...params });
  }
}
