import {
  type BytesLike,
  Contract,
  FunctionFragment,
  concat,
  formatUnits,
  getNumber,
  hexlify,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { Chain } from './chain.ts'
import {
  CCIPLegacyTokenPoolsUnsupportedError,
  CCIPTokenDecimalsInsufficientError,
} from './errors/index.ts'
import TokenABI from './evm/abi/BurnMintERC677Token.ts'
import RouterABI from './evm/abi/Router.ts'
import { defaultAbiCoder } from './evm/const.ts'
import type { EVMChain } from './evm/index.ts'
import { discoverOffRamp } from './execution.ts'
import type { Lane } from './types.ts'

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

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver.
 * @param source - Provider for the source chain.
 * @param dest - Provider for the destination chain.
 * @param request - CCIP request info containing `lane` and `message` details.
 * @returns Estimated gasLimit as bigint.
 */
export async function estimateExecGasForRequest(
  source: Chain,
  dest: EVMChain,
  request: {
    lane: Lane
    message: {
      sender: string
      receiver: string
      data: BytesLike
      tokenAmounts: readonly {
        sourcePoolAddress: string
        destTokenAddress: string
        amount: bigint
      }[]
    }
  },
) {
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)
  const destRouter = await dest.getRouterForOffRamp(offRamp, request.lane.sourceChainSelector)

  const destTokenAmounts = await Promise.all(
    request.message.tokenAmounts.map(async (ta) => {
      if (!('destTokenAddress' in ta)) throw new CCIPLegacyTokenPoolsUnsupportedError()
      const [{ decimals: sourceDecimals }, { decimals: destDecimals }] = await Promise.all([
        source
          .getTokenForTokenPool(ta.sourcePoolAddress)
          .then((token) => source.getTokenInfo(token)),
        dest.getTokenInfo(ta.destTokenAddress),
      ])
      const destAmount =
        (ta.amount * 10n ** BigInt(destDecimals - sourceDecimals + 36)) / 10n ** 36n
      if (destAmount === 0n)
        throw new CCIPTokenDecimalsInsufficientError(
          ta.destTokenAddress,
          destDecimals,
          dest.network.name,
          formatUnits(ta.amount, sourceDecimals),
        )
      return { token: ta.destTokenAddress, amount: destAmount }
    }),
  )

  const message: Any2EVMMessage = {
    messageId: hexlify(randomBytes(32)),
    sender: zeroPadValue(request.message.sender, 32),
    data: hexlify(request.message.data),
    sourceChainSelector: request.lane.sourceChainSelector,
    destTokenAmounts,
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
      const currentBalance = await tokenContract.balanceOf(request.message.receiver)
      destAmounts[token] = currentBalance
    }
    destAmounts[token] += amount
    stateOverrides[token] = {
      stateDiff: {
        [solidityPackedKeccak256(
          ['uint256', 'uint256'],
          [request.message.receiver, BALANCES_SLOT],
        )]: toBeHex(destAmounts[token], 32),
      },
    }
  }

  const calldata = concat([
    ccipReceive.selector,
    defaultAbiCoder.encode(ccipReceive.inputs, [message]),
  ])

  return (
    getNumber(
      (await dest.provider.send('eth_estimateGas', [
        {
          from: destRouter,
          to: request.message.receiver,
          data: calldata,
        },
        'latest',
        ...(Object.keys(stateOverrides).length ? [stateOverrides] : []),
      ])) as string,
    ) -
    (21_000 - 700) // 21k is the base gas cost for a transaction, 700 is the gas cost of the call
  )
}
