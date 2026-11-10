// Players: search, profile, season history.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw, type RawPage } from "../pagination.js";
import type {
  PlayerDetailOf,
  PlayerSearchPage,
  PlayerSeasonsResponseOf,
  PlayerSummaryOf,
  SwimTime,
  SwimTimesPage,
} from "../types.js";

export interface PlayerSearchParams<S extends string = string> {
  sport: S;
  division: string;
  gender?: string;
  team_name?: string | string[];
  /** Whole school name(s), including punctuation commas. Retain resolved IDs. */
  school?: string | string[];
  school_id?: number[];
  team_id?: number[];
  high_school_id?: number[];
  high_school_nces_id?: string | string[];
  conference?: string;
  position?: string;
  class_year?: string;
  hometown?: string;
  major?: string;
  season?: string;
  sort_by?: string;
  sort_order?: "ascending" | "descending";
  limit?: number;
  cursor?: string;
}

export interface ScopeParams<S extends string = string> {
  sport: S;
  division: string;
  gender?: string;
}

export interface SwimTimesParams extends ScopeParams {
  /** Event code(s), e.g. 'SCY-100-FR'. Comma-separated for any of. */
  event?: string;
  /** SCY | SCM | LCM. Comma-separated for any of. */
  course?: string;
  /** Season by championship year: '2027' is 2026-27. */
  season?: string;
  /** true: only the athlete's best swim (or highest dive score) per event. */
  best_only?: boolean;
  limit?: number;
  cursor?: string;
}

export class Players {
  constructor(private client: Magisterial) {}

  /** Search players within a sport/division scope. Sortable stat fields come
   * from `client.reference.filterCatalog()`; they are also the keys of each
   * row's `stats`, which is typed when `sport` is a literal ("soccer").
   * `for await` on the returned page iterates every result across pages. */
  async search<S extends string>(
    params: PlayerSearchParams<S>,
  ): Promise<Page<PlayerSummaryOf<S>>> {
    const fetch = async (body: PlayerSearchParams<S>): Promise<Page<PlayerSummaryOf<S>>> => {
      // POST, but a pure read — safe to retry.
      const raw = await this.client.request<PlayerSearchPage>(
        "POST",
        "/v1/players/search",
        { body, retryable: true },
      );
      // The wire type leaves `stats` an open record; the sport searched says
      // which stat schema its rows follow.
      return pageFromRaw(raw as RawPage<PlayerSummaryOf<S>>, (cursor) =>
        fetch({ ...body, cursor }),
      );
    };
    return fetch(params);
  }

  /** Full profile: identity, `stats_by_season` (newest first), `stats_totals`,
   * accolades, career. */
  get<S extends string>(playerId: number, params: ScopeParams<S>): Promise<PlayerDetailOf<S>> {
    return this.client.get(`/v1/players/${playerId}`, { ...params });
  }

  /** Season-by-season stats and accolades only. */
  seasons<S extends string>(
    playerId: number,
    params: ScopeParams<S>,
  ): Promise<PlayerSeasonsResponseOf<S>> {
    return this.client.get(`/v1/players/${playerId}/seasons`, { ...params });
  }

  /** A swimmer's or diver's times (`sport: "swimming-and-diving"`). */
  async times(playerId: number, params: SwimTimesParams): Promise<Page<SwimTime>> {
    const fetch = async (query: SwimTimesParams): Promise<Page<SwimTime>> => {
      const raw = await this.client.request<SwimTimesPage>(
        "GET",
        `/v1/players/${playerId}/times`,
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
