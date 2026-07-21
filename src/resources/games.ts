// Games: box scores and play-by-play where covered.

import type { Magisterial } from "../client.js";
import type { GameSummary } from "../types.js";
import type { ScopeParams } from "./players.js";

export class Games {
  constructor(private client: Magisterial) {}

  /** One game with box score / play-by-play where covered. */
  get(gameId: number, params: ScopeParams): Promise<GameSummary> {
    return this.client.get(`/v1/games/${gameId}`, { ...params });
  }
}
