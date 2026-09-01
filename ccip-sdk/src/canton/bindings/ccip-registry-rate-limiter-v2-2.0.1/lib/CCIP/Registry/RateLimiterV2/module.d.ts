// Generated from ../../../CCIP/Registry/RateLimiterV2/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type ConsumeCapacity = {
  requested: damlTypes.Numeric,
}

export declare const ConsumeCapacity:
  damlTypes.Serializable<ConsumeCapacity>

export declare type ConsumeCapacityResult = {
  rateLimiterCid: damlTypes.ContractId<RateLimiter>,
  availableBeforeConsume: damlTypes.Numeric,
  consumed: damlTypes.Numeric,
}

export declare const ConsumeCapacityResult:
  damlTypes.Serializable<ConsumeCapacityResult>

export declare type RateLimitDirection =
  | 'RateLimitDirection_Outbound'
  | 'RateLimitDirection_Inbound'


export declare const RateLimitDirection:
  damlTypes.Serializable<RateLimitDirection> & { readonly keys: RateLimitDirection[] } & { readonly [e in RateLimitDirection]: e }

export declare type RateLimitMode =
  | 'RateLimitMode_DefaultFinality'
  | 'RateLimitMode_CustomFinality'


export declare const RateLimitMode:
  damlTypes.Serializable<RateLimitMode> & { readonly keys: RateLimitMode[] } & { readonly [e in RateLimitMode]: e }

export declare type RateLimiter = {
  instanceId: string,
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  remoteChainSelector: damlTypes.Numeric,
  direction: RateLimitDirection,
  mode: RateLimitMode,
  isEnabled: boolean,
  capacity: damlTypes.Numeric,
  rate: damlTypes.Numeric,
  tokens: damlTypes.Numeric,
  lastUpdated: damlTypes.Time,
  observers: damlTypes.Party[],
}

export declare interface RateLimiterInterface {
  Archive: 
    damlTypes.Choice<RateLimiter, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RateLimiter, undefined>>;
  ConsumeCapacity: 
    damlTypes.Choice<RateLimiter, ConsumeCapacity, ConsumeCapacityResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RateLimiter, undefined>>;
  SetConfig: 
    damlTypes.Choice<RateLimiter, SetConfig, damlTypes.ContractId<RateLimiter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RateLimiter, undefined>>;
  SetObservers: 
    damlTypes.Choice<RateLimiter, SetObservers, damlTypes.ContractId<RateLimiter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RateLimiter, undefined>>;
}
export declare const RateLimiter:
  damlTypes.Template<RateLimiter, undefined, '#ccip-registry-rate-limiter-v2:CCIP.Registry.RateLimiterV2:RateLimiter'> &
  damlTypes.ToInterface<RateLimiter, pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  RateLimiterInterface

export declare type SetConfig = {
  newIsEnabled: boolean,
  newCapacity: damlTypes.Numeric,
  newRate: damlTypes.Numeric,
}

export declare const SetConfig:
  damlTypes.Serializable<SetConfig>

export declare type SetObservers = {
  observers: damlTypes.Party[],
}

export declare const SetObservers:
  damlTypes.Serializable<SetObservers>
