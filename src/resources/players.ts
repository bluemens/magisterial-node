// Players: search, profile, season history.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  PlayerDetail,
  PlayerSearchPage,
  PlayerSeasonsResponse,
  PlayerSummary,
} from "../types.js";

export interface PlayerSearchParams {
  sport: string;
  division: string;
  gender?: string;
  team_name?: string;
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

export interface ScopeParams {
  sport: string;
  division: string;
  gender?: string;
}

export class Players {
  constructor(private client: Magisterial) {}

  /** Search players within a sport/division scope. Sortable stat fields come
   * from `client.reference.filterCatalog()`. `for await` on the returned page
   * iterates every result across pages. */
  async search(params: PlayerSearchParams): Promise<Page<PlayerSummary>> {
    const fetch = async (body: PlayerSearchParams): Promise<Page<PlayerSummary>> => {
      // POST, but a pure read — safe to retry.
      const raw = await this.client.request<PlayerSearchPage>(
        "POST",
        "/v1/players/search",
        { body, retryable: true },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...body, cursor }));
    };
    return fetch(params);
  }

  /** Full profile: identity, season stats, accolades, career. */
  get(playerId: number, params: ScopeParams): Promise<PlayerDetail> {
    return this.client.get(`/v1/players/${playerId}`, { ...params });
  }

  /** Season-by-season stats and accolades only. */
  seasons(playerId: number, params: ScopeParams): Promise<PlayerSeasonsResponse> {
    return this.client.get(`/v1/players/${playerId}/seasons`, { ...params });
  }
}
