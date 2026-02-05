import type { SuiClient, SuiEventFilter } from '@mysten/sui/client'
import type { GraphQLQueryResult, SuiGraphQLClient } from '@mysten/sui/graphql'

import type { LogFilter } from '../chain.ts'
import {
  CCIPDataFormatUnsupportedError,
  CCIPLogsWatchRequiresFinalityError,
  CCIPLogsWatchRequiresStartError,
  CCIPTopicsInvalidError,
} from '../errors/index.ts'
import { sleep } from '../utils.ts'

type MerkleRoot = {
  max_seq_nr: string
  merkle_root: string
  min_seq_nr: string
  on_ramp_address: string
  source_chain_selector: string
}

/**
 * Commit event data structure from Sui blockchain.
 */
export type CommitEvent = {
  blessed_merkle_roots: MerkleRoot[]
  unblessed_merkle_roots: MerkleRoot[]
}

async function getCheckpointRightBefore(
  client: SuiClient,
  startTime: number,
): Promise<number | undefined> {
  const filter: SuiEventFilter = {
    TimeRange: {
      startTime: '0',
      endTime: (startTime * 1000).toString(),
    },
  }

  // Get first event (ascending order)
  const firstEvents = await client.queryEvents({
    query: filter,
    limit: 1,
    order: 'descending',
  })

  if (!firstEvents.data.length) return

  const tx = await client.getTransactionBlock({
    digest: firstEvents.data[0]!.id.txDigest,
  })
  if (tx.checkpoint) return Number(tx.checkpoint)
}

type LatestCheckpointResponse = {
  checkpoints: {
    nodes: Array<{
      sequenceNumber: string
    }>
  }
}

type EventNode<T = unknown> = {
  sequenceNumber: string
  sender: {
    address: string
  }
  timestamp: string
  contents?: {
    json: T
  }
  transaction?: {
    effects: {
      checkpoint: {
        sequenceNumber: number
      }
    }
    digest: string
  }
}

type EventsQueryResponse<T = unknown> = {
  events: {
    nodes: EventNode<T>[]
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
  }
}

/**
 * Gets the latest checkpoint from the Sui GraphQL client.
 */
async function getLatestCheckpoint(graphqlClient: SuiGraphQLClient): Promise<number> {
  const query = `
    query GetLatestCheckpoint {
      checkpoints(last: 1) {
        nodes {
          sequenceNumber
        }
      }
    }
  `
  const result = await graphqlClient.query<LatestCheckpointResponse>({
    query,
    variables: {},
  })
  if (!result.data) {
    throw new CCIPDataFormatUnsupportedError('Failed to fetch latest checkpoint')
  }
  return parseInt(result.data.checkpoints.nodes[0]!.sequenceNumber)
}

/**
 * Fetches events in forward direction (ascending checkpoint order).
 */
