// Commitments: recruiting commitments across sports, plus the change log.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  CommitmentChange,
  CommitmentChangePage,
  CommitmentEntry,
  CommitmentPage,
  CommitmentSourceList,
} from "../types.js";

/** Every filter below takes one value, or several separated by commas
 * (any of), unless noted. Cross-division and cross-sport: no scope
 * parameters are required. */
export interface CommitmentListParams {
  /** Full sport path, e.g. 'womens-volleyball'. */
  sport_path?: string;
  /** Sport, e.g. 'soccer': both genders unless `gender` is given. */
  sport?: string;
  /** 'men' or 'women'. */
  gender?: string;
  /** Division of the committed program, e.g. 'D2' or 'D3,NAIA'. */
  division?: string;
  /** High-school graduation class, e.g. '2027'. */
  grad_year?: string;
  /** College entry year (ice hockey sources give this instead). */
  entry_year?: string;
  /** 'committed', 'signed' or 'decommitted'. */
  status?: string;
  team_id?: string;
  school_id?: string;
  /** Federal IPEDS UNITID of the school. */
  ipeds_unitid?: number;
  conference?: string;
  /** Exclude these conferences (comma-separated). */
  conference_not?: string;
  /** Region of the program, e.g. 'NJCAA Region IV'. */
  region?: string;
  region_not?: string;
  /** Two-letter US state code of the school. */
  state?: string;
  state_not?: string;
  /** The athlete's home state, two-letter codes. */
  home_state?: string;
  /** Only commitments this source lists (see `commitments.sources()`). */
  source?: string;
  /** The athletes' person ids: every commitment each has made. */
  person_id?: string;
  /** Case-insensitive athlete name contains. */
  q?: string;
  /** ISO datetime; only commitments first reported at/after it. */
  since?: string;
  /** ISO datetime; only commitments first reported at/before it. */
  until?: string;
  /** ISO date; `committed_on` on/after it. */
  committed_since?: string;
  /** ISO date; `committed_on` on/before it. */
  committed_until?: string;
  /** 'first_reported_at' (default) or 'committed_on'; newest first. */
  sort?: string;
  limit?: number;
  cursor?: string;
}

export interface CommitmentChangesParams {
  /** ISO datetime; only changes recorded at/after it. Omit to read the whole log. */
  since?: string;
  sport_path?: string;
  sport?: string;
  gender?: string;
  division?: string;
  grad_year?: string;
  limit?: number;
  cursor?: string;
}

export class Commitments {
  constructor(private client: Magisterial) {}

  /** College commitments, newest first, across every sport and division,
   * reconciled across every public source that lists them. Developer Pro
   * and up. */
  async list(params: CommitmentListParams = {}): Promise<Page<CommitmentEntry>> {
    const fetch = async (
      query: CommitmentListParams,
    ): Promise<Page<CommitmentEntry>> => {
      const raw = await this.client.request<CommitmentPage>(
        "GET",
        "/v1/commitments",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One published commitment. A retracted one is a 404 here and appears in
   * `changes()` with its reason. Developer Pro and up. */
  get(commitmentId: number): Promise<CommitmentEntry> {
    return this.client.get(`/v1/commitments/${commitmentId}`);
  }

  /** The commitment change log (new, signed, decommitted, edited), for
   * incremental sync: pass the time of your last read as `since`.
   * Developer Pro and up. */
  async changes(
    params: CommitmentChangesParams = {},
  ): Promise<Page<CommitmentChange>> {
    const fetch = async (
      query: CommitmentChangesParams,
    ): Promise<Page<CommitmentChange>> => {
      const raw = await this.client.request<CommitmentChangePage>(
        "GET",
        "/v1/commitments/changes",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** The sources commitments are collected from (filter values for
   * `list({ source })`). Developer Pro and up. */
  sources(): Promise<CommitmentSourceList> {
    return this.client.get("/v1/commitments/sources");
  }
}
