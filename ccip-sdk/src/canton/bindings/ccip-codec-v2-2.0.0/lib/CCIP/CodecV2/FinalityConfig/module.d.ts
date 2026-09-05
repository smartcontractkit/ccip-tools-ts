// Generated from ../../../CCIP/CodecV2/FinalityConfig/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type DecodedFinality = {
  raw: string,
  requested: FinalityConfig,
}

export declare const DecodedFinality:
  damlTypes.Serializable<DecodedFinality>

export declare type FinalityConfig =
  | { tag: 'WaitForFinality'; value: {} }
  | { tag: 'WaitForSafe'; value: {} }
  | { tag: 'BlockDepth'; value: damlTypes.Int }


export declare const FinalityConfig:
  damlTypes.Serializable<FinalityConfig>
