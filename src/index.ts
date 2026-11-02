// Magisterial — official TypeScript/JavaScript SDK for the Magisterial developer API.
// Docs: https://api.magisterial.ai/v1/docs   Spec: https://api.magisterial.ai/v1/openapi.json

export { Magisterial } from "./client.js";
export type { ClientOptions, RequestOptions } from "./client.js";
export { Page } from "./pagination.js";
export {
  MagisterialError,
  APIConnectionError,
  APITimeoutError,
  APIStatusError,
  BadRequestError,
  AuthenticationError,
  BillingError,
  PermissionDeniedError,
  NotFoundError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  QueryPollTimeout,
  ExportPollTimeout,
} from "./error.js";
export { VERSION } from "./version.js";
export * as types from "./types.js";

export type { PlayerSearchParams, ScopeParams, SwimTimesParams } from "./resources/players.js";
export type {
  TeamListParams,
  RosterParams,
  TeamPostseasonParams,
  TeamRankingsParams,
  TeamSeasonScopeParams,
} from "./resources/teams.js";
export type { PortalListParams } from "./resources/portal.js";
export type {
  PortalSupplyListParams,
  PortalSupplyChangesParams,
} from "./resources/portal_supply.js";
export type { QueryCreateParams, PollOptions } from "./resources/query.js";
export type { AlertCreateParams } from "./resources/alerts.js";
export type { GameListParams } from "./resources/games.js";
export type { MovementListParams, MovementChangesParams } from "./resources/movements.js";
export type { ExportCreateParams, ExportPollOptions } from "./resources/exports.js";
export type { SchoolListParams } from "./resources/schools.js";
export type {
  CommitmentListParams,
  CommitmentChangesParams,
} from "./resources/commitments.js";
export type {
  GolfTournamentListParams,
  GolfRatingListParams,
} from "./resources/golf.js";
export type {
  SwimMeetListParams,
  SwimMeetResultsParams,
} from "./resources/swim.js";
export type {
  TennisMatchListParams,
  ItaRankingListParams,
} from "./resources/tennis.js";
export type { SandboxEventParams } from "./resources/sandbox.js";
export type {
  ManagedAthleteCreateParams,
  ManagedAthleteListParams,
  ManagedAthleteAccessListParams,
} from "./resources/athletes.js";

import { Magisterial } from "./client.js";
export default Magisterial;
