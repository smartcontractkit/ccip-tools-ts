// Generated from ../../../CCIP/APIV2/ExecutingMessage/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@daml.js/ccip-codec-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type IExecutingMessage = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.ExecutingMessage:IExecutingMessage'> & ExecutingMessageView
export declare interface IExecutingMessageInterface {
  Archive:
    damlTypes.Choice<IExecutingMessage, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutingMessage, undefined>>;
  ExecutingMessage_AddCCVVerification:
    damlTypes.Choice<IExecutingMessage, ExecutingMessage_AddCCVVerification, damlTypes.ContractId<IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutingMessage, undefined>>;
  ExecutingMessage_CancelExecute:
    damlTypes.Choice<IExecutingMessage, ExecutingMessage_CancelExecute, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutingMessage, undefined>>;
}
export declare const IExecutingMessage:
  damlTypes.InterfaceCompanion<IExecutingMessage, undefined, '#ccip-api-v2:CCIP.APIV2.ExecutingMessage:IExecutingMessage'> &
  damlTypes.FromTemplate<IExecutingMessage, unknown> &
  IExecutingMessageInterface

export declare type ITokenReceiveTicket = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.ExecutingMessage:ITokenReceiveTicket'> & TokenReceiveTicketView
export declare interface ITokenReceiveTicketInterface {
  Archive:
    damlTypes.Choice<ITokenReceiveTicket, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenReceiveTicket, undefined>>;
  Consume:
    damlTypes.Choice<ITokenReceiveTicket, Consume, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenReceiveTicket, undefined>>;
}
export declare const ITokenReceiveTicket:
  damlTypes.InterfaceCompanion<ITokenReceiveTicket, undefined, '#ccip-api-v2:CCIP.APIV2.ExecutingMessage:ITokenReceiveTicket'> &
  damlTypes.FromTemplate<ITokenReceiveTicket, unknown> &
  ITokenReceiveTicketInterface

export declare type Consume = {
}

export declare const Consume:
  damlTypes.Serializable<Consume>

export declare type ExecutingMessageView = {
  ccipOwner: damlTypes.Party,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ExecutingMessageView:
  damlTypes.Serializable<ExecutingMessageView>

export declare type ExecutingMessage_AddCCVVerification = {
  ccvInstanceId: string,
  versionTag: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const ExecutingMessage_AddCCVVerification:
  damlTypes.Serializable<ExecutingMessage_AddCCVVerification>

export declare type ExecutingMessage_CancelExecute = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const ExecutingMessage_CancelExecute:
  damlTypes.Serializable<ExecutingMessage_CancelExecute>

export declare type MessageExecutionState =
  | 'UNTOUCHED'
  | 'IN_PROGRESS'
  | 'SUCCESS'
  | 'FAILURE'


export declare const MessageExecutionState:
  damlTypes.Serializable<MessageExecutionState> & { readonly keys: MessageExecutionState[] } & { readonly [e in MessageExecutionState]: e }

export declare type TokenReceiveTicketView = {
  ccipOwner: damlTypes.Party,
  poolOwner: damlTypes.Party,
  ccvOwners: damlTypes.Party[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const TokenReceiveTicketView:
  damlTypes.Serializable<TokenReceiveTicketView>
