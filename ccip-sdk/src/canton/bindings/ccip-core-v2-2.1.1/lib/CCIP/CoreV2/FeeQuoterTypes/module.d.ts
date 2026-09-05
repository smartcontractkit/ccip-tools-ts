// Generated from ../../../CCIP/CoreV2/FeeQuoterTypes/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';

export declare type ApplyFeeQuoterDestChainConfigUpdatesParams = {
  destChainConfigArgs: FeeQuoterDestChainConfigArgs[],
}

export declare const ApplyFeeQuoterDestChainConfigUpdatesParams:
  damlTypes.Serializable<ApplyFeeQuoterDestChainConfigUpdatesParams>

export declare type ApplyPriceUpdatersUpdateParams = {
  addedPriceUpdaters: damlTypes.Party[],
  removedPriceUpdaters: damlTypes.Party[],
}

export declare const ApplyPriceUpdatersUpdateParams:
  damlTypes.Serializable<ApplyPriceUpdatersUpdateParams>

export declare type FeeQuoterDestChainConfig = {
  isEnabled: boolean,
  maxDataBytes: damlTypes.Int,
  maxPerMsgGasLimit: damlTypes.Int,
  destGasOverhead: damlTypes.Int,
  destGasPerPayloadByteBase: damlTypes.Int,
  defaultTxGasLimit: damlTypes.Int,
  linkFeeMultiplierPercent: damlTypes.Numeric,
  defaultTokenFeeUSD: damlTypes.Numeric,
  defaultTokenDestGasOverhead: damlTypes.Int,
}

export declare const FeeQuoterDestChainConfig:
  damlTypes.Serializable<FeeQuoterDestChainConfig>

export declare type FeeQuoterDestChainConfigArgs = {
  destChainSelector: damlTypes.Numeric,
  destChainConfig: FeeQuoterDestChainConfig,
}

export declare const FeeQuoterDestChainConfigArgs:
  damlTypes.Serializable<FeeQuoterDestChainConfigArgs>

export declare type GasPriceUpdate = {
  destChainSelector: damlTypes.Numeric,
  usdPerUnitGas: damlTypes.Numeric,
}

export declare const GasPriceUpdate:
  damlTypes.Serializable<GasPriceUpdate>

export declare type PriceUpdates = {
  tokenPriceUpdates: TokenPriceUpdate[],
  gasPriceUpdates: GasPriceUpdate[],
}

export declare const PriceUpdates:
  damlTypes.Serializable<PriceUpdates>

export declare type RemoveFeeTokensParams = {
  feeTokensToRemove: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId[],
}

export declare const RemoveFeeTokensParams:
  damlTypes.Serializable<RemoveFeeTokensParams>

export declare type TokenPriceUpdate = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  usdPerToken: damlTypes.Numeric,
}

export declare const TokenPriceUpdate:
  damlTypes.Serializable<TokenPriceUpdate>

export declare type UpdatePricesParams = {
  priceUpdates: PriceUpdates,
  caller: damlTypes.Party,
}

export declare const UpdatePricesParams:
  damlTypes.Serializable<UpdatePricesParams>
