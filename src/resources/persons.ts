// Persons: cross-program careers and transfer histories.

import type { Magisterial } from "../client.js";
import type { PlayerDetail, TransferListResponse } from "../types.js";

export class Persons {
  constructor(private client: Magisterial) {}

  /** A person's career across every program/division in one sport. */
  get(
    personId: number,
    params: { sport: string; gender?: string },
  ): Promise<PlayerDetail> {
    return this.client.get(`/v1/persons/${personId}`, { ...params });
  }

  /** Every school-change edge for a person, across divisions. */
  transfers(personId: number): Promise<TransferListResponse> {
    return this.client.get(`/v1/persons/${personId}/transfers`);
  }
}
