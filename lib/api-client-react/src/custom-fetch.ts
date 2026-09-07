export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;
export type UnauthenticatedHandler = () => void | Promise<void>;
export type DeactivatedHandler = () => void | Promise<void>;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _authTokenForceRefresher: AuthTokenGetter | null = null;
let _unauthenticatedHandler: UnauthenticatedHandler | null = null;
let _deactivatedHandler: DeactivatedHandler | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Register a getter that force-refreshes the auth token, bypassing any client
 * cache (e.g. Clerk's `getToken({ skipCache: true })`). When configured, a 401
 * response triggers ONE transparent retry with a freshly minted token before
 * the error is surfaced. This self-heals stale-token windows caused by device
 * clock skew or throttled background tabs, where the cached token is served
 * past its expiry.
 *
 * Pass `null` to clear the refresher.
 */
export function setAuthTokenForceRefresher(getter: AuthTokenGetter | null): void {
  _authTokenForceRefresher = getter;
}

/**
 * Register a callback that is invoked whenever any API request receives a
 * 401 Unauthorized response.  Use this to handle expired sessions globally —
 * for example, clearing stored credentials and redirecting to the login screen.
 *
 * Pass `null` to remove a previously registered handler.
 */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null): void {
  _unauthenticatedHandler = handler;
}

/**
 * Register a callback that is invoked whenever any API request receives a
 * 403 Forbidden response whose body marks the account as deactivated
 * (`{ error: "Account deactivated" }`).  Use this to route a live session to a
 * deactivation screen when an admin revokes access mid-session.
 *
 * Only the deactivation 403 triggers this handler — ordinary permission 403s
 * (e.g. "Requires permission: …") do not, so a user who merely lacks access to
 * one resource is never wrongly flagged as deactivated.
 *
 * Pass `null` to remove a previously registered handler.
 */
export function setDeactivatedHandler(handler: DeactivatedHandler | null): void {
  _deactivatedHandler = handler;
}

// The deactivation 403 is distinguished from ordinary permission 403s by its
// body. Mirrors the server guard in requireAuth, which writes
// `{ error: "Account deactivated" }` for a soft-deactivated member.
function isDeactivatedError(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).error === "Account deactivated"
  );
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  let injectedAuth = false;
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
      injectedAuth = true;
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  let response = await fetch(input, { ...init, method, headers });

  // A 304 Not Modified means the browser's HTTP cache held a validator
  // (ETag/Last-Modified) and the server confirmed the cached copy is still
  // fresh — but this fetch layer has no body to fall back on (react-query is
  // our cache, not the browser's HTTP cache). Left alone, the 304 falls through
  // to the `!response.ok` branch below and is thrown as an ApiError, which
  // surfaces as "data not loading" on revalidation. Re-fetch once with the HTTP
  // cache bypassed so we always materialize a real 200 body. `cache: "reload"`
  // skips the conditional request, so there is no 304→304 loop. (React Native
  // never reaches here — it does not do HTTP-cache revalidation.)
  if (response.status === 304) {
    response = await fetch(input, { ...init, method, headers, cache: "reload" });
  }

  // Stale-token self-heal: a 401 with a force-refresher configured gets ONE
  // retry with a freshly minted token (bypassing the client token cache).
  // Covers device clock skew / throttled tabs serving a just-expired token.
  // Only applies when THIS layer injected the bearer token (never overrides a
  // caller-supplied Authorization header) and the request body is replayable
  // (streams and body-bearing Request inputs are consumed by the first fetch).
  const bodyReplayable =
    !(typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream) &&
    !(isRequest(input) && input.bodyUsed);
  if (response.status === 401 && _authTokenForceRefresher && injectedAuth && bodyReplayable) {
    try {
      const fresh = await _authTokenForceRefresher();
      if (fresh) {
        headers.set("authorization", `Bearer ${fresh}`);
        response = await fetch(input, { ...init, method, headers });
        if (response.status === 304) {
          response = await fetch(input, { ...init, method, headers, cache: "reload" });
        }
      }
    } catch {
      // Fall through and surface the original 401 below.
    }
  }

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    const error = new ApiError(response, errorData, requestInfo);
    if (response.status === 401 && _unauthenticatedHandler) {
      try {
        await _unauthenticatedHandler();
      } catch {
        // Swallow handler errors so the original 401 ApiError is always thrown
      }
    } else if (
      response.status === 403 &&
      _deactivatedHandler &&
      isDeactivatedError(errorData)
    ) {
      try {
        await _deactivatedHandler();
      } catch {
        // Swallow handler errors so the original 403 ApiError is always thrown
      }
    }
    throw error;
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
