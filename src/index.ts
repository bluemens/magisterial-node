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

export type { PlayerSearchParams, ScopeParams } from "./resources/players.js";
export type { TeamListParams, RosterParams } from "./resources/teams.js";
export type { PortalListParams } from "./resources/portal.js";
export type { QueryCreateParams, PollOptions } from "./resources/query.js";
export type { AlertCreateParams } from "./resources/alerts.js";
export type { GameListParams } from "./resources/games.js";
export type { MovementListParams } from "./resources/movements.js";
export type { ExportCreateParams, ExportPollOptions } from "./resources/exports.js";

import { Magisterial } from "./client.js";
export default Magisterial;
