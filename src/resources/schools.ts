// Schools: institutions behind teams, cross-division and cross-sport.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type { SchoolDetail, SchoolPage, SchoolSummary } from "../types.js";

export interface SchoolListParams {
  /** Case-insensitive name contains. */
  q?: string;
  /** Two-letter US state code. */
  state?: string;
  /** Exact federal IPEDS UNITID. */
  ipedsUnitid?: number;
  /** 'Public', 'Private nonprofit' or 'Private for-profit' (the school's `control`). */
  control?: string;
  /** As `profile.religious_affiliation` spells it, e.g. 'Roman Catholic'. */
  religiousAffiliation?: string;
  /** Admission rate at least this, 0-1. Leaves out schools with no rate. */
  admissionRateMin?: number;
  /** Admission rate at most this, 0-1 (0.2 = admits at most 20%). */
  admissionRateMax?: number;
  /** Undergraduate enrollment at least this. */
  undergradEnrollmentMin?: number;
  /** Undergraduate enrollment at most this. */
  undergradEnrollmentMax?: number;
  /** Only schools with a program in this region, e.g. 'NJCAA Region IV'. */
  region?: string;
  limit?: number;
  cursor?: string;
}

export class Schools {
  constructor(private client: Magisterial) {}

  /** Institutions, alphabetical, with the federal IPEDS UNITID where
   * matched and each school's College Scorecard `profile` (admissions,
   * SAT/ACT ranges, enrollment, tuition, net price, outcomes; null where no
   * federal profile is held). Cross-division and cross-sport; no scope
   * parameters. Look a school up by `ipedsUnitid` to map your own records
   * onto ours, then fetch its programs with `schools.get(schoolId)`. */
  async list(params: SchoolListParams = {}): Promise<Page<SchoolSummary>> {
    const fetch = async (query: SchoolListParams): Promise<Page<SchoolSummary>> => {
      const raw = await this.client.request<SchoolPage>("GET", "/v1/schools", {
        query: {
          q: query.q,
          state: query.state,
          ipeds_unitid: query.ipedsUnitid,
          control: query.control,
          religious_affiliation: query.religiousAffiliation,
          admission_rate_min: query.admissionRateMin,
          admission_rate_max: query.admissionRateMax,
          undergrad_enrollment_min: query.undergradEnrollmentMin,
          undergrad_enrollment_max: query.undergradEnrollmentMax,
          region: query.region,
          limit: query.limit,
          cursor: query.cursor,
        },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One institution, its College Scorecard `profile`, and every program it
   * fields across sports and divisions (team ids for the scoped team
   * endpoints). Athletics stats stay behind the sport/division-scoped
   * endpoints. */
  get(schoolId: number): Promise<SchoolDetail> {
    return this.client.get(`/v1/schools/${schoolId}`);
  }
}
