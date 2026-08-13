import {
  type BytesLike,
  type JsonRpcApiProvider,
  Contract,
  FunctionFragment,
  concat,
  dataSlice,
  getAddress,
  getBigInt,
  getNumber,
  hexlify,
  id,
  keccak256,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  toBigInt,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import { memoize } from 'micro-memoize'

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

// keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))
function erc7201(namespace: string): bigint {
  const inner = getBigInt(id(namespace))
  const encoded = defaultAbiCoder.encode(['uint256'], [inner - 1n])
  const hash = keccak256(encoded)
  return toBigInt(dataSlice(hash, 0, 31) + '00') // & ~bytes32(uint256(0xff))
}

/**
 * Finds suitable token balance slot by simulating a fake transfer between 2 non-existent accounts,
 * with state overrides for the holders' balance, which reverts if override slot is wrong
 */
export const findBalancesSlot = memoize(
  async function findBalancesSlot_(
    token: string,
    provider: JsonRpcApiProvider,
    holder: string = getAddress(hexlify(randomBytes(20))),
    recipient: string = getAddress(hexlify(randomBytes(20))),
  ): Promise<bigint> {
    const contract = new Contract(token, interfaces.Token, provider) as unknown as TypedContract<
      typeof TokenABI
    >
    const fakeAmount = (await contract.totalSupply()) + 1n
    const calldata = interfaces.Token.encodeFunctionData('transfer', [recipient, fakeAmount])

    let firstErr
    // try range(0..15), but start with most probable 0 (common ERC20) and 9 (USDC)
    for (const slot of [
      0,
      9,
      erc7201('openzeppelin.storage.ERC20'), // OpenZepellin's ERC20Upgradeable/ERC1967 proxy
      ...Array.from({ length: 15 })
        .map((_, i) => i + 1)
        .filter((i) => i !== 9),
    ]) {
      const storage = solidityPackedKeccak256(['uint256', 'uint256'], [holder, slot])
      try {
        await provider.send('eth_estimateGas', [
          { from: holder, to: token, data: calldata },
          'latest',
          {
            [token]: {
              stateDiff: {
                [storage]: toBeHex(fakeAmount, 32),
              },
            },
          },
        ])
        return BigInt(slot) // if didn't reject
      } catch (err) {
        firstErr ??= err
      }
    }
    throw firstErr as Error
  },
  { maxArgs: 1 },
)

type EstimateExecGasOpts = {
  provider: JsonRpcApiProvider
  router: string
  message: {
    sourceChainSelector: bigint
    messageId: string
    receiver: string
    sender?: string
    data?: BytesLike
    destTokenAmounts?: readonly { token: string; amount: bigint }[]
  }
}

/**
 * Estimate gasLimit needed to execute a request on a receiver contract.
 * @param opts - Options for estimation: provider, destRouter, receiver address and message
 * @returns Estimated gasLimit
 */
export async function estimateExecGas({ provider, router, message }: EstimateExecGasOpts) {
  // we need to override the state, increasing receiver's balance for each token, to simulate the
  // state after tokens were transferred by the offRamp just before calling `ccipReceive`
  const destAmounts: Record<string, bigint> = {}
  const stateOverrides: Record<string, { stateDiff: Record<string, string> }> = {}
  for (const { token, amount } of message.destTokenAmounts ?? []) {
    if (!(token in destAmounts)) {
      const tokenContract = new Contract(token, TokenABI, provider) as unknown as TypedContract<
        typeof TokenABI
      >
      const currentBalance = await tokenContract.balanceOf(message.receiver)
      destAmounts[token] = currentBalance
    }
    destAmounts[token]! += amount
    const balancesSlot = await findBalancesSlot(token, provider, message.receiver, router)
    stateOverrides[token] = {
      stateDiff: {
        [solidityPackedKeccak256(['uint256', 'uint256'], [message.receiver, balancesSlot])]:
          toBeHex(destAmounts[token]!, 32),
      },
    }
  }

  const senderBytes = getAddressBytes(message.sender ?? '0x')
  const receiverMsg: Any2EVMMessage = {
    ...message,
    destTokenAmounts: message.destTokenAmounts ?? [],
    sender: senderBytes.length < 32 ? zeroPadValue(senderBytes, 32) : hexlify(senderBytes),
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
          to: message.receiver,
          data: calldata,
        },
        'latest',
        ...(Object.keys(stateOverrides).length ? [stateOverrides] : []),
      ])) as string,
    ) -
    (21_000 - 700) // 21k is the base gas cost for a transaction, 700 is the gas cost of the call
  )
}
