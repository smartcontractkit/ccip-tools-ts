import {
  type JsonRpcApiProvider,
  Contract,
  FunctionFragment,
  concat,
  getNumber,
  hexlify,
  randomBytes,
  solidityPackedKeccak256,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from '../abi/BurnMintERC677Token.js'
import RouterABI from '../abi/Router.js'
import { discoverOffRamp, validateOffRamp } from './execution.js'
import {
  type CCIPContract,
  type CCIPContractType,
  type CCIPMessage,
  type Lane,
  CCIPVersion,
  defaultAbiCoder,
} from './types.js'
import { networkInfo } from './utils.js'

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
  dest: JsonRpcApiProvider,
  request: {
    lane: Lane
    message: Pick<CCIPMessage, 'sender' | 'receiver' | 'data'> & {
      tokenAmounts: readonly Pick<
        CCIPMessage['tokenAmounts'][number],
        'destTokenAddress' | 'amount'
      >[]
    }
  },
  hints?: { offRamp?: string; page?: number },
) {
  let offRamp
  const lane = request.lane
  if (hints?.offRamp) {
    offRamp = await validateOffRamp(dest, hints.offRamp, lane)
    if (!offRamp)
      throw new Error(
        `Invalid offRamp for "${networkInfo(lane.sourceChainSelector).name}" -> "${networkInfo(lane.destChainSelector).name}" (onRamp=${lane.onRamp}) lane`,
      )
  } else {
    offRamp = await discoverOffRamp(dest, lane, hints)
  }
  let destRouter
  if (lane.version < CCIPVersion.V1_6) {
    ;({ router: destRouter } = await (
      offRamp as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_5>
    ).getDynamicConfig())
  } else {
    ;({ router: destRouter } = await (
      offRamp as CCIPContract<CCIPContractType.OffRamp, CCIPVersion.V1_6>
    ).getSourceChainConfig(lane.sourceChainSelector))
  }

  const destTokenAmounts = []
  for (const { destTokenAddress: token, amount } of request.message.tokenAmounts) {
    if (!token) throw new Error('legacy <1.5 tokenPools not supported')
    destTokenAmounts.push({ token, amount })
  }

  const message: Any2EVMMessage = {
    messageId: hexlify(randomBytes(32)),
    sender: zeroPadValue(request.message.sender, 32),
    data: request.message.data,
    sourceChainSelector: lane.sourceChainSelector,
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
      (await dest.send('eth_estimateGas', [
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
