// Generated from ../../../CCIP/CoreV2/GlobalConfig/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

import * as CCIP_CoreV2_GlobalConfigTypes from '../../../CCIP/CoreV2/GlobalConfigTypes/module';

export declare type ApplyDestChainConfigUpdates = {
  destChainConfigUpdates: CCIP_CoreV2_GlobalConfigTypes.DestChainConfigArgs[],
}

export declare const ApplyDestChainConfigUpdates:
  damlTypes.Serializable<ApplyDestChainConfigUpdates>

export declare type ApplySourceChainConfigUpdates = {
  sourceChainConfigUpdates: CCIP_CoreV2_GlobalConfigTypes.SourceChainConfigArgs[],
}

export declare const ApplySourceChainConfigUpdates:
  damlTypes.Serializable<ApplySourceChainConfigUpdates>

export declare type GetDestChainConfig = {
  destChainSelector: damlTypes.Numeric,
  caller: damlTypes.Party,
}

export declare const GetDestChainConfig:
  damlTypes.Serializable<GetDestChainConfig>

export declare type GetSourceChainConfig = {
  sourceChainSelector: damlTypes.Numeric,
  caller: damlTypes.Party,
}

export declare const GetSourceChainConfig:
  damlTypes.Serializable<GetSourceChainConfig>

export declare type GlobalConfig = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  chainSelector: damlTypes.Numeric,
  destChainConfigs: damlTypes.Map<damlTypes.Numeric, CCIP_CoreV2_GlobalConfigTypes.DestChainConfig>,
  sourceChainConfigs: damlTypes.Map<damlTypes.Numeric, CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig>,
}

export declare interface GlobalConfigInterface {
  ApplyDestChainConfigUpdates: 
    damlTypes.Choice<GlobalConfig, ApplyDestChainConfigUpdates, damlTypes.ContractId<GlobalConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<GlobalConfig, undefined>>;
  ApplySourceChainConfigUpdates: 
    damlTypes.Choice<GlobalConfig, ApplySourceChainConfigUpdates, damlTypes.ContractId<GlobalConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<GlobalConfig, undefined>>;
  Archive: 
    damlTypes.Choice<GlobalConfig, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<GlobalConfig, undefined>>;
  GetDestChainConfig: 
    damlTypes.Choice<GlobalConfig, GetDestChainConfig, damlTypes.Optional<CCIP_CoreV2_GlobalConfigTypes.DestChainConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<GlobalConfig, undefined>>;
  GetSourceChainConfig: 
    damlTypes.Choice<GlobalConfig, GetSourceChainConfig, damlTypes.Optional<CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<GlobalConfig, undefined>>;
}
export declare const GlobalConfig:
  damlTypes.Template<GlobalConfig, undefined, '#ccip-core-v2:CCIP.CoreV2.GlobalConfig:GlobalConfig'> &
  damlTypes.ToInterface<GlobalConfig, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.GlobalConfig.IGlobalConfig | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  GlobalConfigInterface
