import { bcs } from '@mysten/sui/bcs'
import { concat } from 'ethers'

import { type SuiExtraArgsV1, SuiExtraArgsV1Tag } from '../extra-args.ts'
import type { ChainFamily } from '../networks.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'

/** Sui-specific CCIP v1.6 message type with Sui extra args. */
export type CCIPMessage_V1_6_Sui = CCIPMessage_V1_6 & SuiExtraArgsV1

/**
 * Unsigned Sui transaction, serialized via Transaction#serialize().
 * Reconstruct with Transaction.from(transactions[0]).
 */
export type UnsignedSuiTx = {
  family: typeof ChainFamily.Sui
  transactions: [string]
}

export const SuiExtraArgsV1Codec = bcs.struct('SuiExtraArgsV1', {
  gasLimit: bcs.u128(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.fixedArray(32, bcs.u8()),
  receiverObjectIds: bcs.vector(bcs.fixedArray(32, bcs.u8())),
})

/** Token amount data structure for Sui CCIP messages. */
export type SuiTokenAmount = {
  source_pool_address?: string
  dest_token_address?: number[]
  extra_data?: number[]
  amount?: string | number
  dest_exec_data?: number[]
  dest_gas_amount?: string | number
}

/**
 * Encodes Sui v1 extra arguments using BCS encoding.
 * @param args - Sui extra arguments to encode.
 * @returns Encoded bytes with tag prefix.
 */
export function encodeSuiExtraArgsV1(args: SuiExtraArgsV1): string {
  const tokenReceiver = Array.from(getAddressBytes(args.tokenReceiver)) as number[] & {
    length: 32
  }
  const receiverObjectIds = args.receiverObjectIds.map(
    (id) => Array.from(getDataBytes(id)) as number[] & { length: 32 },
  )
  const bcsData = SuiExtraArgsV1Codec.serialize({ ...args, tokenReceiver, receiverObjectIds })
  return concat([SuiExtraArgsV1Tag, bcsData.toBytes()])
}

/**
 * The ccip package's fee quoter configuration for one destination chain:
 * `ccip::fee_quoter`'s `StaticConfig` (which is global to the deployment) merged
 * with its `DestChainConfig` for that chain, mirroring the EVM FeeQuoter.
 */
export type SuiFeeQuoterConfig = {
  /** Maximum fee, in LINK juels, chargeable for a single message. */
  maxFeeJuelsPerMsg: bigint
  /** CoinMetadata address of the LINK token. */
  linkToken: string
  /** How long a token price stays usable, in seconds. */
  tokenPriceStalenessThreshold: bigint
  /** CoinMetadata addresses accepted as fee tokens. */
  feeTokens: string[]
  /** Whether this destination chain is enabled. */
  isEnabled: boolean
  /** Maximum number of distinct tokens transferred per message. */
  maxNumberOfTokensPerMsg: number
  /** Maximum `data` payload size, in bytes. */
  maxDataBytes: number
  /** Maximum gas limit a message may request. */
  maxPerMsgGasLimit: bigint
  /** Gas charged on top of the gas limit to cover destination chain costs. */
  destGasOverhead: number
  /** Default dest-chain gas charged per byte of `data` payload. */
  destGasPerPayloadByteBase: number
  /** High dest-chain gas charged per byte of `data` payload (eip-7623). */
  destGasPerPayloadByteHigh: number
  /** Payload size at which billing switches from the base to the high rate. */
  destGasPerPayloadByteThreshold: number
  /** Data availability gas charged for overhead costs, e.g. for OCR. */
  destDataAvailabilityOverheadGas: number
  /** Gas charged per byte of message data needing availability. */
  destGasPerDataAvailabilityByte: number
  /** Multiplier for data availability gas, in multiples of 0.0001. */
  destDataAvailabilityMultiplierBps: number
  /** Selector identifying the destination chain's family. */
  chainFamilySelector: string
  /** Whether `allowOutOfOrderExecution` must be true in extraArgs. */
  enforceOutOfOrder: boolean
  /** Default fee charged per token transfer, in multiples of 0.01 USD. */
  defaultTokenFeeUsdCents: number
  /** Default gas charged to execute a token transfer on the destination chain. */
  defaultTokenDestGasOverhead: number
  /** Default gas limit for a message. */
  defaultTxGasLimit: bigint
  /** Multiplier for gas costs, 1e18-based, so 11e17 is 10% extra. */
  gasMultiplierWeiPerEth: bigint
  /** How long a gas price stays usable, in seconds (0 disables the check). */
  gasPriceStalenessThreshold: number
  /** Flat network fee per message, in multiples of 0.01 USD. */
  networkFeeUsdCents: number
}

/**
 * `ccip::rmn_remote`'s state, which is global to the deployment.
 *
 * Sui has no RMNProxy indirection, so there is no `getARM()` to unwrap as on EVM:
 * `rmn_remote` *is* the RMN, i.e. the equivalent of what EVM's proxy returns.
 */
export type SuiRmnRemoteConfig = {
  /** Config version, `config_count` on-chain; 0 means RMN was never configured. */
  version: number
  /** Digest of the RMNHome config this RMNRemote is configured against. */
  rmnHomeContractConfigDigest: string
  /** Number of signatures required to bless a report. */
  fSign: bigint
  /** Blessing signers. */
  signers: { onchainPublicKey: string; nodeIndex: bigint }[]
  /** Currently cursed subjects; a lane is blocked while its subject is cursed. */
  cursedSubjects: string[]
  /** Whether the global curse subject is active, which curses every lane. */
  isCursedGlobal: boolean
}

/** `ccip::rmn_remote::RMNRemoteState`, as rendered by the JSON-RPC. */
export type SuiRmnRemoteStateFields = {
  local_chain_selector: string
  config_count: number
  config: {
    fields: {
      rmn_home_contract_config_digest: number[]
      signers: { fields: { onchain_public_key: number[]; node_index: string } }[]
      f_sign: string
    }
  }
  cursed_subjects: { fields: { contents: { fields: { key: number[]; value: boolean } }[] } }
}

/** `ccip_onramp::onramp::OnRampState`, as rendered by the JSON-RPC. */
export type SuiOnRampStateFields = {
  chain_selector: string
  fee_aggregator: string
  allowlist_admin: string
  dest_chain_configs: { fields: { id: { id: string } } }
  ownable_state: { fields: { owner: string } }
}

/** `ccip_onramp::onramp::DestChainConfig`, as rendered by the JSON-RPC. */
export type SuiOnRampDestChainConfigFields = {
  sequence_number: string
  allowlist_enabled: boolean
  allowed_senders: string[]
  /** the *remote* chain's router, in that chain's address format */
  router: string
}

/** `ccip_offramp::offramp::OffRampState`, as rendered by the JSON-RPC. */
export type SuiOffRampStateFields = {
  chain_selector: string
  permissionless_execution_threshold_seconds: number
  latest_price_sequence_number: string
  source_chain_configs: {
    fields: { contents: { fields: { key: string; value: { fields: unknown } } }[] }
  }
  ownable_state: { fields: { owner: string } }
}

/** `ccip_offramp::offramp::SourceChainConfig`, as rendered by the JSON-RPC. */
export type SuiOffRampSourceChainConfigFields = {
  router: string
  is_enabled: boolean
  min_seq_nr: string
  is_rmn_verification_disabled: boolean
  on_ramp: number[]
}

/**
 * Sui-specific CCIP message log structure from events.
 */
export type SuiCCIPMessageLog = {
  dest_chain_selector: string
  message: {
    data: number[]
    extra_args: number[]
    fee_token: string
    fee_token_amount: string
    fee_value_juels: string
    header: {
      dest_chain_selector: string
      message_id: number[]
      nonce: string
      sequence_number: string
      source_chain_selector: string
    }
    receiver: number[]
    sender: string
    token_amounts: SuiTokenAmount[]
  }
  sequence_number: string
}
