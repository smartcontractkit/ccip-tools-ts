import {
  type JsonRpcApiProvider,
  type Provider,
  Contract,
  FunctionFragment,
  ZeroAddress,
  concat,
  dataSlice,
  getAddress,
  getNumber,
  hexlify,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from '../abi/BurnMintERC677Token.js'
import TokenPoolABI from '../abi/BurnMintTokenPool_1_5_1.js'
import RouterABI from '../abi/Router.js'
import { discoverOffRamp, validateOffRamp } from './execution.js'
import { type Lane, CCIPContractType, CCIPVersion, CCIP_ABIs, defaultAbiCoder } from './types.js'
import {
  chainNameFromSelector,
  getProviderNetwork,
  lazyCached,
  validateTypeAndVersion,
} from './utils.js'

const BALANCES_SLOT = 0
const ccipReceive = FunctionFragment.from({
  type: 'function',
  name: 'ccipReceive',
  stateMutability: 'nonpayable',
  inputs: RouterABI.find((v) => v.type === 'function' && v.name === 'routeMessage')!.inputs.slice(
    0,
    1,
  ),
  outputs: [],
})
type Any2EVMMessage = Parameters<TypedContract<typeof RouterABI>['routeMessage']>[0]

async function getDestTokenForSource(
  source: Provider,
  dest: JsonRpcApiProvider,
  onRamp: string,
  offRamp: Awaited<ReturnType<typeof discoverOffRamp>>,
  token: string,
) {
  return lazyCached(`destToken ${token}`, async () => {
    const [, version] = await validateTypeAndVersion(source, onRamp)
    let remoteToken
    if (version === CCIPVersion.V1_2) {
      const offRampContract = offRamp as unknown as TypedContract<
        (typeof CCIP_ABIs)[CCIPContractType.OffRamp][typeof version]
      >
      const pool = await offRampContract.getPoolBySourceToken(token)
      const poolContract = new Contract(pool, TokenPoolABI, dest) as unknown as TypedContract<
        typeof TokenPoolABI
      >
      remoteToken = (await poolContract.getToken()) as string
    } else {
      const onRampContract = new Contract(
        onRamp,
        CCIP_ABIs[CCIPContractType.OnRamp][version],
        source,
      ) as unknown as TypedContract<(typeof CCIP_ABIs)[CCIPContractType.OnRamp][typeof version]>
      const destChainSelector = (await getProviderNetwork(dest)).chainSelector
      const pool = await onRampContract.getPoolBySourceToken(destChainSelector, token)
      if (pool === ZeroAddress) throw new Error(`Token=${token} not supported by OnRamp=${onRamp}`)
      const poolContract = new Contract(pool, TokenPoolABI, source) as unknown as TypedContract<
        typeof TokenPoolABI
      >
      remoteToken = getAddress(dataSlice(await poolContract.getRemoteToken(destChainSelector), -20))
      if (remoteToken === ZeroAddress)
        throw new Error(
          `TokenPool=${pool as string} doesnt support dest="${chainNameFromSelector(destChainSelector)}"`,
        )
    }
    return remoteToken
  })
}

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver
 *
 * @param source - Provider for the source chain
 * @param dest - Provider for the destination chain
 * @param onRamp - onRamp contract address
 * @param request - CCIP request info
 * @param hints - hints for the offRamp contract (optional, to skip offramp discovery)
 * @returns estimated gasLimit
 **/
export async function estimateExecGasForRequest(
  source: Provider,
  dest: JsonRpcApiProvider,
  onRamp: string,
  request: {
    sender: string
    receiver: string
    data: string
    tokenAmounts: readonly { token: string; amount: bigint }[]
  },
  hints?: { offRamp?: string; page?: number },
) {
  const { chainSelector: sourceChainSelector, name: sourceName } = await getProviderNetwork(source)
  const { chainSelector: destChainSelector, name: destName } = await getProviderNetwork(dest)

  const [, version] = await validateTypeAndVersion(source, onRamp)
  const lane: Lane = { sourceChainSelector, destChainSelector, onRamp, version }

  let offRamp
  if (hints?.offRamp) {
    offRamp = await validateOffRamp(dest, hints.offRamp, lane)
    if (!offRamp)
      throw new Error(
        `Invalid offRamp for "${sourceName}" -> "${destName}" (onRamp=${onRamp}) lane`,
      )
  } else {
    offRamp = await discoverOffRamp(dest, lane, hints)
  }
  const { router: destRouter } = await offRamp.getDynamicConfig()

  const destTokenAmounts = await Promise.all(
    request.tokenAmounts.map(async ({ token, amount }) => {
      const destToken = await getDestTokenForSource(source, dest, onRamp, offRamp, token)
      return { token: destToken, amount }
    }),
  )

  const message: Any2EVMMessage = {
    messageId: hexlify(randomBytes(32)),
    sender: zeroPadValue(request.sender, 32),
    data: request.data,
    sourceChainSelector,
    destTokenAmounts: destTokenAmounts,
  }

  // we need to override the state, increasing receiver's balance for each token, to simulate the
  // state after tokens were transferred by the offRamp just before calling `ccipReceive`
  const destAmounts: Record<string, bigint> = {}
  const stateOverrides: Record<string, { stateDiff: Record<string, string> }> = {}
  for (const { token, amount } of destTokenAmounts) {
    if (!(token in destAmounts)) {
      const tokenContract = new Contract(token, TokenABI, dest) as unknown as TypedContract<
        typeof TokenABI
      >
      const currentBalance = await tokenContract.balanceOf(request.receiver)
      destAmounts[token] = currentBalance
    }
    destAmounts[token] += amount
    stateOverrides[token] = {
      stateDiff: {
        [solidityPackedKeccak256(['uint256', 'uint256'], [request.receiver, BALANCES_SLOT])]:
          toBeHex(destAmounts[token], 32),
      },
    }
  }

  const calldata = concat([
    ccipReceive.selector,
    defaultAbiCoder.encode(ccipReceive.inputs, [message]),
  ])

  return (
    getNumber(
      (await dest.send('eth_estimateGas', [
        {
          from: destRouter,
          to: request.receiver,
          data: calldata,
        },
        'latest',
        ...(Object.keys(stateOverrides).length ? [stateOverrides] : []),
      ])) as string,
    ) -
    (21_000 - 700) // 21k is the base gas cost for a transaction, 700 is the gas cost of the call
  )
}
