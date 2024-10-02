import type { JsonRpcApiProvider } from 'ethers'
import {
  concat,
  Contract,
  FunctionFragment,
  getNumber,
  hexlify,
  type Provider,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  ZeroAddress,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from '../abi/BurnMintERC677Token.js'
import BurnMintTokenPool from '../abi/BurnMintTokenPool_1_5.js'
import RouterABI from '../abi/Router.js'
import { fetchOffRamp } from './execution.js'
import {
  CCIP_ABIs,
  type CCIPContractTypeOffRamp,
  CCIPContractTypeOnRamp,
  CCIPVersion_1_2,
  defaultAbiCoder,
  type Lane,
} from './types.js'
import { getProviderNetwork, getTypeAndVersion, lazyCached } from './utils.js'

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
  offRamp: Awaited<ReturnType<typeof fetchOffRamp>>,
  token: string,
) {
  return lazyCached(`destToken ${token}`, async () => {
    const [, version] = await getTypeAndVersion(source, onRamp)
    if (version === CCIPVersion_1_2) {
      const offRampContract = offRamp as unknown as TypedContract<
        (typeof CCIP_ABIs)[CCIPContractTypeOffRamp][typeof version]
      >
      const pool = await offRampContract.getPoolBySourceToken(token)
      const poolContract = new Contract(pool, BurnMintTokenPool, dest) as unknown as TypedContract<
        typeof BurnMintTokenPool
      >
      return poolContract.getToken() as Promise<string>
    } else {
      const onRampContract = new Contract(
        onRamp,
        CCIP_ABIs[CCIPContractTypeOnRamp][version],
        source,
      ) as unknown as TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeOnRamp][typeof version]>
      const destChainSelector = (await getProviderNetwork(dest)).chainSelector
      const pool = await onRampContract.getPoolBySourceToken(destChainSelector, token)
      const poolContract = new Contract(
        pool,
        BurnMintTokenPool,
        source,
      ) as unknown as TypedContract<typeof BurnMintTokenPool>
      return poolContract.getRemoteToken(destChainSelector)
    }
  })
}

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver
 *
 * @param source - Provider for the source chain
 * @param dest - Provider for the destination chain
 * @param sourceRouter - Router contract address on the source chain
 * @param request - CCIP request info
 * @returns estimated gasLimit
 **/
export async function estimateExecGasForRequest(
  source: Provider,
  dest: JsonRpcApiProvider,
  sourceRouter: string,
  request: {
    sender: string
    receiver: string
    data: string
    tokenAmounts: readonly { token: string; amount: bigint }[]
  },
) {
  const { chainSelector: sourceChainSelector, name: sourceName } = await getProviderNetwork(source)
  const { chainSelector: destChainSelector, name: destName } = await getProviderNetwork(dest)
  const sourceRouterContract = new Contract(
    sourceRouter,
    RouterABI,
    source,
  ) as unknown as TypedContract<typeof RouterABI>
  const onRamp = (await sourceRouterContract.getOnRamp(destChainSelector)) as string
  if (!onRamp || onRamp === ZeroAddress)
    throw new Error(`No "${sourceName}" -> "${destName}" lane on ${sourceRouter}`)

  const [, version] = await getTypeAndVersion(source, onRamp)
  const lane: Lane = { sourceChainSelector, destChainSelector, onRamp, version }

  const offRamp = await fetchOffRamp(dest, lane)
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
