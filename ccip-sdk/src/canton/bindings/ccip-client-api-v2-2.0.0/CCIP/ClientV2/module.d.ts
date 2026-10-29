// Generated from ../../CCIP/ClientV2/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0';
import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';

export declare type ICCIPMessageSent = damlTypes.Interface<'#ccip-client-api-v2:CCIP.ClientV2:ICCIPMessageSent'> & CCIPMessageSentView
export declare interface ICCIPMessageSentInterface {
  Archive:
    damlTypes.Choice<ICCIPMessageSent, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICCIPMessageSent, undefined>>;
}
export declare const ICCIPMessageSent:
  damlTypes.InterfaceCompanion<ICCIPMessageSent, undefined, '#ccip-client-api-v2:CCIP.ClientV2:ICCIPMessageSent'> &
  damlTypes.FromTemplate<ICCIPMessageSent, unknown> &
  ICCIPMessageSentInterface

export declare type IExecutionStateChanged = damlTypes.Interface<'#ccip-client-api-v2:CCIP.ClientV2:IExecutionStateChanged'> & ExecutionStateChangedView
export declare interface IExecutionStateChangedInterface {
  Archive:
    damlTypes.Choice<IExecutionStateChanged, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IExecutionStateChanged, undefined>>;
}
export declare const IExecutionStateChanged:
  damlTypes.InterfaceCompanion<IExecutionStateChanged, undefined, '#ccip-client-api-v2:CCIP.ClientV2:IExecutionStateChanged'> &
  damlTypes.FromTemplate<IExecutionStateChanged, unknown> &
  IExecutionStateChangedInterface

export declare type PerPartyRouter = damlTypes.Interface<'#ccip-client-api-v2:CCIP.ClientV2:PerPartyRouter'> & PerPartyRouterView
export declare interface PerPartyRouterInterface {
  Archive:
    damlTypes.Choice<PerPartyRouter, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_CCIPSend:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_CCIPSend, CCIPSendResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_Execute:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_Execute, ExecuteResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_FinalizeFee:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_FinalizeFee, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_GetExecutionState:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_GetExecutionState, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_GetFee:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_GetFee, GetFeeResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_GetRequiredCCVsForExecute:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_GetRequiredCCVsForExecute, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_GetRequiredCCVsForSend:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_GetRequiredCCVsForSend, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_GetSequenceNumber:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_GetSequenceNumber, damlTypes.Numeric, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_PrepareExecute:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_PrepareExecute, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
  PerPartyRouter_PrepareSend:
    damlTypes.Choice<PerPartyRouter, PerPartyRouter_PrepareSend, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<PerPartyRouter, undefined>>;
}
export declare const PerPartyRouter:
  damlTypes.InterfaceCompanion<PerPartyRouter, undefined, '#ccip-client-api-v2:CCIP.ClientV2:PerPartyRouter'> &
  damlTypes.FromTemplate<PerPartyRouter, unknown> &
  PerPartyRouterInterface

