import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { bcs } from '@mysten/sui/bcs'

import {
  BcsCursor,
  decodeBcsMoveValue,
  dynamicFieldNameToBcs,
  eventFilterToNormalized,
  formatGrpcExecutionError,
  grpcArgumentToJsonRpc,
  grpcChainIdentifierToJsonRpc,
  grpcCheckpointToJsonRpc,
  grpcCommandToJsonRpc,
  grpcEventToJsonRpc,
  grpcInputToJsonRpc,
  grpcPackageToDisassembled,
  grpcSimulateToDevInspect,
  grpcTransactionToJsonRpc,
  transactionFilterToNormalized,
} from './grpc-shapes.ts'

describe('grpcChainIdentifierToJsonRpc', () => {
  it('derives the JSON-RPC 4-byte hex id from the base58 genesis digest', () => {
    // testnet's gRPC chain identifier (from the live endpoint)
    assert.equal(
      grpcChainIdentifierToJsonRpc('69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD'),
      '4c78adac',
    )
  })
})

describe('grpcCheckpointToJsonRpc', () => {
  it('maps summary timestamp + transaction digests', () => {
    const checkpoint = grpcCheckpointToJsonRpc({
      sequenceNumber: 396128600n,
      digest: '8muvSJdZi8rXJFJMBCNz5kY1GzM9UuJP9x53ReKAmZhS',
      summary: {
        epoch: 1256n,
        timestamp: { seconds: 1792279576n, nanos: 631000000 },
      },
      transactions: [{ digest: 'ARVReRf7JLb1cKMzzDGYAZpG87WtUie9dM3FBnW3gDTf' }, { digest: '' }],
    })
    assert.equal(checkpoint.sequenceNumber, '396128600')
    assert.equal(checkpoint.epoch, '1256')
    assert.equal(checkpoint.timestampMs, '1792279576631')
    assert.deepEqual(checkpoint.transactions, ['ARVReRf7JLb1cKMzzDGYAZpG87WtUie9dM3FBnW3gDTf'])
  })
})

describe('formatGrpcExecutionError', () => {
  it('rebuilds the JSON-RPC MoveAbort string the failure decoder parses', () => {
    // getSuiFailureData's regex must extract module address/name, function
    // index/instruction/function_name, and the abort code from this string
    const status = formatGrpcExecutionError({
      $kind: 'MoveAbort',
      command: 0,
      MoveAbort: {
        abortCode: '7',
        location: {
          package: '0x02498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0',
          module: 'managed_token',
          function: 12,
          instruction: 34,
          functionName: 'validate_mint',
        },
      },
    })
    assert.equal(
      status,
      'MoveAbort(MoveLocation { module: ModuleId { address: 0x02498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0, name: "managed_token" }, function: 12, instruction: 34, function_name: Some("validate_mint") }, 7)',
    )
  })

  it('falls back to the description for non-abort errors', () => {
    assert.equal(
      formatGrpcExecutionError({ $kind: 'Unknown', message: 'FunctionNotFound in command 0' }),
      'FunctionNotFound in command 0',
    )
  })

  it('formats the RAW proto error shape (abort/description fields)', () => {
    // the raw ledger service's ExecutionError: {description, command, kind,
    // abort: {abortCode: bigint, location}} — a failed getTransactionBlock's
    // effects.status.error must not degrade to 'Transaction failed'
    const status = formatGrpcExecutionError({
      description: 'aborted in command 0',
      command: 0,
      kind: 13,
      abort: {
        abortCode: 7n,
        location: {
          package: '0x02498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0',
          module: 'managed_token',
          function: 12,
          instruction: 34,
          functionName: 'validate_mint',
        },
      },
    } as never)
    assert.equal(
      status,
      'MoveAbort(MoveLocation { module: ModuleId { address: 0x02498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0, name: "managed_token" }, function: 12, instruction: 34, function_name: Some("validate_mint") }, 7)',
    )
    // non-abort raw errors carry their description
    assert.equal(
      formatGrpcExecutionError({ description: 'FunctionNotFound in command 0' } as never),
      'FunctionNotFound in command 0',
    )
  })
})

