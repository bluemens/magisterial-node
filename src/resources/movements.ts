// Movements: the published roster/coaching movement feed.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  MovementChange,
  MovementChangePage,
  MovementEntry,
  MovementPage,
} from "../types.js";

export interface MovementListParams {
  /** 'player' or 'coach'. */
  kind?: string;
  /** Full sport path, e.g. 'womens-volleyball'. */
  sportPath?: string;
  /** ISO datetime; only movements published on/after. */
  since?: string;
  /** Feed tier: 'published' (curated, every plan), 'resolved' (identity
   * resolution finished; Enterprise), or 'observed' (every non-dismissed
   * event including pending ones; Enterprise). Defaults to 'published'. */
  status?: "published" | "resolved" | "observed";
  /** Region of the team, e.g. 'NJCAA Region IV'. */
  region?: string;
  /** Exclude these regions (comma-separated). */
  regionNot?: string;
  limit?: number;
  cursor?: string;
}

export interface MovementChangesParams {
  /** ISO datetime; only changes recorded at/after it (`changed_at`). Omit to
   * read the whole log. */
  since?: string;
  /** 'player' or 'coach'. */
  kind?: string;
  /** Full sport path, e.g. 'womens-volleyball'. */
  sportPath?: string;
  /** Sport, e.g. 'soccer': both genders unless `gender` is given. */
  sport?: string;
  /** 'men' or 'women'. */
  gender?: string;
  /** Division of the team, e.g. 'D3' or 'D1,D2'. */
  division?: string;
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
            status: query.status,
            region: query.region,
            region_not: query.regionNot,
            limit: query.limit,
            cursor: query.cursor,
          },
        },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** The movement change log (a movement appearing, being corrected or
   * withdrawn), for incremental sync: pass the time of your last read as
   * `since`. */
  async changes(
    params: MovementChangesParams = {},
  ): Promise<Page<MovementChange>> {
    const fetch = async (
      query: MovementChangesParams,
    ): Promise<Page<MovementChange>> => {
      const raw = await this.client.request<MovementChangePage>(
        "GET",
        "/v1/movements/changes",
        {
          query: {
            since: query.since,
            kind: query.kind,
            sport_path: query.sportPath,
            sport: query.sport,
            gender: query.gender,
            division: query.division,
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
