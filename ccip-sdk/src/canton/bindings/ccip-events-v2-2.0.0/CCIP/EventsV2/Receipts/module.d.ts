// Generated from ../../../CCIP/EventsV2/Receipts/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

export declare type IssuerType =
  | 'IssuerType_CCV'
  | 'IssuerType_Pool'
  | 'IssuerType_Executor'
  | 'IssuerType_Network'


export declare const IssuerType:
  damlTypes.Serializable<IssuerType> & { readonly keys: IssuerType[] } & { readonly [e in IssuerType]: e }

export declare type Receipt = {
  issuerType: IssuerType,
  issuerAddress: string,
  versionTag: damlTypes.Optional<string>,
  destGasLimit: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  feeTokenAmount: damlTypes.Numeric,
  extraArgs: string,
}

export declare const Receipt:
  damlTypes.Serializable<Receipt>
