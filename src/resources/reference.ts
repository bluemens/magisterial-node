// Reference data: sports, divisions, conferences, filter catalog, coverage.

import type { Magisterial } from "../client.js";
import type { SportListResponse, StringListResponse } from "../types.js";

export class Reference {
  constructor(private client: Magisterial) {}

  /** Supported sports and the genders each carries. */
  sports(): Promise<SportListResponse> {
    return this.client.get("/v1/sports");
  }

  /** Every public division value, e.g. D1, D1-FBS, NAIA, NJCAA-D1. */
  divisions(): Promise<StringListResponse> {
    return this.client.get("/v1/divisions");
  }

  /** Conferences present in one sport/division scope. */
  conferences(params: {
    sport: string;
    division: string;
    gender?: string;
  }): Promise<StringListResponse> {
    return this.client.get("/v1/conferences", params);
  }

  /** Data-coverage matrix: per sport/division/season counts. */
  coverage(): Promise<Record<string, unknown>> {
    return this.client.get("/v1/coverage");
  }

  /** Queryable/sortable fields per sport (feeds players.search sortBy and
   * alert filter DSLs). */
  filterCatalog(params: { sport?: string } = {}): Promise<Record<string, unknown>> {
    return this.client.get("/v1/filters/catalog", params);
  }
}
