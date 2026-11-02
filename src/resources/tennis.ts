// Tennis: matches and ITA rankings.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  TennisMatch,
  TennisMatchPage,
  TennisRankingEntry,
  TennisRankingPage,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface TennisMatchListParams extends ScopeParams {
  /** Only matches these players played in (either side). */
  player_id?: string;
  /** Only matches these teams' players played in. */
  team_id?: string;
  /** Season by championship year: '2027' is 2026-27. */
  season?: string;
  /** singles | doubles */
  match_type?: string;
  /** completed | retired | walkover | default | unfinished | cancelled */
  status?: string;
  /** ISO date; only matches on/after it. */
  date_min?: string;
  /** ISO date; only matches on/before it. */
  date_max?: string;
  limit?: number;
  cursor?: string;
}

export interface ItaRankingListParams extends ScopeParams {
  /** 'singles' (players) or 'doubles' (pairs). */
  type?: string;
  /** Season by championship year. Omit for the latest. */
  season?: string;
  /** ISO date of a release in the season. Omit for the latest release. */
  release_date?: string;
  team_id?: string;
  player_id?: string;
  limit?: number;
  cursor?: string;
}

export class Tennis {
  constructor(private client: Magisterial) {}

  /** Tennis matches in a scope (`sport: "tennis"`). */
  async listMatches(params: TennisMatchListParams): Promise<Page<TennisMatch>> {
    const fetch = async (
      query: TennisMatchListParams,
    ): Promise<Page<TennisMatch>> => {
      const raw = await this.client.request<TennisMatchPage>(
        "GET",
        "/v1/tennis/matches",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** ITA rankings (latest release by default). */
  async listItaRankings(
    params: ItaRankingListParams,
  ): Promise<Page<TennisRankingEntry>> {
    const fetch = async (
      query: ItaRankingListParams,
    ): Promise<Page<TennisRankingEntry>> => {
      const raw = await this.client.request<TennisRankingPage>(
        "GET",
        "/v1/rankings/ita",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
