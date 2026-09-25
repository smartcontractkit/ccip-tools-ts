/**
 * {@link deployViaCreateX} — rewrites an unsigned contract-deployment transaction into a call to the
 * CreateX factory, so a Safe or timelock can be the deployer and the address is known before
 * signing.
 *
 * @remarks A transform over a built transaction, not a mode on the deploy operation. CreateX needs
 * one thing from an operation — the init code — and a plain deployment transaction already *is*
 * that init code, carrying `data` and no `to`. So the deploy ops and their shared base class need
 * no knowledge of the factory and no change at all, and any future deploy op works unchanged.
 *
 * @example Deploy a pool from a Safe and take ownership in the same Safe transaction:
 * ```typescript
 * const { iface } = getTokenPoolArtifact('BurnMintTokenPool')
 * const plain  = await cct.generateUnsignedDeployTokenPool({ ...poolArgs, sender: safe })
 * const deploy = await deployViaCreateX(chain, plain, {
 *   sender: safe,
 *   iface,
 *   init: { transferOwnership: safe },
 * })
 * // `encodeAcceptPoolOwnership`, not the operation: the pool does not exist yet, and the
 * // operation reads its type and owner from the chain before building.
 * const accept = encodeAcceptPoolOwnership(iface, { poolAddress: deploy.address })
 * // submit [deploy.transaction, accept] as one batched Safe transaction
 * ```
 *
 * @packageDocumentation
 */

import { type Interface, keccak256 } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../evm/types.ts'
import { ChainFamily } from '../../../networks.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  validateAddress,
  validateNonEmptyString,
  validateNonZeroAddress,
} from '../validate.ts'
import { CREATEX_ADDRESS, CREATEX_INTERFACE } from './contracts.ts'
import {
  buildPermissionedSalt,
  deriveEntropy,
  predictCreateXAddress,
} from './salt.ts'
import { verifyCreateXDeployment } from './verify.ts'

/** Name reported in {@link CCTParamsInvalidError}s raised here; this is a helper, not an op. */
const NAME = 'deployViaCreateX'

/**
 * Where the salt's entropy comes from. Omit both to derive it from the deployment itself, which is
 * the normal case; pass `salt` to distinguish a deliberate redeploy of identical inputs, or
 * `entropy` for raw bytes mined for a vanity address.
 */
export type CreateXSaltSource =
  | { salt?: string; entropy?: never }
  | { entropy: string; salt?: never }

/** Options for {@link deployViaCreateX} and {@link deployViaCreateXUnchecked}. */
export type DeployViaCreateXOptions = CreateXSaltSource & DeployViaCreateXTarget

/**
 * The non-salt half of {@link DeployViaCreateXOptions}, split out so a caller composing these
 * options can `Omit` from it without collapsing {@link CreateXSaltSource}'s discrimination.
 */
export type DeployViaCreateXTarget = {
  /**
   * The deployer, i.e. whoever will send the resulting transaction — typically a Safe.
   *
   * @remarks Load-bearing rather than cosmetic: the permissioned salt derives from it, so it
   * determines the deployed address. A transaction sent by anyone else reverts.
   */
  sender: string
  /**
   * The deployed contract's own interface — for a pool, `getTokenPoolArtifact(type).iface`.
   *
   * @remarks Taken from the caller rather than hand-written here, so the init call is encoded
   * against the same vendored ABI the deployment was built from and cannot drift from the
   * bytecode being deployed.
   */
  iface: Interface
  /**
   * The atomic call CreateX makes on the contract the instant it is created.
   *
   * @remarks Required, and a closed set rather than calldata. CreateX makes exactly one call, at
   * which point the contract's owner is the factory — which holds no state and can never be made
   * to call an already-deployed contract. These contracts have no `multicall`, so any init that
   * is not an ownership hand-off strands the contract permanently. Constraining the field makes
   * that unrepresentable rather than one typo away.
   */
  init: CreateXInit
}

/**
 * The atomic init call, named for the function it invokes. One member today because one is all
 * that is safe (see {@link DeployViaCreateXTarget.init}); another would be an extra member, not a
 * redesign.
 */
export type CreateXInit = {
  /**
   * Propose `transferOwnership(address)` to this address, atomically with creation.
   *
   * @remarks `Ownable2Step`, so this *proposes*: the owner stays CreateX until the target calls
   * `acceptOwnership`. Batch both into one Safe transaction to close the gap. Skipping the accept
   * stalls the hand-off but does not lose the contract — the proposal is set atomically with
   * creation and cannot be overwritten, so the target can accept at any later date.
   */
  transferOwnership: string
}

/** A CreateX deployment: the transaction to send, and the address it will create. */
export type DeployViaCreateX = {
  /** Where the contract will land, derived from `(sender, salt, initCode)` before signing. */
  address: string
  /** The call to CreateX that replaces the plain deployment transaction. */
  transaction: UnsignedEVMTx
}

/**
 * Rewrites a plain deployment transaction into a CreateX `deployCreate2AndInit` call, returning it
 * alongside the address it will deploy to.
 *
 * @param chain - used only for the pre-flight: the chain id the salt is checked against, the
 * factory's code, and whether the target address is free
 * @param unsigned - a deployment transaction as returned by any `generateUnsignedDeploy*`; must
 * carry init code and no `to`
 *
 * @throws {@link CCTParamsInvalidError} if `unsigned` is not a contract deployment, if `sender` or
 * `init` is malformed, if CreateX is not the reviewed contract on this chain, or if the predicted
 * address already holds code
 */
