/**
 * getMintBurnRoles — reads the addresses currently holding MINTER/BURNER roles on
 * a CrossChainToken.
 *
 * CrossChainToken uses non-enumerable OZ AccessControl (no `getRoleMember`), so we
 * scan `RoleGranted` events and confirm each candidate still holds the role via
 * `hasRole`. Read-only — not a write {@link Operation}.
 *
 * @packageDocumentation
 */

import { AbiCoder, Contract, id } from 'ethers'

import { interfaces } from '../../../evm/const.ts'
import type { EVMChain } from '../../../evm/index.ts'
import { getEvmLogs } from '../../../evm/logs.ts'
import type { ChainLog } from '../../../types.ts'

/** Addresses holding the mint/burn roles on a token. */
export type MintBurnRolesResult = {
  /** Addresses with the MINTER_ROLE. */
  minters: string[]
  /** Addresses with the BURNER_ROLE. */
  burners: string[]
}

const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

/** Reads the current MINTER/BURNER role holders on a CrossChainToken. */
export async function getMintBurnRoles(
  chain: EVMChain,
  tokenAddress: string,
): Promise<MintBurnRolesResult> {
  const contract = new Contract(tokenAddress, interfaces.CrossChainToken, chain.provider)
  const roleGrantedTopic = interfaces.CrossChainToken.getEvent('RoleGranted')!.topicHash

  const scanCandidates = async (roleTopic: string): Promise<string[]> => {
    const logs: ChainLog[] = []
    for await (const log of getEvmLogs(
      { address: tokenAddress, topics: [[roleGrantedTopic], roleTopic], startBlock: 1 },
      chain,
    )) {
      logs.push(log)
    }
    // indexed `account` is topic[2]
    return [
      ...new Set(
        logs.map((l) => AbiCoder.defaultAbiCoder().decode(['address'], l.topics[2]!)[0] as string),
      ),
    ]
  }

  const verify = async (candidates: string[], roleHash: string): Promise<string[]> => {
    const checks = await Promise.all(
      candidates.map((addr) =>
        (contract.getFunction('hasRole')(roleHash, addr) as Promise<boolean>).then((has) =>
          has ? addr : null,
        ),
      ),
    )
    return checks.filter((a): a is string => a !== null)
  }

  const [minterCandidates, burnerCandidates] = await Promise.all([
    scanCandidates(MINTER_ROLE),
    scanCandidates(BURNER_ROLE),
  ])
  const [minters, burners] = await Promise.all([
    verify(minterCandidates, MINTER_ROLE),
    verify(burnerCandidates, BURNER_ROLE),
  ])

  chain.logger.debug(
    `getMintBurnRoles: token=${tokenAddress}, minters=${minters.length}, burners=${burners.length}`,
  )
  return { minters, burners }
}
