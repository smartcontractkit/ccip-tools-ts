// Generated from ../../../CCIP/CoreV2/RMNRemoteTypes/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type AddCustomObserversParams = {
  parties: damlTypes.Party[],
}

export declare const AddCustomObserversParams:
  damlTypes.Serializable<AddCustomObserversParams>

export declare type CurseChainParams = {
  chainSelector: damlTypes.Numeric,
}

export declare const CurseChainParams:
  damlTypes.Serializable<CurseChainParams>

export declare type CurseMultipleParams = {
  subjects: string[],
}

export declare const CurseMultipleParams:
  damlTypes.Serializable<CurseMultipleParams>

export declare type CurseParams = {
  subject: string,
}

export declare const CurseParams:
  damlTypes.Serializable<CurseParams>

export declare type RemoveCustomObserversParams = {
  parties: damlTypes.Party[],
}

export declare const RemoveCustomObserversParams:
  damlTypes.Serializable<RemoveCustomObserversParams>

export declare type UncurseChainParams = {
  chainSelector: damlTypes.Numeric,
}

export declare const UncurseChainParams:
  damlTypes.Serializable<UncurseChainParams>

export declare type UncurseMultipleParams = {
  subjects: string[],
}

export declare const UncurseMultipleParams:
  damlTypes.Serializable<UncurseMultipleParams>

export declare type UncurseParams = {
  subject: string,
}

export declare const UncurseParams:
  damlTypes.Serializable<UncurseParams>
