// Generated from ../../../CCIP/CoreV2/FeeQuoter/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 from '@daml.js/daml-prim-DA-Types-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff from '@daml.js/daml-stdlib-DA-Set-Types-1.0.0';

import * as CCIP_CoreV2_FeeQuoterTypes from '../../../CCIP/CoreV2/FeeQuoterTypes/module';

export declare type AddPriceUpdaters = {
  parties: damlTypes.Party[],
}

export declare const AddPriceUpdaters:
  damlTypes.Serializable<AddPriceUpdaters>

export declare type ApplyFeeQuoterDestChainConfigUpdates = {
  destChainConfigArgs: CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfigArgs[],
}

export declare const ApplyFeeQuoterDestChainConfigUpdates:
  damlTypes.Serializable<ApplyFeeQuoterDestChainConfigUpdates>

export declare type ApplyPriceUpdatersUpdate = {
  addedPriceUpdaters: damlTypes.Party[],
  removedPriceUpdaters: damlTypes.Party[],
}

export declare const ApplyPriceUpdatersUpdate:
  damlTypes.Serializable<ApplyPriceUpdatersUpdate>

export declare type FeeQuoter = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  feeTokens: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId>,
  destChainConfigs: damlTypes.Map<damlTypes.Numeric, CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig>,
  tokenTransferFeeConfigs: damlTypes.Map<damlTypes.Numeric, damlTypes.Map<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, TokenTransferFeeConfig>>,
  usdPerUnitGasByDestChainSelector: damlTypes.Map<damlTypes.Numeric, TimestampedPrice>,
  usdPerToken: damlTypes.Map<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId, TimestampedPrice>,
  linkTokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  priceUpdaters: damlTypes.Party[],
}

export declare interface FeeQuoterInterface {
  AddPriceUpdaters: 
    damlTypes.Choice<FeeQuoter, AddPriceUpdaters, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  ApplyFeeQuoterDestChainConfigUpdates: 
    damlTypes.Choice<FeeQuoter, ApplyFeeQuoterDestChainConfigUpdates, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  ApplyPriceUpdatersUpdate: 
    damlTypes.Choice<FeeQuoter, ApplyPriceUpdatersUpdate, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  Archive: 
    damlTypes.Choice<FeeQuoter, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  Get: 
    damlTypes.Choice<FeeQuoter, Get, FeeQuoter, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  GetDestChainConfig: 
    damlTypes.Choice<FeeQuoter, GetDestChainConfig, CCIP_CoreV2_FeeQuoterTypes.FeeQuoterDestChainConfig, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  GetDestinationChainGasPrice: 
    damlTypes.Choice<FeeQuoter, GetDestinationChainGasPrice, TimestampedPrice, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  GetFeeTokens: 
    damlTypes.Choice<FeeQuoter, GetFeeTokens, pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  GetTokenPrice: 
    damlTypes.Choice<FeeQuoter, GetTokenPrice, TimestampedPrice, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  GetTokenTransferFee: 
    damlTypes.Choice<FeeQuoter, GetTokenTransferFee, pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3<damlTypes.Numeric, damlTypes.Int, damlTypes.Int>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  QuoteGasForExec: 
    damlTypes.Choice<FeeQuoter, QuoteGasForExec, QuoteGasForExecResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  RemoveFeeTokens: 
    damlTypes.Choice<FeeQuoter, RemoveFeeTokens, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  RemovePriceUpdaters: 
    damlTypes.Choice<FeeQuoter, RemovePriceUpdaters, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
  UpdatePrices: 
    damlTypes.Choice<FeeQuoter, UpdatePrices, damlTypes.ContractId<FeeQuoter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<FeeQuoter, undefined>>;
}
export declare const FeeQuoter:
  damlTypes.Template<FeeQuoter, undefined, '#ccip-core-v2:CCIP.CoreV2.FeeQuoter:FeeQuoter'> &
  damlTypes.ToInterface<FeeQuoter, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  FeeQuoterInterface

export declare type Get = {
  caller: damlTypes.Party,
}

export declare const Get:
  damlTypes.Serializable<Get>

export declare type GetDestChainConfig = {
  destChainSelector: damlTypes.Numeric,
  caller: damlTypes.Party,
}

export declare const GetDestChainConfig:
  damlTypes.Serializable<GetDestChainConfig>

export declare type GetDestinationChainGasPrice = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetDestinationChainGasPrice:
  damlTypes.Serializable<GetDestinationChainGasPrice>

export declare type GetFeeTokens = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetFeeTokens:
  damlTypes.Serializable<GetFeeTokens>

export declare type GetTokenPrice = {
  token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetTokenPrice:
  damlTypes.Serializable<GetTokenPrice>

export declare type GetTokenTransferFee = {
  destChainSelector: damlTypes.Numeric,
  token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetTokenTransferFee:
  damlTypes.Serializable<GetTokenTransferFee>

export declare type QuoteGasForExec = {
  destChainSelector: damlTypes.Numeric,
  nonCalldataGas: damlTypes.Int,
  calldataSize: damlTypes.Int,
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const QuoteGasForExec:
  damlTypes.Serializable<QuoteGasForExec>

export declare type QuoteGasForExecResult = {
  totalGas: damlTypes.Int,
  gasCostUSDCents: damlTypes.Numeric,
  feeTokenPrice: damlTypes.Numeric,
  premiumMultiplier: damlTypes.Numeric,
}

export declare const QuoteGasForExecResult:
  damlTypes.Serializable<QuoteGasForExecResult>

export declare type RemoveFeeTokens = {
  feeTokensToRemove: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId[],
}

export declare const RemoveFeeTokens:
  damlTypes.Serializable<RemoveFeeTokens>

export declare type RemovePriceUpdaters = {
  parties: damlTypes.Party[],
}

export declare const RemovePriceUpdaters:
  damlTypes.Serializable<RemovePriceUpdaters>

export declare type TimestampedPrice = {
  price: damlTypes.Numeric,
  timestamp: damlTypes.Time,
}

export declare const TimestampedPrice:
  damlTypes.Serializable<TimestampedPrice>

export declare type TokenTransferFeeConfig = {
  isEnabled: boolean,
  feeUSD: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
}

export declare const TokenTransferFeeConfig:
  damlTypes.Serializable<TokenTransferFeeConfig>

export declare type UpdatePrices = {
  priceUpdates: CCIP_CoreV2_FeeQuoterTypes.PriceUpdates,
  caller: damlTypes.Party,
}

export declare const UpdatePrices:
  damlTypes.Serializable<UpdatePrices>
