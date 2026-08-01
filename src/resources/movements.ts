// Movements: the published roster/coaching movement feed.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type { MovementEntry, MovementPage } from "../types.js";

export interface MovementListParams {
  /** 'player' or 'coach'. */
  kind?: string;
  /** Full sport path, e.g. 'womens-volleyball'. */
  sportPath?: string;
  /** ISO datetime; only movements published on/after. */
  since?: string;
  limit?: number;
  cursor?: string;
}

export class Movements {
  constructor(private client: Magisterial) {}

  /** Published roster and coaching-staff movements, newest first.
   * Cross-division; no scope parameters. */
  async list(params: MovementListParams = {}): Promise<Page<MovementEntry>> {
    const fetch = async (
      query: MovementListParams,
    ): Promise<Page<MovementEntry>> => {
      const raw = await this.client.request<MovementPage>(
        "GET",
        "/v1/movements",
        {
          query: {
            kind: query.kind,
            sport_path: query.sportPath,
            since: query.since,
            limit: query.limit,
            cursor: query.cursor,
          },
        },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
