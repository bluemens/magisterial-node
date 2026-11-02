// Sandbox: synthetic events to exercise your alert and webhook handling.

import type { Magisterial } from "../client.js";
import type { SandboxEventRequest, SandboxEventResponse } from "../types.js";

export type SandboxEventParams = SandboxEventRequest;

export class Sandbox {
  constructor(private client: Magisterial) {}

  /** Create a synthetic event. Not retried automatically: each accepted
   * request creates an event and its deliveries. */
  createEvent(params: SandboxEventParams): Promise<SandboxEventResponse> {
    return this.client.request("POST", "/v1/sandbox/events", { body: params });
  }
}
