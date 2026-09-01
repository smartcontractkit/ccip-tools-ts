// Generated from ../../../CCIP/APIV2/GlobalConfig/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type IGlobalConfig = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.GlobalConfig:IGlobalConfig'> & GlobalConfigView
export declare interface IGlobalConfigInterface {
  Archive:
    damlTypes.Choice<IGlobalConfig, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IGlobalConfig, undefined>>;
  GlobalConfig_GetDestChainConfig:
    damlTypes.Choice<IGlobalConfig, GlobalConfig_GetDestChainConfig, damlTypes.Optional<DestChainConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IGlobalConfig, undefined>>;
  GlobalConfig_GetSourceChainConfig:
    damlTypes.Choice<IGlobalConfig, GlobalConfig_GetSourceChainConfig, damlTypes.Optional<SourceChainConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IGlobalConfig, undefined>>;
  GlobalConfig_PublicFetch:
    damlTypes.Choice<IGlobalConfig, GlobalConfig_PublicFetch, GlobalConfigView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IGlobalConfig, undefined>>;
}
export declare const IGlobalConfig:
  damlTypes.InterfaceCompanion<IGlobalConfig, undefined, '#ccip-api-v2:CCIP.APIV2.GlobalConfig:IGlobalConfig'> &
  damlTypes.FromTemplate<IGlobalConfig, unknown> &
  IGlobalConfigInterface

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
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const DestChainConfig:
  damlTypes.Serializable<DestChainConfig>

export declare type GlobalConfigView = {
  ccipOwner: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const GlobalConfigView:
  damlTypes.Serializable<GlobalConfigView>

export declare type GlobalConfig_GetDestChainConfig = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GlobalConfig_GetDestChainConfig:
  damlTypes.Serializable<GlobalConfig_GetDestChainConfig>

export declare type GlobalConfig_GetSourceChainConfig = {
  sourceChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GlobalConfig_GetSourceChainConfig:
  damlTypes.Serializable<GlobalConfig_GetSourceChainConfig>

export declare type GlobalConfig_PublicFetch = {
  expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GlobalConfig_PublicFetch:
  damlTypes.Serializable<GlobalConfig_PublicFetch>

export declare type SourceChainConfig = {
  isEnabled: boolean,
  onRampAddresses: string[],
  defaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  laneMandatedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const SourceChainConfig:
  damlTypes.Serializable<SourceChainConfig>
