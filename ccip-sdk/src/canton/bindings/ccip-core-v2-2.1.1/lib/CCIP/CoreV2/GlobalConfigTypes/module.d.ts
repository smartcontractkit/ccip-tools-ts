// Generated from ../../../CCIP/CoreV2/GlobalConfigTypes/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type ApplyDestChainConfigUpdatesParams = {
  destChainConfigArgs: DestChainConfigArgs[],
}

export declare const ApplyDestChainConfigUpdatesParams:
  damlTypes.Serializable<ApplyDestChainConfigUpdatesParams>

export declare type ApplySourceChainConfigUpdatesParams = {
  sourceChainConfigArgs: SourceChainConfigArgs[],
}

export declare const ApplySourceChainConfigUpdatesParams:
  damlTypes.Serializable<ApplySourceChainConfigUpdatesParams>

export declare type DestChainConfig = {
  isEnabled: boolean,
  addressBytesLength: damlTypes.Int,
  tokenReceiverAllowed: boolean,
  baseExecutionGasCost: damlTypes.Int,
  offRampAddress: string,
  defaultExecutor: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
  laneMandatedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  defaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  messageNetworkFeeUSDCents: damlTypes.Numeric,
  tokenNetworkFeeUSDCents: damlTypes.Numeric,
}

export declare const DestChainConfig:
  damlTypes.Serializable<DestChainConfig>

export declare type DestChainConfigArgs = {
  destChainSelector: damlTypes.Numeric,
  isEnabled: boolean,
  addressBytesLength: damlTypes.Int,
  tokenReceiverAllowed: boolean,
  baseExecutionGasCost: damlTypes.Int,
  offRampAddress: string,
  defaultExecutor: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
  laneMandatedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  defaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  messageNetworkFeeUSDCents: damlTypes.Numeric,
  tokenNetworkFeeUSDCents: damlTypes.Numeric,
}

export declare const DestChainConfigArgs:
  damlTypes.Serializable<DestChainConfigArgs>

export declare type SourceChainConfig = {
  isEnabled: boolean,
  onRampAddresses: string[],
  defaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  laneMandatedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const SourceChainConfig:
  damlTypes.Serializable<SourceChainConfig>

export declare type SourceChainConfigArgs = {
  sourceChainSelector: damlTypes.Numeric,
  isEnabled: boolean,
  onRampAddresses: string[],
  defaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  laneMandatedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const SourceChainConfigArgs:
  damlTypes.Serializable<SourceChainConfigArgs>
