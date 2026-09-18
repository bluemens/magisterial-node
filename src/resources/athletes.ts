// Managed athletes (Enterprise): invite athletes to authorize your account,
// then read coach-contact fields on their behalf via `on_behalf_of`.

import type { Magisterial } from "../client.js";
import { Page, pageFromRaw } from "../pagination.js";
import type {
  ManagedAthleteAccessEntry,
  ManagedAthleteAccessPage,
  ManagedAthleteEntry,
  ManagedAthletePage,
  ManagedAthleteRevokeResponse,
} from "../types.js";

export interface ManagedAthleteCreateParams {
  /** The athlete's player id (GET /v1/players/search). */
  player_id: number;
  /** Where to send the invitation. Optional: defaults to the athlete's
   * on-file contact. A supplied address is accepted only when it matches
   * that contact or the athlete's school .edu domain. */
  email?: string;
  /** The athlete's sport path, e.g. 'womens-soccer'. Speeds up the lookup. */
  sport_path?: string;
  /** How your platform is named in the invitation email. */
  organization_name?: string;
}

export interface ManagedAthleteListParams {
  /** Filter: invited | active | declined | revoked | expired. */
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface ManagedAthleteAccessListParams {
  limit?: number;
  cursor?: string;
}

export class Athletes {
  constructor(private client: Magisterial) {}

  /** Invite one athlete to authorize your account. The grant starts as
   * `invited` and becomes `active` when the athlete accepts; re-inviting a
   * declined, revoked, or expired athlete reuses the same grant id.
   * Not retried automatically. */
  create(params: ManagedAthleteCreateParams): Promise<ManagedAthleteEntry> {
    return this.client.request("POST", "/v1/athletes", { body: params });
  }

  /** Every athlete who has been invited to, or has authorized, your
   * account, newest first. `active` grants are the ones `on_behalf_of`
   * accepts. */
  async list(
    params: ManagedAthleteListParams = {},
  ): Promise<Page<ManagedAthleteEntry>> {
    const fetch = async (
      query: ManagedAthleteListParams,
    ): Promise<Page<ManagedAthleteEntry>> => {
      const raw = await this.client.request<ManagedAthletePage>(
        "GET",
        "/v1/athletes",
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }

  /** One grant by id, including its current status and timestamps. */
  get(grantId: string): Promise<ManagedAthleteEntry> {
    return this.client.get(`/v1/athletes/${grantId}`);
  }

  /** Issue a fresh 14-day invitation link to the same address. Only
   * `invited` grants can be resent; re-invite a declined, revoked, or
   * expired athlete with `create` instead. Not retried automatically. */
  resendInvite(grantId: string): Promise<ManagedAthleteEntry> {
    return this.client.request("POST", `/v1/athletes/${grantId}/resend`);
  }

  /** End the authorization (or cancel a pending invitation). Delegated
   * reads for the athlete fail from the next request; the grant stays
   * listed as `revoked` for your records. */
  revoke(grantId: string): Promise<ManagedAthleteRevokeResponse> {
    return this.client.request("DELETE", `/v1/athletes/${grantId}`);
  }

  /** Audit log of delegated reads for one athlete, newest first. */
  async listAccess(
    grantId: string,
    params: ManagedAthleteAccessListParams = {},
  ): Promise<Page<ManagedAthleteAccessEntry>> {
    const fetch = async (
      query: ManagedAthleteAccessListParams,
    ): Promise<Page<ManagedAthleteAccessEntry>> => {
      const raw = await this.client.request<ManagedAthleteAccessPage>(
        "GET",
        `/v1/athletes/${grantId}/access`,
        { query: { ...query } },
      );
      return pageFromRaw(raw, (cursor) => fetch({ ...query, cursor }));
    };
    return fetch(params);
  }
}
