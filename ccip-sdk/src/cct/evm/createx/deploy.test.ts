import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../evm/types.ts'
import { ChainFamily } from '../../../networks.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import { getTokenPoolArtifact } from '../token-pool/contracts.ts'
import { CREATEX_ADDRESS, CREATEX_INTERFACE } from './contracts.ts'
import {
  type DeployViaCreateXOptions,
  deployViaCreateX,
  deployViaCreateXUnchecked,
} from './deploy.ts'
import { buildPermissionedSalt, deriveEntropy, predictCreateXAddress } from './salt.ts'

const SENDER = '0x' + '11'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const INIT_CODE = '0x60806040' + 'ab'.repeat(64)
/** Not CreateX: any code whose hash differs from the published one exercises the reject path. */
const CREATEX_CODE = '0x600180'

/** A plain deployment tx, the shape every `generateUnsignedDeploy*` returns. */
function plainDeploy(data: string = INIT_CODE): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions: [{ from: SENDER, data }] }
}

function chainStub(opts: { code?: string; targetCode?: string; chainId?: bigint } = {}): EVMChain {
  return {
    provider: {
      getNetwork: () => Promise.resolve({ chainId: opts.chainId ?? 84532n }),
      getCode: (address: string) =>
        Promise.resolve(
          getAddress(address) === getAddress(CREATEX_ADDRESS)
            ? (opts.code ?? CREATEX_CODE)
            : (opts.targetCode ?? '0x'),
        ),
    },
  } as unknown as EVMChain
}

/** The real vendored pool ABI, the same one a caller would pass. */
const POOL_IFACE = getTokenPoolArtifact('BurnMintTokenPool').iface

const OPTS: DeployViaCreateXOptions = {
  sender: SENDER,
  salt: 'pool-v1',
  iface: POOL_IFACE,
  init: { transferOwnership: OWNER },
}
const CHAIN_ID = 84532n

/**
 * The encoding cases drive {@link deployViaCreateXUnchecked} rather than {@link deployViaCreateX}: satisfying
 * the pre-flight's factory check would mean a fixture holding CreateX's real 12KB runtime
 * bytecode, which this package deliberately does not vendor (AGPL). The pre-flight is asserted on
 * its own below, and both together end-to-end in createx.integration.test.ts.
 */
function build(unsigned = plainDeploy(), opts: DeployViaCreateXOptions = OPTS) {
  return deployViaCreateXUnchecked(CHAIN_ID, unsigned, opts)
}

describe('deployViaCreateXUnchecked', () => {
  it('rewrites the deployment into a call to the factory, preserving the init code', () => {
    const { transaction } = build()
    const tx = transaction.transactions[0]!

    assert.equal(tx.to, CREATEX_ADDRESS, 'CreateX deploys are calls, not bare init-code')
    assert.equal(tx.from, SENDER, 'the salt binds the deploy to this sender')

    const [salt, initCode, init, values, refund] = CREATEX_INTERFACE.decodeFunctionData(
      'deployCreate2AndInit',
      tx.data!,
    )
    // Byte-identical to the plain path, which is why verification metadata and the constructor-arg
    // capture are unaffected by routing through the factory.
    assert.equal(initCode, INIT_CODE)
    assert.equal(salt, buildPermissionedSalt('viaCreateX', SENDER, deriveEntropy(['pool-v1'])))
    assert.equal(init, POOL_IFACE.encodeFunctionData('transferOwnership', [OWNER]))
    // No ether moves in a CCT deployment, so both legs are zero and nothing can be stranded.
    assert.deepEqual([values[0], values[1]], [0n, 0n])
    assert.equal(refund, SENDER)
  })

  it('returns the address the salt and init code determine', () => {
    const { address } = build()
    assert.equal(
      address,
      predictCreateXAddress('viaCreateX', {
        salt: buildPermissionedSalt('viaCreateX', SENDER, deriveEntropy(['pool-v1'])),
        initCode: INIT_CODE,
        deployer: SENDER,
        chainId: 84532n,
      }),
    )
  })

  it('binds the address to the sender', () => {
    const other = '0x' + '44'.repeat(20)
    const a = build()
    const b = build(plainDeploy(), { ...OPTS, sender: other })
    assert.notEqual(a.address, b.address)
  })

  it('binds the address to the salt label', () => {
    const a = build()
    const b = build(plainDeploy(), { ...OPTS, salt: 'pool-v2' })
    assert.notEqual(a.address, b.address)
  })

  it('binds the address to the init code, so different ctor args differ', () => {
    const a = build()
    const b = build(plainDeploy(INIT_CODE + 'ff'))
    assert.notEqual(a.address, b.address)
  })

  it('derives the same address from a label as from the entropy it hashes to', () => {
    const byLabel = build()
    const byEntropy = build(plainDeploy(), {
      sender: SENDER,
      entropy: deriveEntropy(['pool-v1']),
      iface: POOL_IFACE,
      init: { transferOwnership: OWNER },
    })
    assert.equal(byLabel.address, byEntropy.address)
  })

  it('rejects an empty label rather than hashing it to a fixed address', () => {
    assert.throws(() => build(plainDeploy(), { ...OPTS, salt: '   ' }), CCTParamsInvalidError)
  })
})

