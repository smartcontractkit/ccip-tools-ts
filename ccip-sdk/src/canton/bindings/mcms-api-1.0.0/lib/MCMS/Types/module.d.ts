// Generated from ../../MCMS/Types/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type AdminParams =
  | { tag: 'AP_SetConfig'; value: AdminParams.AP_SetConfig }
  | { tag: 'AP_ClearRoot'; value: {} }


export declare const AdminParams:
  damlTypes.Serializable<AdminParams> & {
    AP_SetConfig: damlTypes.Serializable<AdminParams.AP_SetConfig>;
  }

export namespace AdminParams {
  type AP_SetConfig = {
    apSigners: SignerInfo[],
    apGroupQuorums: damlTypes.Int[],
    apGroupParents: damlTypes.Int[],
    apClearRoot: boolean,
  }
}

export declare type BlockedFunction = {
  targetInstanceAddress: string,
  functionName: string,
}

export declare const BlockedFunction:
  damlTypes.Serializable<BlockedFunction>

export declare type ExpiringRoot = {
  root: string,
  validUntil: damlTypes.Time,
  opCount: damlTypes.Int,
}

export declare const ExpiringRoot:
  damlTypes.Serializable<ExpiringRoot>

export declare type MultisigConfig = {
  signers: SignerInfo[],
  groupQuorums: damlTypes.Int[],
  groupParents: damlTypes.Int[],
}

export declare const MultisigConfig:
  damlTypes.Serializable<MultisigConfig>

export declare type Op = {
  chainId: damlTypes.Int,
  multisigId: string,
  nonce: damlTypes.Int,
  targetInstanceAddress: string,
  functionName: string,
  operationData: string,
}

export declare const Op:
  damlTypes.Serializable<Op>

export declare type Role =
  | 'Bypasser'
  | 'Canceller'
  | 'Proposer'


export declare const Role:
  damlTypes.Serializable<Role> & { readonly keys: Role[] } & { readonly [e in Role]: e }

export declare type RoleState = {
  config: MultisigConfig,
  seenHashes: damlTypes.Map<string, damlTypes.Time>,
  expiringRoot: ExpiringRoot,
  rootMetadata: RootMetadata,
}

export declare const RoleState:
  damlTypes.Serializable<RoleState>

export declare type RootMetadata = {
  chainId: damlTypes.Int,
  multisigId: string,
  preOpCount: damlTypes.Int,
  postOpCount: damlTypes.Int,
  overridePreviousRoot: boolean,
}

export declare const RootMetadata:
  damlTypes.Serializable<RootMetadata>

export declare type SignerInfo = {
  signerAddress: string,
  signerIndex: damlTypes.Int,
  signerGroup: damlTypes.Int,
}

export declare const SignerInfo:
  damlTypes.Serializable<SignerInfo>

export declare type TimelockCall = {
  targetInstanceAddress: string,
  functionName: string,
  operationData: string,
}

export declare const TimelockCall:
  damlTypes.Serializable<TimelockCall>