async function* fetchEventsForward<T>(
  ctx: { client: SuiClient; graphqlClient: SuiGraphQLClient },
  opts: LogFilter & { pollInterval?: number },
  type: string,
  limit = 50,
): AsyncGenerator<EventNode<T>> {
  const DEFAULT_POLL_INTERVAL = 5e3

  if (opts.watch && typeof opts.endBlock === 'number' && opts.endBlock > 0)
    throw new CCIPLogsWatchRequiresFinalityError(opts.endBlock)

  // Determine starting checkpoint
  let startCheckpoint
  if (opts.startBlock) startCheckpoint = opts.startBlock
  if (opts.startTime) {
    // Use getTransactionDigestsInTimeRange to find the checkpoint for startTime
    // Use a small time window to find transactions near startTime
    const startCheckpoint_ = await getCheckpointRightBefore(ctx.client, opts.startTime)
    if (startCheckpoint_) {
      if (startCheckpoint) startCheckpoint = Math.max(startCheckpoint, startCheckpoint_)
      else startCheckpoint = startCheckpoint_
    }
  }
  if (!startCheckpoint) throw new CCIPLogsWatchRequiresStartError()

  // Determine ending checkpoint
  let endCheckpoint: number | undefined
  if (typeof opts.endBlock === 'number') {
    if (opts.endBlock < 0) {
      // Negative means relative to latest
      endCheckpoint = (await getLatestCheckpoint(ctx.graphqlClient)) + opts.endBlock
    } else {
      endCheckpoint = opts.endBlock
    }
  }

  let currentCheckpoint = startCheckpoint
  let catchedUp = false

  while (opts.watch || !catchedUp) {
    const lastReq = performance.now()

    // Determine the range for this batch
    let batchEndCheckpoint: number
    if (endCheckpoint !== undefined && !opts.watch) {
      batchEndCheckpoint = endCheckpoint
    } else {
      batchEndCheckpoint = await getLatestCheckpoint(ctx.graphqlClient)
      if (endCheckpoint !== undefined) {
        batchEndCheckpoint = Math.min(batchEndCheckpoint, endCheckpoint)
      }
    }

    // Fetch events for this checkpoint range
    if (currentCheckpoint <= batchEndCheckpoint) {
      let cursor: string | undefined = undefined
      let hasNextPage = true

      while (hasNextPage) {
        const query = `
          query FetchEvents($type: String!, $after: String, $afterCheckpoint: UInt53!, $beforeCheckpoint: UInt53!) {
            events(
              filter: {
                type: $type
                afterCheckpoint: $afterCheckpoint
                beforeCheckpoint: $beforeCheckpoint
              }
              after: $after
              first: ${limit}
            ) {
              nodes {
                sequenceNumber
                sender {
                  address
                }
                timestamp
                contents {
                  json
                }
                transaction {
                  effects {
                    checkpoint {
                      sequenceNumber
                    }
                  }
                  digest
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `

        const result: GraphQLQueryResult<EventsQueryResponse<T>> = await ctx.graphqlClient.query<
          EventsQueryResponse<T>
        >({
          query,
          variables: {
            type,
            after: cursor,
            afterCheckpoint: currentCheckpoint,
            beforeCheckpoint: batchEndCheckpoint + 1, // beforeCheckpoint is exclusive
          },
        })

        if (result.errors) {
          throw new CCIPDataFormatUnsupportedError(
            `GraphQL errors: ${JSON.stringify(result.errors, null, 2)}`,
          )
        }

        if (!result.data) {
          throw new CCIPDataFormatUnsupportedError('No data returned from GraphQL query')
        }

        const { nodes, pageInfo } = result.data.events

        for (const node of nodes) {
          // Filter by startTime if provided (timestamp is in ISO format)
          if (opts.startTime) {
            const eventTime = new Date(node.timestamp).getTime() / 1000 // Convert to seconds
            if (eventTime < opts.startTime) continue
          }

          // Check endBlock constraint
          if (endCheckpoint !== undefined && node.transaction) {
            const checkpoint = node.transaction.effects.checkpoint.sequenceNumber
            if (checkpoint > endCheckpoint) {
              catchedUp = true
              break
            }
          }

          yield node
        }

        hasNextPage = pageInfo.hasNextPage && !catchedUp
        cursor = pageInfo.endCursor ?? undefined
      }

      currentCheckpoint = batchEndCheckpoint + 1
    }

    catchedUp ||= currentCheckpoint > batchEndCheckpoint

    if (opts.watch && catchedUp) {
      let break$ = sleep(
        Math.max((opts.pollInterval || DEFAULT_POLL_INTERVAL) - (performance.now() - lastReq), 1),
      ).then(() => false)
      if (opts.watch instanceof Promise)
        break$ = Promise.race([break$, opts.watch.then(() => true)])
      if (await break$) break
    }
  }
}

/**
 * Fetches events in backward direction (descending checkpoint order).
 */
