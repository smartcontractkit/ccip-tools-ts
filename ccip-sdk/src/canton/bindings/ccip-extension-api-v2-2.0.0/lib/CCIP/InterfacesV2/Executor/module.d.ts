// Generated from ../../../CCIP/InterfacesV2/Executor/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type IExecutor = damlTypes.Interface<'#ccip-extension-api-v2:CCIP.InterfacesV2.Executor:IExecutor'> & ExecutorView
export declare interface IExecutorInterface {
  Archive:
    damlTypes.Choice<IExecutor, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutor, undefined>>;
  Executor_CalculateFee:
    damlTypes.Choice<IExecutor, Executor_CalculateFee, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutor, undefined>>;
  Executor_GetFee:
    damlTypes.Choice<IExecutor, Executor_GetFee, ExecutorFeeQuote, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutor, undefined>>;
}
export declare const IExecutor:
  damlTypes.InterfaceCompanion<IExecutor, undefined, '#ccip-extension-api-v2:CCIP.InterfacesV2.Executor:IExecutor'> &
  damlTypes.FromTemplate<IExecutor, unknown> &
  IExecutorInterface

export declare type ExecutorFeeQuote = {
  executorInstanceId: string,
  executorOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ExecutorFeeQuote:
  damlTypes.Serializable<ExecutorFeeQuote>

export declare type ExecutorView = {
  instanceId: string,
  owner: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ExecutorView:
  damlTypes.Serializable<ExecutorView>

export declare type Executor_CalculateFee = {
  expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  executorArgs: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const Executor_CalculateFee:
  damlTypes.Serializable<Executor_CalculateFee>

export declare type Executor_GetFee = {
  expectedExecutor: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  destChainSelector: damlTypes.Numeric,
  requiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const Executor_GetFee:
  damlTypes.Serializable<Executor_GetFee>