describe('grpcEventToJsonRpc', () => {
  it('maps the proto event fields to the SuiEvent shape', () => {
    const event = grpcEventToJsonRpc({
      packageId: '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d',
      module: 'onramp',
      sender: '0x53f9',
      eventType:
        '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp::CCIPMessageSent',
      json: { sequence_number: '942' },
      checkpoint: '394739543',
      transactionDigest: 'BrCjq8XjpmmFLmuNpW7tFK4L4sjyzWWSV1aEnXXWsfmR',
      eventIndex: 2,
    })
    assert.equal(event.id.txDigest, 'BrCjq8XjpmmFLmuNpW7tFK4L4sjyzWWSV1aEnXXWsfmR')
    assert.equal(event.id.eventSeq, '2')
    assert.equal(
      event.type,
      '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp::CCIPMessageSent',
    )
    assert.equal(
      event.packageId,
      '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d',
    )
    assert.deepEqual(event.parsedJson, { sequence_number: '942' })
  })
})

describe('grpcArgumentToJsonRpc / grpcInputToJsonRpc / grpcCommandToJsonRpc', () => {
  it('maps arguments', () => {
    assert.equal(grpcArgumentToJsonRpc({ $kind: 'GasCoin', GasCoin: true }), 'GasCoin')
    assert.deepEqual(grpcArgumentToJsonRpc({ $kind: 'Input', Input: 3 }), { Input: 3 })
    assert.deepEqual(grpcArgumentToJsonRpc({ $kind: 'Result', Result: 1 }), { Result: 1 })
    assert.deepEqual(grpcArgumentToJsonRpc({ $kind: 'NestedResult', NestedResult: [0, 0] }), {
      NestedResult: [0, 0],
    })
  })

  it('maps pure inputs to the JSON-RPC pure call-arg (hex value)', () => {
    const input = grpcInputToJsonRpc({ $kind: 'Pure', Pure: { bytes: 'cYExBgAAAAA=' } })
    assert.equal(input.type, 'pure')
    assert.equal(input.value, '0x7181310600000000')
  })

  it('maps object inputs (immOrOwned / shared / receiving)', () => {
    const owned = grpcInputToJsonRpc({
      $kind: 'Object',
      Object: {
        immutableOrOwned: { objectId: '0xb10e', version: '679834449', digest: '4igijrJr' },
      },
    })
    assert.deepEqual(owned, {
      type: 'object',
      objectType: 'immOrOwnedObject',
      objectId: '0xb10e',
      version: '679834449',
      digest: '4igijrJr',
    })
    const shared = grpcInputToJsonRpc({
      $kind: 'Object',
      Object: { shared: { objectId: '0xshare', initialSharedVersion: '5', mutable: true } },
    }) as { objectType: string; initialSharedVersion: string; mutable: boolean }
    assert.equal(shared.objectType, 'sharedObject')
    assert.equal(shared.initialSharedVersion, '5')
    assert.equal(shared.mutable, true)
  })

  it('maps the normalized layer’s TS-shaped object inputs (nested $kind variants)', () => {
    // listTransactions/getTransaction return Object inputs as
    // { $kind: 'ImmOrOwnedObject'|'SharedObject'|'Receiving', <kind>: {...} }
    const owned = grpcInputToJsonRpc({
      $kind: 'Object',
      Object: {
        $kind: 'ImmOrOwnedObject',
        ImmOrOwnedObject: { objectId: '0xb10e', version: '679834449', digest: '4igijrJr' },
      },
    } as never)
    assert.deepEqual(owned, {
      type: 'object',
      objectType: 'immOrOwnedObject',
      objectId: '0xb10e',
      version: '679834449',
      digest: '4igijrJr',
    })
    const shared = grpcInputToJsonRpc({
      $kind: 'Object',
      Object: {
        $kind: 'SharedObject',
        SharedObject: { objectId: '0xshare', initialSharedVersion: '5', mutable: true },
      },
    } as never) as { objectType: string; objectId: string; initialSharedVersion: string }
    assert.equal(shared.objectType, 'sharedObject')
    assert.equal(shared.objectId, '0xshare')
    assert.equal(shared.initialSharedVersion, '5')
    const receiving = grpcInputToJsonRpc({
      $kind: 'Object',
      Object: {
        $kind: 'Receiving',
        Receiving: { objectId: '0xrecv', version: '7', digest: 'd' },
      },
    } as never) as { objectType: string; objectId: string }
    assert.equal(receiving.objectType, 'receiving')
    assert.equal(receiving.objectId, '0xrecv')
  })

  it('maps a MoveCall command to the JSON-RPC PTB entry', () => {
    const command = grpcCommandToJsonRpc({
      $kind: 'MoveCall',
      MoveCall: {
        package: '0xfa4dc9ef',
        module: 'onramp',
        function: 'ccip_send',
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
          { $kind: 'Input', Input: 2 },
          { $kind: 'GasCoin', GasCoin: true },
        ],
      },
    } as never)
    assert.deepEqual(command, {
      MoveCall: {
        package: '0xfa4dc9ef',
        module: 'onramp',
        function: 'ccip_send',
        type_arguments: ['0x2::sui::SUI'],
        arguments: [{ Input: 2 }, 'GasCoin'],
      },
    })
  })

  it('accepts the normalized TS command field names (sources / type)', () => {
    // MergeCoins: the TS shape names the merge list `sources`
    const merge = grpcCommandToJsonRpc({
      $kind: 'MergeCoins',
      MergeCoins: {
        coin: { $kind: 'Input', Input: 0 },
        sources: [
          { $kind: 'Input', Input: 1 },
          { $kind: 'Input', Input: 2 },
        ],
      },
    } as never)
    assert.deepEqual(merge, {
      MergeCoins: [{ Input: 0 }, [{ Input: 1 }, { Input: 2 }]],
    })
    // MakeMoveVec: the TS shape names the element type `type`
    const makeVec = grpcCommandToJsonRpc({
      $kind: 'MakeMoveVec',
      MakeMoveVec: {
        type: '0x2::sui::SUI',
        elements: [{ $kind: 'Input', Input: 1 }],
      },
    } as never)
    assert.deepEqual(makeVec, {
      MakeMoveVec: ['0x2::sui::SUI', [{ Input: 1 }]],
    })
  })
})

