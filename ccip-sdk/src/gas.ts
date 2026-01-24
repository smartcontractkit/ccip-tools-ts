import {
  type BytesLike,
  type JsonRpcApiProvider,
  Contract,
  FunctionFragment,
  concat,
  formatUnits,
  getAddress,
  getNumber,
  hexlify,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'

import type { Chain } from './chain.ts'
import {
  CCIPLegacyTokenPoolsUnsupportedError,
  CCIPTokenDecimalsInsufficientError,
} from './errors/index.ts'
import TokenABI from './evm/abi/BurnMintERC677Token.ts'
import RouterABI from './evm/abi/Router.ts'
import { defaultAbiCoder, interfaces } from './evm/const.ts'
import type { EVMChain } from './evm/index.ts'
import { discoverOffRamp } from './execution.ts'
import type { Lane } from './types.ts'

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

const transferFragment = interfaces.Token.getFunction('transfer')!

/**
 * Finds suitable token balance slot by simulating a fake transfer between 2 non-existent accounts,
 * with state overrides for the holders' balance, which reverts if override slot is wrong
 */
const findBalancesSlot = memoize(
  async function findBalancesSlot_(token: string, provider: JsonRpcApiProvider): Promise<number> {
    const fakeHolder = getAddress(hexlify(randomBytes(20)))
    const fakeRecipient = getAddress(hexlify(randomBytes(20)))
    const fakeAmount = 1e7

    const calldata = concat([
      transferFragment.selector,
      defaultAbiCoder.encode(transferFragment.inputs, [fakeRecipient, fakeAmount]),
    ])
    let firstErr
    // try range(0..15), but start with most probable 0 (common ERC20) and 9 (USDC)
    for (const slot of [0, 9, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]) {
      try {
        await provider.send('eth_estimateGas', [
          { from: fakeHolder, to: token, data: calldata },
          'latest',
          {
            [token]: {
              stateDiff: {
                [solidityPackedKeccak256(['uint256', 'uint256'], [fakeHolder, slot])]: toBeHex(
                  fakeAmount,
                  32,
                ),
              },
            },
          },
        ])
        return slot // if didn't reject
      } catch (err) {
        firstErr ??= err
      }
    }
    throw firstErr as Error
  },
  { maxArgs: 1 },
)

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
      const tokenContract = new Contract(
        token,
        TokenABI,
        dest.provider,
      ) as unknown as TypedContract<typeof TokenABI>
      const currentBalance = await tokenContract.balanceOf(request.message.receiver)
      destAmounts[token] = currentBalance
    }
    destAmounts[token]! += amount
    const balancesSlot = await findBalancesSlot(token, dest.provider)
    stateOverrides[token] = {
      stateDiff: {
        [solidityPackedKeccak256(['uint256', 'uint256'], [request.message.receiver, balancesSlot])]:
          toBeHex(destAmounts[token]!, 32),
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
