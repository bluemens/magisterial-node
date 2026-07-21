// Games: schedules/results list plus per-game box scores and play-by-play.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type { GameFixture, GamePage, GameSummary } from "../types.js";
import type { ScopeParams } from "./players.js";

export interface GameListParams extends ScopeParams {
  team_id?: number;
  season?: string;
  date_from?: string;
  date_to?: string;
  /** 'scheduled' | 'final' | 'postponed' | 'cancelled' | 'forfeit' */
  status?: string;
  limit?: number;
  cursor?: string;
}

export class Games {
  constructor(private client: Magisterial) {}

  /** Games in a sport/division scope, filterable by team, season, date
   * range, and status. */
  async list(params: GameListParams): Promise<Page<GameFixture>> {
    const fetch = async (query: GameListParams): Promise<Page<GameFixture>> => {
      const raw = await this.client.request<GamePage>("GET", "/v1/games", {
        query: { ...query },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One game with box score / play-by-play where covered. */
  get(gameId: number, params: ScopeParams): Promise<GameSummary> {
    return this.client.get(`/v1/games/${gameId}`, { ...params });
  }
}
