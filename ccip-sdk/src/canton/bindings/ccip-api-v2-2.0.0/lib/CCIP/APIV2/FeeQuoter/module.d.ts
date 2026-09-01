// Generated from ../../../CCIP/APIV2/FeeQuoter/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 from '@daml.js/daml-prim-DA-Types-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type IFeeQuoter = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.FeeQuoter:IFeeQuoter'> & FeeQuoterView
export declare interface IFeeQuoterInterface {
  Archive:
    damlTypes.Choice<IFeeQuoter, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_GetDestinationChainGasPrice:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_GetDestinationChainGasPrice, TimestampedPrice, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_GetFeeTokens:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_GetFeeTokens, pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_GetTokenPrice:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_GetTokenPrice, TimestampedPrice, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_GetTokenTransferFee:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_GetTokenTransferFee, pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3<damlTypes.Numeric, damlTypes.Int, damlTypes.Int>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_PublicFetch:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_PublicFetch, FeeQuoterView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
  FeeQuoter_QuoteGasForExec:
    damlTypes.Choice<IFeeQuoter, FeeQuoter_QuoteGasForExec, QuoteGasForExecResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IFeeQuoter, undefined>>;
}
export declare const IFeeQuoter:
  damlTypes.InterfaceCompanion<IFeeQuoter, undefined, '#ccip-api-v2:CCIP.APIV2.FeeQuoter:IFeeQuoter'> &
  damlTypes.FromTemplate<IFeeQuoter, unknown> &
  IFeeQuoterInterface

export declare type FeeQuoterView = {
  ccipOwner: damlTypes.Party,
  instanceId: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const FeeQuoterView:
  damlTypes.Serializable<FeeQuoterView>

export declare type FeeQuoter_GetDestinationChainGasPrice = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_GetDestinationChainGasPrice:
  damlTypes.Serializable<FeeQuoter_GetDestinationChainGasPrice>

export declare type FeeQuoter_GetFeeTokens = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_GetFeeTokens:
  damlTypes.Serializable<FeeQuoter_GetFeeTokens>

export declare type FeeQuoter_GetTokenPrice = {
  token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_GetTokenPrice:
  damlTypes.Serializable<FeeQuoter_GetTokenPrice>

export declare type FeeQuoter_GetTokenTransferFee = {
  destChainSelector: damlTypes.Numeric,
  token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_GetTokenTransferFee:
  damlTypes.Serializable<FeeQuoter_GetTokenTransferFee>

export declare type FeeQuoter_PublicFetch = {
  expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_PublicFetch:
  damlTypes.Serializable<FeeQuoter_PublicFetch>

export declare type FeeQuoter_QuoteGasForExec = {
  destChainSelector: damlTypes.Numeric,
  nonCalldataGas: damlTypes.Int,
  calldataSize: damlTypes.Int,
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeQuoter_QuoteGasForExec:
  damlTypes.Serializable<FeeQuoter_QuoteGasForExec>

export declare type QuoteGasForExecResult = {
  totalGas: damlTypes.Int,
  gasCostUSDCents: damlTypes.Numeric,
  feeTokenPrice: damlTypes.Numeric,
  premiumMultiplier: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const QuoteGasForExecResult:
  damlTypes.Serializable<QuoteGasForExecResult>

export declare type TimestampedPrice = {
  price: damlTypes.Numeric,
  timestamp: damlTypes.Time,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const TimestampedPrice:
  damlTypes.Serializable<TimestampedPrice>