describe('deployViaCreateXUnchecked — default salt', () => {
  it('derives entropy from the deployment when neither salt nor entropy is given', () => {
    const { sender, iface, init } = OPTS
    const a = build(plainDeploy(), { sender, iface, init })
    const b = build(plainDeploy(), { sender, iface, init })
    assert.equal(a.address, b.address, 'the default must be deterministic, not random')
  })

  it('gives different default addresses for different constructor args', () => {
    const { sender, iface, init } = OPTS
    const a = build(plainDeploy(), { sender, iface, init })
    const b = build(plainDeploy(INIT_CODE + 'ff'), { sender, iface, init })
    assert.notEqual(a.address, b.address)
  })

  it('lets an explicit salt distinguish a deliberate redeploy of identical inputs', () => {
    const { sender, iface, init } = OPTS
    const byDefault = build(plainDeploy(), { sender, iface, init })
    assert.notEqual(byDefault.address, build().address)
  })
})

describe('deployViaCreateXUnchecked — init', () => {
  it('encodes transferOwnership against the standard Ownable2Step signature', () => {
    const { transaction } = build()
    const [, , actual] = CREATEX_INTERFACE.decodeFunctionData(
      'deployCreate2AndInit',
      transaction.transactions[0]!.data!,
    )
    assert.equal(actual, POOL_IFACE.encodeFunctionData('transferOwnership', [OWNER]))
  })

  it('rejects the zero address, which would leave the contract with no reachable owner', () => {
    assert.throws(
      () => build(plainDeploy(), { ...OPTS, init: { transferOwnership: ZeroAddress } }),
      CCTParamsInvalidError,
    )
  })

  it('does not change the deployed address, since init is not part of the CREATE2 preimage', () => {
    const other = '0x' + '88'.repeat(20)
    assert.equal(
      build().address,
      build(plainDeploy(), { ...OPTS, init: { transferOwnership: other } }).address,
    )
  })
})

describe('deployViaCreateXUnchecked — input guards', () => {
  it('rejects a contract call, which is not a deployment', () => {
    const call: UnsignedEVMTx = {
      family: ChainFamily.EVM,
      transactions: [{ to: OWNER, data: '0xdeadbeef' }],
    }
    assert.throws(() => build(call), CCTParamsInvalidError)
  })

  it('rejects a multi-transaction bundle, which has no single init code', () => {
    const two: UnsignedEVMTx = {
      family: ChainFamily.EVM,
      transactions: [{ data: INIT_CODE }, { data: INIT_CODE }],
    }
    assert.throws(() => build(two), CCTParamsInvalidError)
  })

  it('rejects a deployment carrying no init code', () => {
    assert.throws(() => build(plainDeploy('0x')), CCTParamsInvalidError)
  })

  it('rejects a malformed sender', () => {
    assert.throws(
      () => build(plainDeploy(), { ...OPTS, sender: 'not-an-address' }),
      CCTParamsInvalidError,
    )
  })
})

describe('deployViaCreateX — pre-flight', () => {
  it('rejects a chain where the factory is not the reviewed CreateX', async () => {
    await assert.rejects(
      () => deployViaCreateX(chainStub({ code: '0xdead' }), plainDeploy(), OPTS),
      CCTParamsInvalidError,
    )
  })

  it('rejects a chain with no CreateX at all, rather than mining a successful no-op', async () => {
    await assert.rejects(
      () => deployViaCreateX(chainStub({ code: '0x' }), plainDeploy(), OPTS),
      CCTParamsInvalidError,
    )
  })

  it('rejects an already-occupied target address', async () => {
    // Reusing the same (sender, salt) pair would otherwise revert inside CreateX after gas spend.
    await assert.rejects(
      () => deployViaCreateX(chainStub({ targetCode: '0xfe' }), plainDeploy(), OPTS),
      CCTParamsInvalidError,
    )
  })
})
