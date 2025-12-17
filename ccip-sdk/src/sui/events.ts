import type { SuiClient, SuiEventFilter } from '@mysten/sui/client'
import type { SuiGraphQLClient } from '@mysten/sui/graphql'

export type CommitEvent = {
  unblessed_merkle_roots: {
    max_seq_nr: string
    merkle_root: string
    min_seq_nr: string
    on_ramp_address: string
    source_chain_selector: string
  }[]
}

async function getTransactionDigestsInTimeRange(
  client: SuiClient,
  startTime: Date,
  endTime: Date,
): Promise<{ firstDigest: string; lastDigest: string } | null> {
  const filter: SuiEventFilter = {
    TimeRange: {
      startTime: startTime.getTime().toString(),
      endTime: endTime.getTime().toString(),
    },
  }

  // Get first event (ascending order)
  const firstEvents = await client.queryEvents({
    query: filter,
    limit: 1,
    order: 'ascending',
  })

  if (!firstEvents.data || firstEvents.data.length === 0) {
    return null
  }

  const firstDigest = firstEvents.data[0].id.txDigest

  // Get last event (descending order)
  const lastEvents = await client.queryEvents({
    query: filter,
    limit: 1,
    order: 'descending',
  })

  const lastDigest = lastEvents.data[0].id.txDigest

  return { firstDigest, lastDigest }
}

type TransactionCheckpointResponse = {
  first: {
    digest: string
    effects: {
      checkpoint: {
        sequenceNumber: string
      }
    }
  } | null
  last: {
    digest: string
    effects: {
      checkpoint: {
        sequenceNumber: string
      }
    }
  } | null
}

type LatestCheckpointResponse = {
  checkpoints: {
    nodes: Array<{
      sequenceNumber: string
    }>
  }
}

async function getCheckpointsFromTransactions(
  graphqlClient: SuiGraphQLClient,
  firstDigest: string,
  lastDigest: string,
): Promise<{ startCheckpoint: number; endCheckpoint: number }> {
  const query = `
    query GetTransactionCheckpoints($firstDigest: String!, $lastDigest: String!) {
      first: transaction(digest: $firstDigest) {
        digest
        effects {
          checkpoint {
            sequenceNumber
          }
        }
      }
      last: transaction(digest: $lastDigest) {
        digest
        effects {
          checkpoint {
            sequenceNumber
          }
        }
      }
    }
  `

  const result = await graphqlClient.query<TransactionCheckpointResponse>({
    query,
    variables: {
      firstDigest,
      lastDigest,
    },
  })

  if (result.errors) {
    throw new Error(
      `Error fetching transaction checkpoints: ${JSON.stringify(result.errors, null, 2)}`,
    )
  }

  if (!result.data?.first) {
    throw new Error('First transaction not found in GraphQL response')
  }

  const startCheckpoint = parseInt(result.data.first.effects.checkpoint.sequenceNumber)

  // If the last transaction is not found (too recent), use current checkpoint
  let endCheckpoint: number
  if (!result.data.last) {
    const latestCheckpointQuery = `
      query GetLatestCheckpoint {
        checkpoints(last: 1) {
          nodes {
            sequenceNumber
          }
        }
      }
    `
    const latestResult = await graphqlClient.query<LatestCheckpointResponse>({
      query: latestCheckpointQuery,
      variables: {},
    })
    if (!latestResult.data) {
      throw new Error('Failed to fetch latest checkpoint')
    }
    endCheckpoint = parseInt(latestResult.data.checkpoints.nodes[0].sequenceNumber)
  } else {
    endCheckpoint = parseInt(result.data.last.effects.checkpoint.sequenceNumber)
  }

  return { startCheckpoint, endCheckpoint }
}

type EventNode<T = unknown> = {
  timestamp: string
  contents: {
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

type GraphQLEventNode = {
  sender: {
    address: string
  }
  timestamp: string
  contents?: {
    json: unknown
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

type EventsQueryResponse = {
  events: {
    nodes: GraphQLEventNode[]
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
  }
}

async function fetchEventsWithCheckpointRange<T>(
  graphqlClient: SuiGraphQLClient,
  type: string,
  startCheckpoint: number,
  endCheckpoint: number,
): Promise<EventNode<T>[]> {
  const allEvents: EventNode<T>[] = []
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
          first: 50
        ) {
          nodes {
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

    const result = await graphqlClient.query<EventsQueryResponse>({
      query,
      variables: {
        type,
        after: cursor,
        afterCheckpoint: startCheckpoint,
        beforeCheckpoint: endCheckpoint + 1, // beforeCheckpoint is exclusive
      },
    })

    // eslint-disable-next-line
    if ((result as any)?.errors) {
      // eslint-disable-next-line
      throw new Error(`GraphQL errors: ${JSON.stringify((result as any).errors, null, 2)}`)
    }

    // eslint-disable-next-line
    if (!(result as any).data) {
      throw new Error('No data returned from GraphQL query')
    }

    // eslint-disable-next-line
    const { nodes, pageInfo } = (result as any).data.events as {
      nodes: GraphQLEventNode[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }

    for (const node of nodes) {
      allEvents.push({
        timestamp: node.timestamp,
        contents: {
          json: (node.contents?.json || node) as T,
        },
        transaction: node.transaction,
      })
    }

    hasNextPage = pageInfo.hasNextPage
    cursor = pageInfo.endCursor ?? undefined

    if (!hasNextPage) {
      break
    }
  }

  return allEvents
}

/**
 * Sui RPC does not support querying events by time range and event type
 * Sui GraphQL does not support querying events by time range directly, but does with checkpoints
 * This function combines both to get events of a specific type within a time range
 */
export async function getSuiEventsInTimeRange<T>(
  client: SuiClient,
  graphqlClient: SuiGraphQLClient,
  type: string,
  startTime: Date,
  endTime: Date,
): Promise<EventNode<T>[]> {
  const digests = await getTransactionDigestsInTimeRange(client, startTime, endTime)
  if (!digests) {
    return []
  }

  const checkpoints = await getCheckpointsFromTransactions(
    graphqlClient,
    digests.firstDigest,
    digests.lastDigest,
  )

  const events = await fetchEventsWithCheckpointRange<T>(
    graphqlClient,
    type,
    checkpoints.startCheckpoint,
    checkpoints.endCheckpoint,
  )

  return events
}
