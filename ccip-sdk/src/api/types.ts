/**
 * Response from GET /v1/lanes/latency endpoint.
 * Returns only the latency value - caller already knows source/dest chains.
 */
export type LaneLatencyResponse = {
  /** Estimated delivery time in milliseconds */
  totalMs: number
}

/** Raw API response (string selectors, before conversion) */
export type RawLaneLatencyResponse = {
  lane: {
    sourceNetworkInfo: {
      name: string
      chainSelector: string
      chainId: string
      chainFamily: string
    }
    destNetworkInfo: {
      name: string
      chainSelector: string
      chainId: string
      chainFamily: string
    }
    routerAddress: string
  }
  totalMs: number
}

/**
 * API error response structure from CCIP API.
 * Returned when API requests fail with 4xx/5xx status codes.
 */
export type APIErrorResponse = {
  /** Machine-readable error code (e.g., "LANE_NOT_FOUND", "INVALID_PARAMETERS") */
  error: string
  /** Human-readable error message with details */
  message: string
}
