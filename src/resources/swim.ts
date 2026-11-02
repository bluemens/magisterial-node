// Swimming & diving: meets, events and results.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  SwimEventResults,
  SwimMeetDetail,
  SwimMeetPage,
  SwimMeetResultsPage,
  SwimMeetSummary,
} from "../types.js";
import type { ScopeParams } from "./players.js";

export interface SwimMeetListParams extends ScopeParams {
  /** Season by championship year: '2027' is 2026-27. */
  season?: string;
  /** dual | tri | invitational | conference_championship | ncaa | naia |
   * njcaa | time_trial | unknown */
  meet_type?: string;
  /** SCY | SCM | LCM | mixed */
  course?: string;
  /** Only meets these teams swam, relayed or scored in. */
  team_id?: string;
  /** ISO date; only meets starting on/after it. */
  start_date_min?: string;
  /** ISO date; only meets starting on/before it. */
  start_date_max?: string;
  limit?: number;
  cursor?: string;
}

export interface SwimMeetResultsParams extends ScopeParams {
  /** Event code(s), e.g. 'SCY-100-FR' or 'DIVE-3M-11'. */
  event?: string;
  /** prelim | final | timed_final | swim_off | time_trial */
  round?: string;
  /** Results per page (not events). */
  limit?: number;
  cursor?: string;
}

export class Swim {
  constructor(private client: Magisterial) {}

  /** Swimming & diving meets in a scope (`sport: "swimming-and-diving"`). */
  async listMeets(params: SwimMeetListParams): Promise<Page<SwimMeetSummary>> {
    const fetch = async (
      query: SwimMeetListParams,
    ): Promise<Page<SwimMeetSummary>> => {
      const raw = await this.client.request<SwimMeetPage>(
        "GET",
        "/v1/swim/meets",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One meet with its events and team scores. */
  getMeet(meetId: number, params: ScopeParams): Promise<SwimMeetDetail> {
    return this.client.get(`/v1/swim/meets/${meetId}`, { ...params });
  }

  /** A meet's results, grouped by event (each item is one event's results).
   * The page's `meetId` carries the response's `meet_id`. */
  async listMeetResults(
    meetId: number,
    params: SwimMeetResultsParams,
  ): Promise<Page<SwimEventResults>> {
    const fetch = async (
      query: SwimMeetResultsParams,
    ): Promise<Page<SwimEventResults>> => {
      const raw = await this.client.request<SwimMeetResultsPage>(
        "GET",
        `/v1/swim/meets/${meetId}/results`,
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
