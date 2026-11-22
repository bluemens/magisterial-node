// Recruit fit: score a soccer athlete against every program.

import type { Magisterial } from "../client.js";
import type { RecruitFitPage, RecruitFitRequest } from "../types.js";

export type RecruitFitScoreParams = RecruitFitRequest;

export class RecruitFit {
  constructor(private readonly client: Magisterial) {}

  /** Programs in rank order for one athlete's answers. Takes no name or other
   * identity. `fit` measures how a program recruits and whether it has room,
   * not how good a player is. Pass `next_cursor` as `cursor` for the next
   * page. Soccer only; Developer Pro and up. */
  score(params: RecruitFitScoreParams): Promise<RecruitFitPage> {
    // POST, but a pure read: safe to retry.
    return this.client.request<RecruitFitPage>("POST", "/v1/recruit/fit", {
      body: params,
      retryable: true,
    });
  }
}
