// Schools: institutions behind teams, cross-division and cross-sport.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type { SchoolDetail, SchoolPage, SchoolRef } from "../types.js";

export interface SchoolListParams {
  /** Case-insensitive name contains. */
  q?: string;
  /** Two-letter US state code. */
  state?: string;
  /** Exact federal IPEDS UNITID. */
  ipedsUnitid?: number;
  limit?: number;
  cursor?: string;
}

export class Schools {
  constructor(private client: Magisterial) {}

  /** Institutions, alphabetical, with the federal IPEDS UNITID where
   * matched. Cross-division and cross-sport; no scope parameters. Look a
   * school up by `ipedsUnitid` to map your own records onto ours, then
   * fetch its programs with `schools.get(schoolId)`. */
  async list(params: SchoolListParams = {}): Promise<Page<SchoolRef>> {
    const fetch = async (query: SchoolListParams): Promise<Page<SchoolRef>> => {
      const raw = await this.client.request<SchoolPage>("GET", "/v1/schools", {
        query: {
          q: query.q,
          state: query.state,
          ipeds_unitid: query.ipedsUnitid,
          limit: query.limit,
          cursor: query.cursor,
        },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One institution plus every program it fields across sports and
   * divisions (team ids for the scoped team endpoints). Identity only;
   * stats stay behind the sport/division-scoped endpoints. */
  get(schoolId: number): Promise<SchoolDetail> {
    return this.client.get(`/v1/schools/${schoolId}`);
  }
}
