// Transfer portal feed (usage-billed per request).

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type { PortalEntry, PortalPage } from "../types.js";

export interface PortalListParams {
  sport: string;
  division: string;
  gender?: string;
  /** NCAA record status filter, e.g. "INC" (active). */
  status?: string;
  /** Only entries first seen at/after this time (Date or ISO 8601 string). */
  since?: string | Date;
  limit?: number;
  cursor?: string;
}

export class Portal {
  constructor(private client: Magisterial) {}

  /** Live portal entries, newest first. Usage-billed per request — prefer
   * `since` for incremental polling over re-reading full pages. `contacts`
   * is populated only on PRO/MAX plans for the sport. */
  async list(params: PortalListParams): Promise<Page<PortalEntry>> {
    const { since, ...rest } = params;
    const sinceValue = since instanceof Date ? since.toISOString() : since;

    const fetch = async (
      query: Omit<PortalListParams, "since"> & { since?: string },
    ): Promise<Page<PortalEntry>> => {
      const raw = await this.client.request<PortalPage>("GET", "/v1/portal", {
        query: { ...query },
      });
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch({ ...rest, since: sinceValue });
  }
}
