import {
  type JsonRpcApiProvider,
  Contract,
  FunctionFragment,
  concat,
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

import type { Chain } from '../chain.ts'
import TokenABI from './abi/BurnMintERC677Token.ts'
import RouterABI from './abi/Router.ts'
import { defaultAbiCoder, interfaces } from './const.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'

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

type EstimateExecGasOpts = Pick<
  Parameters<NonNullable<Chain['estimateReceiveExecution']>>[0],
  'message' | 'receiver'
> & {
  /*  */
  provider: JsonRpcApiProvider
  router: string
}

/**
 * Estimate gasLimit needed to execute a request on a receiver contract.
 * @param opts - Options for estimation: provider, destRouter, receiver address and message
 * @returns Estimated gasLimit
 */
export async function estimateExecGas({
  provider,
  router,
  receiver,
  message,
}: EstimateExecGasOpts) {
  // we need to override the state, increasing receiver's balance for each token, to simulate the
  // state after tokens were transferred by the offRamp just before calling `ccipReceive`
  const destAmounts: Record<string, bigint> = {}
  const stateOverrides: Record<string, { stateDiff: Record<string, string> }> = {}
  for (const { token, amount } of message.destTokenAmounts ?? []) {
    if (!(token in destAmounts)) {
      const tokenContract = new Contract(token, TokenABI, provider) as unknown as TypedContract<
        typeof TokenABI
      >
      const currentBalance = await tokenContract.balanceOf(receiver)
      destAmounts[token] = currentBalance
    }
    destAmounts[token]! += amount
    const balancesSlot = await findBalancesSlot(token, provider)
    stateOverrides[token] = {
      stateDiff: {
        [solidityPackedKeccak256(['uint256', 'uint256'], [receiver, balancesSlot])]: toBeHex(
          destAmounts[token]!,
          32,
        ),
      },
    }
  }

  const receiverMsg: Any2EVMMessage = {
    ...message,
    destTokenAmounts: message.destTokenAmounts ?? [],
    sender: zeroPadValue(getAddressBytes(message.sender ?? '0x'), 32),
    data: hexlify(getDataBytes(message.data || '0x')),
    sourceChainSelector: message.sourceChainSelector,
  }
  const calldata = concat([
    ccipReceive.selector,
    defaultAbiCoder.encode(ccipReceive.inputs, [receiverMsg]),
  ])

  return (
    getNumber(
      (await provider.send('eth_estimateGas', [
        {
          from: router,
          to: receiver,
          data: calldata,
        },
        'latest',
        ...(Object.keys(stateOverrides).length ? [stateOverrides] : []),
      ])) as string,
    ) -
    (21_000 - 700) // 21k is the base gas cost for a transaction, 700 is the gas cost of the call
  )
}
