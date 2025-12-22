/** Common HTTP status codes used in CCIP SDK. */
export const HttpStatus = {
  // Success
  OK: 200,

  // Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,

  // Server Errors
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

/** Union type of HTTP status codes. */
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus]

/** Returns true if status code indicates a server error (5xx). */
export function isServerError(status: number): boolean {
  return status >= HttpStatus.INTERNAL_SERVER_ERROR && status < 600
}

/** Returns true if status code indicates a transient error (429 or 5xx). */
export function isTransientHttpStatus(status: number): boolean {
  return status === HttpStatus.TOO_MANY_REQUESTS || isServerError(status)
}