describe('grpcSimulateToDevInspect', () => {
  it('maps command results to returnValues tuples and surfaces aborts', () => {
    const results = grpcSimulateToDevInspect({
      Transaction: {
        effects: { status: { success: true, error: null } },
      },
      commandResults: [{ returnValues: [{ bcs: new TextEncoder().encode('FeeQuoter 1.6.0') }] }],
    } as never)
    const resultsShape = results as {
      effects: { status: { status: string } }
      results: { returnValues: [Uint8Array, string][] }[]
    }
    assert.equal(resultsShape.effects.status.status, 'success')
    const firstResult = resultsShape.results[0]!
    const firstReturn = firstResult.returnValues[0]!
    assert.equal(firstReturn[1], 'vector<u8>')
    assert.equal(new TextDecoder().decode(firstReturn[0]), 'FeeQuoter 1.6.0')

    const failed = grpcSimulateToDevInspect({
      FailedTransaction: {
        effects: {
          status: {
            success: false,
            error: {
              $kind: 'MoveAbort',
              MoveAbort: {
                abortCode: '7',
                location: { package: '0xabc', module: 'managed_token' },
              },
            },
          },
        },
      },
      commandResults: [],
    } as never)
    const failedShape = failed as unknown as {
      effects: { status: { status: string } }
      error: string
    }
    assert.equal(failedShape.effects.status.status, 'failure')
    assert.match(failedShape.error, /MoveAbort\(MoveLocation \{ module: ModuleId \{ address: 0xabc/)
  })
})

describe('decodeBcsMoveValue', () => {
  const datatype = {
    typeName: '0xpkg::mod::Message',
    fields: [
      { name: 'message_id', type: { type: 9, typeParameterInstantiation: [{ type: 3 }] } },
      { name: 'fee_token_amount', type: { type: 6 } },
      { name: 'nested', type: { type: 10, typeName: '0xpkg::mod::Inner' } },
    ],
  }
  const inner = {
    typeName: '0xpkg::mod::Inner',
    fields: [{ name: 'bytes', type: { type: 9, typeParameterInstantiation: [{ type: 3 }] } }],
  }
  const resolve = (typeName: string) =>
    typeName === datatype.typeName ? datatype : typeName === inner.typeName ? inner : undefined
  const bytes = bcs
    .struct('Message', {
      message_id: bcs.vector(bcs.u8()),
      fee_token_amount: bcs.u64(),
      nested: bcs.struct('Inner', { bytes: bcs.vector(bcs.u8()) }),
    })
    .serialize({
      message_id: [116, 153, 216, 146, 93],
      fee_token_amount: 86589748n,
      nested: { bytes: [1, 2, 3] },
    })
    .toBytes()
  const decode = (mode: 'object' | 'event', typeName = datatype.typeName) =>
    decodeBcsMoveValue(new BcsCursor(bytes), { type: 10, typeName }, resolve, mode)

  it('renders byte vectors as number arrays and u64 as decimal strings', () => {
    const rendered = decode('event') as Record<string, unknown>
    assert.deepEqual(rendered.message_id, [116, 153, 216, 146, 93])
    assert.equal(rendered.fee_token_amount, '86589748')
  })

  it('wraps nested structs as {fields} in object mode only', () => {
    const event = decode('event') as { nested?: Record<string, unknown> }
    assert.deepEqual(event.nested?.bytes, [1, 2, 3])
    const object = decode('object') as {
      fields?: { nested?: { fields?: Record<string, unknown> } }
    }
    assert.deepEqual(object.fields?.nested?.fields?.bytes, [1, 2, 3])
  })

  it('throws on an unresolvable datatype (the adapter falls back to raw json)', () => {
    assert.throws(() => decode('event', '0xother::mod::X'), /unresolvable datatype/)
  })
})

describe('dynamicFieldNameToBcs', () => {
  it('serializes primitive names to BCS bytes', () => {
    const u64 = dynamicFieldNameToBcs({ type: 'u64', value: '123' })
    assert.equal(u64.type, 'u64')
    // u64 little-endian: 123 = 0x7b
    assert.deepEqual(Array.from(u64.bcs), [123, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('filters', () => {
  it('maps the MoveFunction transaction filter', () => {
    assert.deepEqual(
      transactionFilterToNormalized({
        MoveFunction: { package: '0xpkg', module: 'offramp', function: 'init_execute' },
      }),
      { function: '0xpkg::offramp::init_execute' },
    )
    assert.deepEqual(transactionFilterToNormalized({ MoveFunction: { package: '0xpkg' } }), {
      function: '0xpkg',
    })
    assert.deepEqual(transactionFilterToNormalized({ FromAddress: '0xsender' }), {
      sender: '0xsender',
    })
    assert.equal(transactionFilterToNormalized(undefined), undefined)
  })

  it('maps the event filters', () => {
    assert.deepEqual(eventFilterToNormalized({ MoveEventType: '0xpkg::mod::Event' }), {
      eventType: '0xpkg::mod::Event',
    })
    assert.deepEqual(eventFilterToNormalized({ MoveModule: { package: '0xpkg', module: 'mod' } }), {
      emitModule: '0xpkg::mod',
    })
  })

  it('refuses the ToAddress transaction filter instead of mis-mapping it', () => {
    // the gRPC predicates have no recipient filter; mapping ToAddress to
    // `sender` would silently return the recipient's SENT transactions
    assert.throws(
      () => transactionFilterToNormalized({ ToAddress: '0xrecipient' } as never),
      /Unsupported Sui transaction filter/,
    )
  })
})

describe('grpcTransactionToJsonRpc (raw proto path)', () => {
  it('maps the raw ledger transaction (checkpoint string, gasPayment, nested PTB)', () => {
    const tx = grpcTransactionToJsonRpc(
      {
        digest: 'd1',
        checkpoint: 987654n,
        timestamp: { seconds: 1792279576n, nanos: 631000000 },
        transaction: {
          sender: '0xs',
          gasPayment: {
            budget: 100000000n,
            owner: '0xgas',
            price: 1000n,
            objects: [{ objectId: '0xcoin1', version: 123n, digest: 'dig' }],
          },
          kind: {
            data: {
              oneofKind: 'programmableTransaction',
              programmableTransaction: {
                inputs: [{ kind: 2, objectId: '0xobj', version: 5n, digest: 'd' }],
                commands: [
                  {
                    command: {
                      oneofKind: 'moveCall',
                      moveCall: {
                        package: '0xp',
                        module: 'offramp',
                        function: 'execute',
                        typeArguments: [],
                        arguments: [{ kind: 2, input: 0 }],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        effects: {
          status: { success: true, error: null },
          gasUsed: { computationCost: '100' },
          changedObjects: [],
          gasObject: { objectId: '0xg' },
          dependencies: ['d0'],
        },
      } as never,
      { showInput: true, showEffects: true },
    ) as {
      checkpoint?: unknown
      timestampMs?: string
      transaction?: { data: Record<string, unknown> }
      effects?: Record<string, unknown>
    }
    // a bigint checkpoint would throw on JSON.stringify
    assert.equal(tx.checkpoint, '987654')
    assert.equal(tx.timestampMs, '1792279576631')
    const data = tx.transaction!.data as {
      sender?: string
      gasData?: Record<string, unknown>
      transaction?: { inputs?: unknown[]; transactions?: Record<string, unknown>[] }
    }
    assert.equal(data.sender, '0xs')
    assert.deepEqual(data.gasData, {
      budget: '100000000',
      owner: '0xgas',
      payment: [{ objectId: '0xcoin1', version: '123', digest: 'dig' }],
      price: '1000',
    })
    assert.deepEqual(data.transaction!.inputs, [
      {
        type: 'object',
        objectType: 'immOrOwnedObject',
        objectId: '0xobj',
        version: '5',
        digest: 'd',
      },
    ])
    assert.deepEqual(data.transaction!.transactions![0]!.MoveCall, {
      package: '0xp',
      module: 'offramp',
      function: 'execute',
      type_arguments: [],
      arguments: [{ Input: 0 }],
    })
    assert.deepEqual((tx.effects!.status as Record<string, unknown>).status, 'success')
  })

  it('renders the MoveAbort error string for failed RAW transactions', () => {
    const tx = grpcTransactionToJsonRpc(
      {
        digest: 'd2',
        checkpoint: '5',
        effects: {
          status: {
            success: false,
            error: {
              description: 'aborted',
              command: 0,
              kind: 13,
              abort: {
                abortCode: 9n,
                location: { package: '0xp', module: 'offramp', function: 3, instruction: 5 },
              },
            },
          },
          gasUsed: {},
          changedObjects: [],
          dependencies: [],
        },
      } as never,
      { showEffects: true },
    ) as { effects?: { status: { status: string; error?: string } } }
    assert.equal(tx.effects!.status.status, 'failure')
    // the SDK's failure decoder regex-parses this exact shape
    assert.match(
      tx.effects!.status.error!,
      /^MoveAbort\(MoveLocation \{ module: ModuleId \{ address: 0xp, name: "offramp" \}, function: 3, instruction: 5 \}, 9\)$/,
    )
  })
})

describe('grpcPackageToDisassembled', () => {
  it('recovers imports from function signatures without bytecode or dependency probes', async () => {
    const ccip = `0x${'ab'.repeat(32)}`
    const disassembled = await grpcPackageToDisassembled({
      modules: [
        {
          name: 'managed_token_pool',
          functions: [
            {
              parameters: [
                { body: { type: 10, typeName: `${ccip}::state_object::CCIPObjectRef` } },
              ],
              returns: [
                {
                  body: {
                    type: 9,
                    typeParameterInstantiation: [
                      { type: 10, typeName: `${ccip}::fee_quoter::Receipt` },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    assert.ok(disassembled.managed_token_pool?.includes(`use ${ccip}::state_object;`))
    assert.ok(disassembled.managed_token_pool?.includes(`use ${ccip}::fee_quoter;`))
  })

  it('synthesizes the source fragments consumers parse', async () => {
    const disassembled = await grpcPackageToDisassembled({
      modules: [
        {
          name: 'managed_token_pool',
          dependencies: [{ address: '0xccip', name: 'token_admin_registry' }],
          datatypes: [
            {
              name: 'ManagedTokenPoolState',
              fields: [
                {
                  name: 'pool_id',
                  type: { type: 10, typeName: '0xccip::state_object::CCIPObjectRef' },
                },
                { name: 'dummy_field', type: { type: 2 } },
              ],
            },
          ],
        },
      ],
    })
    const source = disassembled.managed_token_pool ?? ''
    assert.match(source, /use 0xccip::token_admin_registry;/)
    assert.match(source, /struct ManagedTokenPoolState/)
    assert.match(source, /pool_id:/)
  })
})
