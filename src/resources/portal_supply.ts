// Portal supply: transfer portal counts per program and position group, and their change log.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  PortalSupplyChange,
  PortalSupplyChangePage,
  PortalSupplyEntry,
  PortalSupplyPage,
} from "../types.js";

/** Every filter below takes one value, or several separated by commas
 * (any of), unless noted. No scope parameters are required. */
export interface PortalSupplyListParams {
  /** Full sport path, e.g. 'womens-soccer'. */
  sport_path?: string;
  /** Sport, e.g. 'soccer': both genders unless `gender` is given. */
  sport?: string;
  /** 'men' or 'women'. */
  gender?: string;
  /** Division of the program, e.g. 'D2' or 'D1,D2'. 'D1' includes FBS and FCS. */
  division?: string;
  /** Conference of the program, by full name or abbreviation. */
  conference?: string;
  conference_not?: string;
  /** Program team ids. */
  team_id?: string;
  /** Position group, e.g. 'GK', 'QB' or 'sprint'; 'none' for rows with no group. */
  lane?: string;
  /** Also return rows whose counts are all zero. */
  include_zero?: boolean;
  limit?: number;
  cursor?: string;
}

export interface PortalSupplyChangesParams {
  /** ISO datetime; only changes dated at/after it (`changed_at`, inclusive). Omit to read the whole log. */
  since?: string;
  sport_path?: string;
  sport?: string;
  gender?: string;
  division?: string;
  team_id?: string;
  lane?: string;
  limit?: number;
  cursor?: string;
}

export class PortalSupply {
  constructor(private client: Magisterial) {}

  /** Who is in the transfer portal at each program, as counts per position
   * group with no one named. Counts are taken once a day; keep a copy
   * current with `changes()`. Developer Ultra and up. */
  async list(params: PortalSupplyListParams = {}): Promise<Page<PortalSupplyEntry>> {
    const fetch = async (
      query: PortalSupplyListParams,
    ): Promise<Page<PortalSupplyEntry>> => {
      const raw = await this.client.request<PortalSupplyPage>(
        "GET",
        "/v1/portal/supply",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** The change log of the portal supply feed, oldest change first. Pass the
   * last entry's `changed_at` as `since` on the next poll (inclusive) and
   * apply each entry by `supply.id`. Developer Ultra and up. */
  async changes(
    params: PortalSupplyChangesParams = {},
  ): Promise<Page<PortalSupplyChange>> {
    const fetch = async (
      query: PortalSupplyChangesParams,
    ): Promise<Page<PortalSupplyChange>> => {
      const raw = await this.client.request<PortalSupplyChangePage>(
        "GET",
        "/v1/portal/supply/changes",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
