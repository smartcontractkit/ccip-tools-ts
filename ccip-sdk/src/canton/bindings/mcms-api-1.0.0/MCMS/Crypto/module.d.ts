// Generated from ../../MCMS/Crypto/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type RawSignature = {
  publicKey: string,
  r: string,
  s: string,
}

export declare const RawSignature:
  damlTypes.Serializable<RawSignature>