export declare type CCIPMessageSentView = {
  ccipOwner: damlTypes.Party,
  messageId: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const CCIPMessageSentView:
  damlTypes.Serializable<CCIPMessageSentView>

export declare type CCIPSendResult = {
  router: damlTypes.ContractId<PerPartyRouter>,
  ccipMessageSent: damlTypes.ContractId<ICCIPMessageSent>,
  messageId: string,
  feeChangeCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  pendingFeeInstructions: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const CCIPSendResult:
  damlTypes.Serializable<CCIPSendResult>

export declare type CCVExtraArg = {
  ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  ccvArgs: string,
}

export declare const CCVExtraArg:
  damlTypes.Serializable<CCVExtraArg>

export declare type Canton2AnyMessage = {
  receiver: string,
  payload: string,
  tokenTransfer: damlTypes.Optional<TokenTransfer>,
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  extraArgs: ExtraArgs,
}

export declare const Canton2AnyMessage:
  damlTypes.Serializable<Canton2AnyMessage>

export declare type ExecuteResult = {
  router: damlTypes.ContractId<PerPartyRouter>,
  tokenReceiveTicket: damlTypes.Optional<damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket>>,
  executionStateChanged: damlTypes.ContractId<IExecutionStateChanged>,
  messageId: string,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ExecuteResult:
  damlTypes.Serializable<ExecuteResult>

export declare type ExecutionStateChangedView = {
  ccipOwner: damlTypes.Party,
  messageId: string,
  state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ExecutionStateChangedView:
  damlTypes.Serializable<ExecutionStateChangedView>

export declare type ExecutorExtraArg =
  | { tag: 'Executor_NoExecutor'; value: {} }
  | { tag: 'Executor_UseDefault'; value: ExecutorExtraArg.Executor_UseDefault }
  | { tag: 'Executor_WithAddress'; value: ExecutorExtraArg.Executor_WithAddress }


export declare const ExecutorExtraArg:
  damlTypes.Serializable<ExecutorExtraArg> & {
    Executor_UseDefault: damlTypes.Serializable<ExecutorExtraArg.Executor_UseDefault>;
    Executor_WithAddress: damlTypes.Serializable<ExecutorExtraArg.Executor_WithAddress>;
  }

export namespace ExecutorExtraArg {
  type Executor_UseDefault = {
    executorArgs: string,
  }
  type Executor_WithAddress = {
    executorAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
    executorArgs: string,
  }
}

export declare type ExtraArgs =
  | { tag: 'V3'; value: GenericExtraArgsV3 }


export declare const ExtraArgs:
  damlTypes.Serializable<ExtraArgs>

export declare type GenericExtraArgsV3 = {
  gasLimit: damlTypes.Int,
  ccvs: CCVExtraArg[],
  executor: ExecutorExtraArg,
  tokenReceiver: string,
  tokenArgs: string,
}

export declare const GenericExtraArgsV3:
  damlTypes.Serializable<GenericExtraArgsV3>

export declare type GetFeeResult = {
  feeTokenAmount: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const GetFeeResult:
  damlTypes.Serializable<GetFeeResult>

export declare type PerPartyRouterView = {
  ccipOwner: damlTypes.Party,
  owner: damlTypes.Party,
}

export declare const PerPartyRouterView:
  damlTypes.Serializable<PerPartyRouterView>

export declare type PerPartyRouter_CCIPSend = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  feeTokenHoldingCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  feeTokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  feeTokenTransferFactory: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>,
  feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs,
}

export declare const PerPartyRouter_CCIPSend:
  damlTypes.Serializable<PerPartyRouter_CCIPSend>

export declare type PerPartyRouter_Execute = {
  executingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_Execute:
  damlTypes.Serializable<PerPartyRouter_Execute>

export declare type PerPartyRouter_FinalizeFee = {
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_FinalizeFee:
  damlTypes.Serializable<PerPartyRouter_FinalizeFee>

export declare type PerPartyRouter_GetExecutionState = {
  messageHash: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const PerPartyRouter_GetExecutionState:
  damlTypes.Serializable<PerPartyRouter_GetExecutionState>

export declare type PerPartyRouter_GetFee = {
  destChainSelector: damlTypes.Numeric,
  message: Canton2AnyMessage,
  ccvFeeQuotes: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote[],
  tokenPoolFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote>,
  executorFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_GetFee:
  damlTypes.Serializable<PerPartyRouter_GetFee>

export declare type PerPartyRouter_GetRequiredCCVsForExecute = {
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  receiverRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalThreshold: damlTypes.Int,
  tokenPoolRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_GetRequiredCCVsForExecute:
  damlTypes.Serializable<PerPartyRouter_GetRequiredCCVsForExecute>

export declare type PerPartyRouter_GetRequiredCCVsForSend = {
  destChainSelector: damlTypes.Numeric,
  message: Canton2AnyMessage,
  poolReportedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_GetRequiredCCVsForSend:
  damlTypes.Serializable<PerPartyRouter_GetRequiredCCVsForSend>

export declare type PerPartyRouter_GetSequenceNumber = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_GetSequenceNumber:
  damlTypes.Serializable<PerPartyRouter_GetSequenceNumber>

export declare type PerPartyRouter_PrepareExecute = {
  encodedMessage: string,
  receiverParty: damlTypes.Party,
  tokenReceiverParty: damlTypes.Optional<damlTypes.Party>,
  receiverRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalThreshold: damlTypes.Int,
  receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const PerPartyRouter_PrepareExecute:
  damlTypes.Serializable<PerPartyRouter_PrepareExecute>

export declare type PerPartyRouter_PrepareSend = {
  destinationChainSelector: damlTypes.Numeric,
  message: Canton2AnyMessage,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PerPartyRouter_PrepareSend:
  damlTypes.Serializable<PerPartyRouter_PrepareSend>

export declare type TokenTransfer = {
  token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: damlTypes.Numeric,
}

export declare const TokenTransfer:
  damlTypes.Serializable<TokenTransfer>
