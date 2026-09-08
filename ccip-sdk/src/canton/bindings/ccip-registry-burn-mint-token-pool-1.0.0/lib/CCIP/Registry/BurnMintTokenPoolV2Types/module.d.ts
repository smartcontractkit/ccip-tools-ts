// Generated from ../../../CCIP/Registry/BurnMintTokenPoolV2Types/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@daml.js/ccip-codec-v2-2.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type AddPoolReceiveContextContractValueParams = {
  contextKey: string,
  referentInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const AddPoolReceiveContextContractValueParams:
  damlTypes.Serializable<AddPoolReceiveContextContractValueParams>

export declare type AddPoolReceiveContextNonContractValueParams = {
  contextKey: string,
  valuePayload: string,
}

export declare const AddPoolReceiveContextNonContractValueParams:
  damlTypes.Serializable<AddPoolReceiveContextNonContractValueParams>

export declare type ApplyChainUpdatesParams = {
  remoteChainSelectorsToRemove: damlTypes.Numeric[],
  chainsToAdd: ChainUpdate[],
}

export declare const ApplyChainUpdatesParams:
  damlTypes.Serializable<ApplyChainUpdatesParams>

export declare type ApplyTokenTransferFeeConfigUpdatesParams = {
  tokenTransferFeeConfigArgs: TokenTransferFeeConfigArgs[],
  disableTokenTransferFeeConfigArgs: damlTypes.Numeric[],
}

export declare const ApplyTokenTransferFeeConfigUpdatesParams:
  damlTypes.Serializable<ApplyTokenTransferFeeConfigUpdatesParams>

export declare type ChainUpdate = {
  remoteChainSelector: damlTypes.Numeric,
  remotePools: string[],
  remoteTokenAddress: string,
  inboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  outboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const ChainUpdate:
  damlTypes.Serializable<ChainUpdate>

export declare type LaneDeploySpec = {
  remoteChainSelector: damlTypes.Numeric,
  remotePools: string[],
  remoteTokenAddress: string,
  inboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  outboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  inbound: RateLimiterDeploySpec,
  outbound: RateLimiterDeploySpec,
  inboundCustomFinality: RateLimiterDeploySpec,
}

export declare const LaneDeploySpec:
  damlTypes.Serializable<LaneDeploySpec>

export declare type RateLimitConfigArgs = {
  remoteChainSelector: damlTypes.Numeric,
  inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const RateLimitConfigArgs:
  damlTypes.Serializable<RateLimitConfigArgs>

export declare type RateLimiterDeploySpec = {
  instanceId: string,
  isEnabled: boolean,
  capacity: damlTypes.Numeric,
  rate: damlTypes.Numeric,
}

export declare const RateLimiterDeploySpec:
  damlTypes.Serializable<RateLimiterDeploySpec>

export declare type RemoteChainConfig = {
  remotePools: string[],
  remoteTokenAddress: string,
  inboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  outboundCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const RemoteChainConfig:
  damlTypes.Serializable<RemoteChainConfig>

export declare type RemovePoolReceiveContextValueParams = {
  contextKey: string,
}

export declare const RemovePoolReceiveContextValueParams:
  damlTypes.Serializable<RemovePoolReceiveContextValueParams>

export declare type SetDynamicConfigParams = {
  rateLimitAdmin: damlTypes.Optional<damlTypes.Party>,
}

export declare const SetDynamicConfigParams:
  damlTypes.Serializable<SetDynamicConfigParams>

export declare type SetObserversParams = {
  observers: damlTypes.Party[],
}

export declare const SetObserversParams:
  damlTypes.Serializable<SetObserversParams>

export declare type SetRateLimitConfigParams = {
  caller: damlTypes.Party,
  rateLimiterInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  newIsEnabled: boolean,
  newCapacity: damlTypes.Numeric,
  newRate: damlTypes.Numeric,
}

export declare const SetRateLimitConfigParams:
  damlTypes.Serializable<SetRateLimitConfigParams>

export declare type SetRateLimiterReferencesParams = {
  rateLimitConfigArgs: RateLimitConfigArgs[],
}

export declare const SetRateLimiterReferencesParams:
  damlTypes.Serializable<SetRateLimiterReferencesParams>

export declare type SetTransferTimeoutParams = {
  transferTimeout: TransferTimeout,
}

export declare const SetTransferTimeoutParams:
  damlTypes.Serializable<SetTransferTimeoutParams>

export declare type TokenTransferFeeConfig = {
  isEnabled: boolean,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  feeUSDCents: damlTypes.Numeric,
  feeBps: damlTypes.Numeric,
}

export declare const TokenTransferFeeConfig:
  damlTypes.Serializable<TokenTransferFeeConfig>

export declare type TokenTransferFeeConfigArgs = {
  destChainSelector: damlTypes.Numeric,
  isEnabled: boolean,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  feeUSDCents: damlTypes.Numeric,
  feeBps: damlTypes.Numeric,
}

export declare const TokenTransferFeeConfigArgs:
  damlTypes.Serializable<TokenTransferFeeConfigArgs>

export declare type TransferTimeout =
  | { tag: 'Indefinite'; value: {} }
  | { tag: 'RelativeHours'; value: damlTypes.Int }


export declare const TransferTimeout:
  damlTypes.Serializable<TransferTimeout>