async function* fetchEventsBackward<T>(
  ctx: { client: SuiClient; graphqlClient: SuiGraphQLClient },
  opts: LogFilter,
  type: string,
  limit = 50,
): AsyncGenerator<EventNode<T>> {
  // Determine ending checkpoint (where to stop going backwards)
  let endCheckpoint: number | undefined
  if (typeof opts.endBlock === 'number') {
    if (opts.endBlock < 0) {
      endCheckpoint = (await getLatestCheckpoint(ctx.graphqlClient)) + opts.endBlock
    } else {
      endCheckpoint = opts.endBlock
    }
  }

  // Start from the latest checkpoint and go backwards
  const latestCheckpoint = await getLatestCheckpoint(ctx.graphqlClient)
  let currentCheckpoint = latestCheckpoint

  const allEvents: EventNode<T>[] = []

  // Fetch all events going backwards
  while (currentCheckpoint >= 0) {
    let cursor: string | undefined = undefined
    let hasNextPage = true

    const minCheckpoint = endCheckpoint !== undefined ? endCheckpoint : 0

    while (hasNextPage) {
      const query = `
        query FetchEvents($type: String!, $after: String, $afterCheckpoint: UInt53!, $beforeCheckpoint: UInt53!) {
          events(
            filter: {
              type: $type
              afterCheckpoint: $afterCheckpoint
              beforeCheckpoint: $beforeCheckpoint
            }
            after: $after
            last: ${limit}
          ) {
            nodes {
              sequenceNumber
              sender {
                address
              }
              timestamp
              contents {
                json
              }
              transaction {
                effects {
                  checkpoint {
                    sequenceNumber
                  }
                }
                digest
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `

      const batchStartCheckpoint = Math.max(currentCheckpoint - 1000, minCheckpoint)

      const result: { data?: EventsQueryResponse; errors?: unknown } =
        await ctx.graphqlClient.query<EventsQueryResponse>({
          query,
          variables: {
            type,
            after: cursor,
            afterCheckpoint: batchStartCheckpoint,
            beforeCheckpoint: currentCheckpoint + 1,
          },
        })

      if (result.errors) {
        throw new CCIPDataFormatUnsupportedError(
          `GraphQL errors: ${JSON.stringify(result.errors, null, 2)}`,
        )
      }

      if (!result.data) {
        throw new CCIPDataFormatUnsupportedError('No data returned from GraphQL query')
      }

      const { nodes, pageInfo } = result.data.events

      if (!nodes.length) {
        hasNextPage = false
        break
      }

      for (const node of nodes) {
        allEvents.push(node as EventNode<T>)
      }

      hasNextPage = pageInfo.hasNextPage
      cursor = pageInfo.endCursor ?? undefined
    }

    currentCheckpoint = Math.max(currentCheckpoint - 1000, minCheckpoint) - 1
    if (currentCheckpoint < minCheckpoint) break
  }

  // Yield events in descending order (most recent first)
  for (const event of allEvents.reverse()) {
    // Filter out events after endBlock if specified
    if (endCheckpoint !== undefined && event.transaction) {
      const checkpoint = event.transaction.effects.checkpoint.sequenceNumber
      if (checkpoint > endCheckpoint) continue
    }
    yield event
  }
}

/**
 * Streams logs from the Sui blockchain based on filter options.
 * @param ctx - Context containing Sui client and grraphqlClient instances.
 * @param opts - Log filter options.
 * @returns Async generator of log entries.
 */
export async function* streamSuiLogs<T>(
  ctx: { client: SuiClient; graphqlClient: SuiGraphQLClient },
  opts: LogFilter,
): AsyncGenerator<EventNode<T>> {
  if (opts.topics?.length !== 1 || typeof opts.topics[0] !== 'string')
    throw new CCIPTopicsInvalidError(opts.topics!)

  // Construct full Sui event type: package_id::module_name::EventName
  // opts.address is in format: package_id::module_name
  // opts.topics[0] is the EventName
  const eventType = `${opts.address}::${opts.topics[0]}`

  // Forward mode: if startTime or startBlock are provided, or if watch is enabled
  if (opts.startBlock || opts.startTime || opts.watch) {
    if (opts.watch && !opts.startBlock && !opts.startTime) {
      throw new CCIPLogsWatchRequiresStartError()
    }
    yield* fetchEventsForward<T>(ctx, opts, eventType)
  } else {
    // Backward mode: paginate backwards until depleting events
    yield* fetchEventsBackward<T>(ctx, opts, eventType)
  }
}
