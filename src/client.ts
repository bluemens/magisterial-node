// The Magisterial client: auth, transport, retries, and the resource tree.
// Zero runtime dependencies — built on the Node 18+ / browser global fetch.

import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  MagisterialError,
  errorFromResponse,
} from "./error.js";
import { Alerts } from "./resources/alerts.js";
import { Games } from "./resources/games.js";
import { Persons } from "./resources/persons.js";
import { Players } from "./resources/players.js";
import { Portal } from "./resources/portal.js";
import { Query } from "./resources/query.js";
import { Reference } from "./resources/reference.js";
import { Teams } from "./resources/teams.js";
import { VERSION } from "./version.js";

export interface ClientOptions {
  /** API key (`mag_live_...` / `mag_test_...`). Defaults to MAGISTERIAL_API_KEY. */
  apiKey?: string;
  /** Defaults to MAGISTERIAL_BASE_URL, then https://api.magisterial.ai */
  baseURL?: string;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeout?: number;
  /** Automatic retries for idempotent requests on 429/5xx. Default 2. */
  maxRetries?: number;
  /** Custom fetch implementation (testing, polyfills). */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Override the default retry policy (GET/DELETE retry, POST doesn't). */
  retryable?: boolean;
}

const DEFAULT_BASE_URL = "https://api.magisterial.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const IDEMPOTENT_METHODS = new Set(["GET", "DELETE"]);

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export class Magisterial {
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: number;

  readonly reference: Reference;
  readonly players: Players;
  readonly teams: Teams;
  readonly persons: Persons;
  readonly games: Games;
  readonly portal: Portal;
  readonly query: Query;
  readonly alerts: Alerts;

  #apiKey: string;
  #fetch: typeof globalThis.fetch;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? env("MAGISTERIAL_API_KEY");
    if (!apiKey) {
      throw new MagisterialError(
        "No API key provided. Pass { apiKey } or set the MAGISTERIAL_API_KEY " +
          "environment variable. Create keys at https://magisterial.ai/console/api-keys",
      );
    }
    this.#apiKey = apiKey;
    this.baseURL = (
      options.baseURL ??
      env("MAGISTERIAL_BASE_URL") ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#fetch = options.fetch ?? globalThis.fetch;

    this.reference = new Reference(this);
    this.players = new Players(this);
    this.teams = new Teams(this);
    this.persons = new Persons(this);
    this.games = new Games(this);
    this.portal = new Portal(this);
    this.query = new Query(this);
    this.alerts = new Alerts(this);
  }

  /** Perform a request and return decoded JSON, retrying 429/5xx and network
   * failures for idempotent (or explicitly retryable) calls. */
  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.baseURL + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const canRetry = options.retryable ?? IDEMPOTENT_METHODS.has(method);
    const attempts = canRetry ? this.maxRetries + 1 : 1;
    let lastError: Error = new APIConnectionError();

    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await this.#fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            Accept: "application/json",
            "User-Agent": `magisterial-node/${VERSION}`,
            ...(options.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (cause) {
        lastError =
          cause instanceof Error && cause.name === "TimeoutError"
            ? new APITimeoutError()
            : new APIConnectionError(
                cause instanceof Error ? cause.message : "Connection error.",
                { cause },
              );
      }

      if (response) {
        if (response.ok) {
          return (await response.json()) as T;
        }
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // non-JSON error body; the status alone carries the message
        }
        lastError = errorFromResponse(response.status, body, response.headers);
        const retryableStatus = response.status === 429 || response.status >= 500;
        if (!(attempt < attempts - 1 && retryableStatus)) throw lastError;
      } else if (attempt >= attempts - 1) {
        throw lastError;
      }

      await this._sleep(this.#retryDelayMs(lastError, attempt));
    }

    throw lastError; // unreachable, defensive
  }

  #retryDelayMs(error: Error, attempt: number): number {
    if (error instanceof APIStatusError && error.retryAfter !== undefined) {
      return Math.max(0, error.retryAfter * 1000);
    }
    // Exponential backoff with jitter: ~0.5s, ~1s, ~2s ...
    return 500 * 2 ** attempt * (1 + Math.random() * 0.25);
  }

  /** Exposed for resources and tests; production sleeps for real. */
  async _sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  get<T = unknown>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>("GET", path, { query });
  }
}