export async function deployViaCreateX(
  chain: EVMChain,
  unsigned: UnsignedEVMTx,
  opts: DeployViaCreateXOptions,
): Promise<DeployViaCreateX> {
  const chainId = (await chain.provider.getNetwork()).chainId
  const deploy = deployViaCreateXUnchecked(chainId, unsigned, opts)
  await assertDeployable(chain, deploy.address)
  return deploy
}

/**
 * {@link deployViaCreateX} without the on-chain pre-flight: a pure function of its arguments, for
 * building a deployment with no RPC access. Named for what it skips.
 *
 * @remarks Prefer {@link deployViaCreateX}, which additionally checks that the factory on this
 * chain is the reviewed contract and that the target address is free. A caller using this owes
 * those checks elsewhere; see {@link assertDeployable} for why they matter.
 *
 * @param chainId - the target chain. Does not affect the result for the sender-permissioned salts
 * this builds, which CreateX guards without reference to the chain; it is threaded through for
 * the salt parser's other branches.
 *
 * @throws {@link CCTParamsInvalidError} if `unsigned` is not a contract deployment, or if `sender`,
 * `salt` or `init` is malformed
 */
export function deployViaCreateXUnchecked(
  chainId: bigint,
  unsigned: UnsignedEVMTx,
  opts: DeployViaCreateXOptions,
): DeployViaCreateX {
  const initCode = deploymentInitCode(unsigned)
  validateAddress(NAME, 'sender', opts.sender)
  validateNonZeroAddress(
    NAME,
    'init.transferOwnership',
    opts.init.transferOwnership,
  )

  const salt = buildPermissionedSalt(
    NAME,
    opts.sender,
    entropyOf(opts, initCode),
  )
  const address = predictCreateXAddress(NAME, {
    salt,
    initCode,
    deployer: opts.sender,
    chainId,
  })

  const data = CREATEX_INTERFACE.encodeFunctionData('deployCreate2AndInit', [
    salt,
    initCode,
    opts.iface.encodeFunctionData('transferOwnership', [
      opts.init.transferOwnership,
    ]),
    // No ether moves in a CCT deployment, so both legs are zero and nothing can be stranded.
    [0n, 0n],
    opts.sender,
  ])
  return {
    address,
    transaction: {
      family: ChainFamily.EVM,
      transactions: [{ from: opts.sender, to: CREATEX_ADDRESS, data }],
    },
  }
}

/**
 * The init code of a plain deployment transaction.
 *
 * @remarks A deployment is the one transaction shape with `data` and no `to`, which is exactly the
 * creation bytecode plus ABI-encoded constructor args. Rejecting anything else stops a contract
 * *call* being silently wrapped as though it were a deployment.
 */
function deploymentInitCode(unsigned: UnsignedEVMTx): string {
  const [tx, ...rest] = unsigned.transactions
  if (!tx || rest.length)
    throw new CCTParamsInvalidError(
      NAME,
      'unsigned',
      `expected a single deployment transaction, got ${unsigned.transactions.length}`,
    )
  if (tx.to !== undefined && tx.to !== null)
    throw new CCTParamsInvalidError(
      NAME,
      'unsigned',
      'expected a contract deployment (no `to`), got a contract call',
    )
  if (!tx.data || tx.data === '0x')
    throw new CCTParamsInvalidError(
      NAME,
      'unsigned',
      'deployment carries no init code',
    )
  return tx.data
}

/**
 * The 11 entropy bytes: taken as given, derived from a label, or — by default — from the
 * deployment itself.
 *
 * @remarks The default hashes the init code, making the address a pure function of the contract
 * and its constructor arguments. Redeploying identical inputs from the same sender therefore
 * lands on the same address and fails the occupancy pre-flight, which is the right answer more
 * often than silently creating a duplicate. Pass an explicit `salt` when a second one is wanted.
 *
 * This does **not** give one address across chains: a pool's constructor takes chain-specific
 * `router` and `rmnProxy`, so the init code — and with it the address — differs per chain
 * whatever the salt is.
 */
function entropyOf(opts: CreateXSaltSource, initCode: string): string {
  if (opts.entropy !== undefined) return opts.entropy
  if (opts.salt === undefined)
    return deriveEntropy(['cct-sdk', keccak256(initCode)])
  validateNonEmptyString(NAME, 'salt', opts.salt)
  return deriveEntropy([opts.salt])
}

/**
 * Pre-flight: the factory must be the reviewed contract on this chain, and the target must be free.
 *
 * @remarks Both failures are otherwise silent and expensive. An EVM `CALL` to an address with no
 * code *succeeds*, so on a chain without CreateX the transaction mines with `status: 1` having
 * deployed nothing at all. And a reused `(sender, salt)` pair makes CreateX's inner `CREATE2`
 * fail, reverting after the gas is spent.
 */
async function assertDeployable(
  chain: EVMChain,
  address: string,
): Promise<void> {
  // Occupancy first: it is the more specific diagnosis, and it holds regardless of the factory.
  if ((await chain.provider.getCode(address)) !== '0x')
    throw new CCTParamsInvalidError(
      NAME,
      'salt',
      `${address} already holds code — this salt and init-code pair has been deployed already; vary \`salt\` to get a fresh address`,
    )
  const factory = await verifyCreateXDeployment(chain)
  if (factory.status !== 'verified')
    throw new CCTParamsInvalidError(
      NAME,
      'chain',
      `CreateX is not usable on this chain (${factory.status} at ${factory.address})`,
    )
}
