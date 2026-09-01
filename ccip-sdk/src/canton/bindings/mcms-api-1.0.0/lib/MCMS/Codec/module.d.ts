// Generated from ../../MCMS/Codec/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as MCMS_Types from '../Types/module';

export declare type BypasserExecuteBatchParams = {
  calls: MCMS_Types.TimelockCall[],
}

export declare const BypasserExecuteBatchParams:
  damlTypes.Serializable<BypasserExecuteBatchParams>

export declare type CancelBatchParams = {
  opId: string,
}

export declare const CancelBatchParams:
  damlTypes.Serializable<CancelBatchParams>

export declare type ScheduleBatchParams = {
  calls: MCMS_Types.TimelockCall[],
  predecessor: string,
  salt: string,
  delaySecs: damlTypes.Int,
}

export declare const ScheduleBatchParams:
  damlTypes.Serializable<ScheduleBatchParams>

export declare type SetConfigParams = {
  signers: MCMS_Types.SignerInfo[],
  groupQuorums: damlTypes.Int[],
  groupParents: damlTypes.Int[],
  clearRoot: boolean,
}

export declare const SetConfigParams:
  damlTypes.Serializable<SetConfigParams>
