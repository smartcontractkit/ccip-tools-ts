// Generated from ../../../CCIP/CoreV2/ExecutingMessage/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d from '@daml.js/ccip-tickets-v2-2.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@daml.js/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';
import * as pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f from '@daml.js/ccip-events-v2-2.0.0';

export declare type AddCCVVerification = {
  ccvInstanceId: string,
  versionTag: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const AddCCVVerification:
  damlTypes.Serializable<AddCCVVerification>

export declare type CCVVerification = {
  ccvInstanceId: string,
  ccvOwner: damlTypes.Party,
  versionTag: string,
}

export declare const CCVVerification:
  damlTypes.Serializable<CCVVerification>

export declare type CancelExecute = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CancelExecute:
  damlTypes.Serializable<CancelExecute>

export declare type ExecutingMessage = {
  ccipOwner: damlTypes.Party,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  messageId: string,
  receiver: damlTypes.Party,
  tokenReceiver: damlTypes.Optional<damlTypes.Party>,
  executor: damlTypes.Party,
  observingParties: damlTypes.Party[],
  ccvVerifications: CCVVerification[],
  ccvOwners: damlTypes.Party[],
  requiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  optionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  optionalCCVThreshold: damlTypes.Int,
  receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  sourceDefaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  inboundPoolVerification: damlTypes.Optional<InboundPoolVerification>,
  deps: ExecutingMessageDeps,
  state: ExecutingMessageState,
}

export declare interface ExecutingMessageInterface {
  AddCCVVerification: 
    damlTypes.Choice<ExecutingMessage, AddCCVVerification, damlTypes.ContractId<ExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutingMessage, undefined>>;
  Archive: 
    damlTypes.Choice<ExecutingMessage, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutingMessage, undefined>>;
  CancelExecute: 
    damlTypes.Choice<ExecutingMessage, CancelExecute, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutingMessage, undefined>>;
  FinalizeExecute: 
    damlTypes.Choice<ExecutingMessage, FinalizeExecute, FinalizeExecuteResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutingMessage, undefined>>;
  SetInboundPoolCCVs: 
    damlTypes.Choice<ExecutingMessage, SetInboundPoolCCVs, damlTypes.ContractId<ExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutingMessage, undefined>>;
}
export declare const ExecutingMessage:
  damlTypes.Template<ExecutingMessage, undefined, '#ccip-core-v2:CCIP.CoreV2.ExecutingMessage:ExecutingMessage'> &
  damlTypes.ToInterface<ExecutingMessage, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage> &
  ExecutingMessageInterface

export declare type ExecutingMessageDeps = {
  offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const ExecutingMessageDeps:
  damlTypes.Serializable<ExecutingMessageDeps>

export declare type ExecutingMessageState =
  | 'ExecutingMessageState_RequirePoolCCVs'
  | 'ExecutingMessageState_Prepared'


export declare const ExecutingMessageState:
  damlTypes.Serializable<ExecutingMessageState> & { readonly keys: ExecutingMessageState[] } & { readonly [e in ExecutingMessageState]: e }

export declare type FinalizeExecute = {
  tokenAdminRegistryInstanceId: string,
  maybePoolAddress: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
  maybeTicketReceiver: damlTypes.Optional<damlTypes.Party>,
  maybeTokenReceiver: damlTypes.Optional<damlTypes.Party>,
  maybeInstrumentId: damlTypes.Optional<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId>,
  maybeAmount: damlTypes.Optional<string>,
  returnData: string,
}

export declare const FinalizeExecute:
  damlTypes.Serializable<FinalizeExecute>

export declare type FinalizeExecuteResult = {
  tokenReceiveTicket: damlTypes.Optional<damlTypes.ContractId<pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket>>,
  executionStateChanged: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged>,
}

export declare const FinalizeExecuteResult:
  damlTypes.Serializable<FinalizeExecuteResult>

export declare type InboundPoolVerification = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const InboundPoolVerification:
  damlTypes.Serializable<InboundPoolVerification>

export declare type SetInboundPoolCCVs = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const SetInboundPoolCCVs:
  damlTypes.Serializable<SetInboundPoolCCVs>
