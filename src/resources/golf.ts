// Golf: tournaments, leaderboards and ratings.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  GolfRatingEntry,
  GolfRatingPage,
  GolfTournamentDetail,
  GolfTournamentPage,
  GolfTournamentSummary,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface GolfTournamentListParams extends ScopeParams {
  /** Season by championship year: '2027' is 2026-27. */
  season?: string;
  /** Only tournaments these teams entered. */
  team_id?: string;
  /** scheduled | in_progress | final | cancelled | no_results */
  status?: string;
  /** ISO date; only tournaments starting on/after it. */
  start_date_min?: string;
  /** ISO date; only tournaments starting on/before it. */
  start_date_max?: string;
  limit?: number;
  cursor?: string;
}

export interface GolfRatingListParams extends ScopeParams {
  /** 'player' or 'team'. */
  entity?: string;
  /** Only these teams, or only the players of these teams. */
  team_id?: string;
  /** ISO date of a rating run. Omit for the latest run in scope. */
  as_of?: string;
  limit?: number;
  cursor?: string;
}

export class Golf {
  constructor(private client: Magisterial) {}

  /** Golf tournaments in a scope (`sport: "golf"`). */
  async listTournaments(
    params: GolfTournamentListParams,
  ): Promise<Page<GolfTournamentSummary>> {
    const fetch = async (
      query: GolfTournamentListParams,
    ): Promise<Page<GolfTournamentSummary>> => {
      const raw = await this.client.request<GolfTournamentPage>(
        "GET",
        "/v1/golf/tournaments",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One tournament with team and individual results. */
  getTournament(
    tournamentId: number,
    params: ScopeParams,
  ): Promise<GolfTournamentDetail> {
    return this.client.get(`/v1/golf/tournaments/${tournamentId}`, { ...params });
  }

  /** Player and team ratings for a rating run (latest by default). */
  async listRatings(params: GolfRatingListParams): Promise<Page<GolfRatingEntry>> {
    const fetch = async (
      query: GolfRatingListParams,
    ): Promise<Page<GolfRatingEntry>> => {
      const raw = await this.client.request<GolfRatingPage>(
        "GET",
        "/v1/golf/ratings",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
