// Standing transfer-portal watch alerts (usage-billed monthly per alert).

import type { Magisterial } from "../client.js";
import type {
  AlertDeleteResponse,
  AlertListResponse,
  AlertMatchListResponse,
  AlertSummary,
} from "../types.js";

export interface AlertCreateParams {
  name: string;
  sport: string;
  division: string;
  /** Filter DSL; see GET /v1/filters/catalog and the docs. */
  filters: Record<string, unknown>;
  gender?: string;
  /** HTTPS endpoint for match notifications (delivery coming soon). */
  webhook_url?: string;
  enabled?: boolean;
}

export class Alerts {
  constructor(private client: Magisterial) {}

  /** Create a portal watch. Billed per active alert per calendar month,
   * charged at creation; deleting within the month does not refund. */
  create(params: AlertCreateParams): Promise<AlertSummary> {
    return this.client.request("POST", "/v1/alerts", { body: params });
  }

  /** Every alert created through the API for this account. */
  list(): Promise<AlertListResponse> {
    return this.client.get("/v1/alerts");
  }

  /** Delete an alert (no refund for the current month). */
  delete(alertId: string): Promise<AlertDeleteResponse> {
    return this.client.request("DELETE", `/v1/alerts/${alertId}`);
  }

  /** Recent portal entries that matched an alert (poll this until webhook
   * delivery ships). */
  matches(
    alertId: string,
    params: { limit?: number } = {},
  ): Promise<AlertMatchListResponse> {
    return this.client.get(`/v1/alerts/${alertId}/matches`, { ...params });
  }
}
