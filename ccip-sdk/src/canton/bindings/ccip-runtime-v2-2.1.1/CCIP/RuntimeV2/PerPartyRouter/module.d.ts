// Generated from ../../../CCIP/RuntimeV2/PerPartyRouter/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0';
import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0';
import * as pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d from '@chainlink/ccip-sdk/src/canton/bindings/ccip-tickets-v2-2.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0';
import * as pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 from '@chainlink/ccip-sdk/src/canton/bindings/daml-stdlib-DA-Time-Types-1.0.0';
import * as pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';
import * as pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f from '@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0';
import * as pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff from '@chainlink/ccip-sdk/src/canton/bindings/daml-stdlib-DA-Set-Types-1.0.0';

import * as CCIP_RuntimeV2_OnRamp from '../../../CCIP/RuntimeV2/OnRamp/module';
import * as CCIP_RuntimeV2_PerPartyRouterTypes from '../../../CCIP/RuntimeV2/PerPartyRouterTypes/module';

export declare type AddCustomObservers = {
  parties: damlTypes.Party[],
}

export declare const AddCustomObservers:
  damlTypes.Serializable<AddCustomObservers>

export declare type ArchivedExecutedMessages = {
  ccipOwner: damlTypes.Party,
  partyOwner: damlTypes.Party,
  perPartyRouterInstanceId: string,
  archiveIndex: damlTypes.Int,
  executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set<string>,
}

export declare interface ArchivedExecutedMessagesInterface {
  Archive: 
    damlTypes.Choice<ArchivedExecutedMessages, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ArchivedExecutedMessages, undefined>>;
  IsExecuted: 
    damlTypes.Choice<ArchivedExecutedMessages, IsExecuted, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ArchivedExecutedMessages, undefined>>;
}
export declare const ArchivedExecutedMessages:
  damlTypes.Template<ArchivedExecutedMessages, undefined, '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:ArchivedExecutedMessages'> &
  damlTypes.ToInterface<ArchivedExecutedMessages, never> &
  ArchivedExecutedMessagesInterface

export declare type CCIPSend = {
  sendingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>,
  feeTokenHoldingCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  feeTokenConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig>,
  feeTokenTransferFactory: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>,
  feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const CCIPSend:
  damlTypes.Serializable<CCIPSend>

export declare type CCIPSendResult = {
  router: damlTypes.ContractId<PerPartyRouter>,
  ccipMessageSent: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent>,
  messageId: string,
  feeChangeCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  pendingFeeInstructions: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>[],
}

export declare const CCIPSendResult:
  damlTypes.Serializable<CCIPSendResult>

export declare type CreateRouter = {
  partyOwner: damlTypes.Party,
  instanceId: string,
  feeTransferLifetime: damlTypes.Optional<pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime>,
}

export declare const CreateRouter:
  damlTypes.Serializable<CreateRouter>

export declare type CreateRouterResult = {
  router: damlTypes.ContractId<PerPartyRouter>,
  factory: damlTypes.ContractId<PerPartyRouterFactory>,
}

export declare const CreateRouterResult:
  damlTypes.Serializable<CreateRouterResult>

export declare type Execute = {
  executingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const Execute:
  damlTypes.Serializable<Execute>

export declare type ExecuteResult = {
  router: damlTypes.ContractId<PerPartyRouter>,
  tokenReceiveTicket: damlTypes.Optional<damlTypes.ContractId<pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket>>,
  executionStateChanged: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged>,
  messageId: string,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState,
}

export declare const ExecuteResult:
  damlTypes.Serializable<ExecuteResult>

export declare type FactorySetDeps = {
  newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams,
}

export declare const FactorySetDeps:
  damlTypes.Serializable<FactorySetDeps>

export declare type FinalizeFee = {
  sendingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const FinalizeFee:
  damlTypes.Serializable<FinalizeFee>

export declare type GetExecutionState = {
  messageHash: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetExecutionState:
  damlTypes.Serializable<GetExecutionState>

export declare type GetFee = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  destChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  ccvFeeQuotes: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote[],
  tokenPoolFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote>,
  executorFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote>,
}

export declare const GetFee:
  damlTypes.Serializable<GetFee>

export declare type GetRequiredCCVsForExecute = {
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  receiverRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalThreshold: damlTypes.Int,
  tokenPoolRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const GetRequiredCCVsForExecute:
  damlTypes.Serializable<GetRequiredCCVsForExecute>

export declare type GetRequiredCCVsForSend = {
  destChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  poolReportedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const GetRequiredCCVsForSend:
  damlTypes.Serializable<GetRequiredCCVsForSend>

export declare type GetSequenceNumber = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const GetSequenceNumber:
  damlTypes.Serializable<GetSequenceNumber>

export declare type HasRouter = {
  partyOwner: damlTypes.Party,
  caller: damlTypes.Party,
}

export declare const HasRouter:
  damlTypes.Serializable<HasRouter>

export declare type IsExecuted = {
  messageHash: string,
}

export declare const IsExecuted:
  damlTypes.Serializable<IsExecuted>

export declare type PerPartyRouter = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  partyOwner: damlTypes.Party,
  deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps,
  outboundSequenceNumbers: damlTypes.Map<damlTypes.Numeric, damlTypes.Numeric>,
  executedMessages: pkgc3bb0c5d04799b3f11bad7c3c102963e115cf53da3e4afcbcfd9f06ebd82b4ff.DA.Set.Types.Set<string>,
  archivedExecutionContractIds: damlTypes.ContractId<ArchivedExecutedMessages>[],
  customObservers: damlTypes.Party[],
  feeTransferLifetime: damlTypes.Optional<pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime>,
}

export declare interface PerPartyRouterInterface {
  AddCustomObservers: 
    damlTypes.Choice<PerPartyRouter, AddCustomObservers, damlTypes.ContractId<PerPartyRouter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  Archive: 
    damlTypes.Choice<PerPartyRouter, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  CCIPSend: 
    damlTypes.Choice<PerPartyRouter, CCIPSend, CCIPSendResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  Execute: 
    damlTypes.Choice<PerPartyRouter, Execute, ExecuteResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  FinalizeFee: 
    damlTypes.Choice<PerPartyRouter, FinalizeFee, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  GetExecutionState: 
    damlTypes.Choice<PerPartyRouter, GetExecutionState, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  GetFee: 
    damlTypes.Choice<PerPartyRouter, GetFee, CCIP_RuntimeV2_OnRamp.GetFeeFromRouterResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  GetRequiredCCVsForExecute: 
    damlTypes.Choice<PerPartyRouter, GetRequiredCCVsForExecute, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  GetRequiredCCVsForSend: 
    damlTypes.Choice<PerPartyRouter, GetRequiredCCVsForSend, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  GetSequenceNumber: 
    damlTypes.Choice<PerPartyRouter, GetSequenceNumber, damlTypes.Numeric, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  PrepareExecute: 
    damlTypes.Choice<PerPartyRouter, PrepareExecute, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  PrepareSend: 
    damlTypes.Choice<PerPartyRouter, PrepareSend, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  RemoveCustomObservers: 
    damlTypes.Choice<PerPartyRouter, RemoveCustomObservers, damlTypes.ContractId<PerPartyRouter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
  SetDeps: 
    damlTypes.Choice<PerPartyRouter, SetDeps, damlTypes.ContractId<PerPartyRouter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouter, undefined>>;
}
export declare const PerPartyRouter:
  damlTypes.Template<PerPartyRouter, undefined, '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouter'> &
  damlTypes.ToInterface<PerPartyRouter, pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  PerPartyRouterInterface

export declare type PerPartyRouterFactory = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  deps: CCIP_RuntimeV2_PerPartyRouterTypes.PerPartyRouterDeps,
  registeredRouters: damlTypes.Map<damlTypes.Party, string>,
}

export declare interface PerPartyRouterFactoryInterface {
  Archive: 
    damlTypes.Choice<PerPartyRouterFactory, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouterFactory, undefined>>;
  CreateRouter: 
    damlTypes.Choice<PerPartyRouterFactory, CreateRouter, CreateRouterResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouterFactory, undefined>>;
  FactorySetDeps: 
    damlTypes.Choice<PerPartyRouterFactory, FactorySetDeps, damlTypes.ContractId<PerPartyRouterFactory>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouterFactory, undefined>>;
  HasRouter: 
    damlTypes.Choice<PerPartyRouterFactory, HasRouter, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<PerPartyRouterFactory, undefined>>;
}
export declare const PerPartyRouterFactory:
  damlTypes.Template<PerPartyRouterFactory, undefined, '#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouterFactory'> &
  damlTypes.ToInterface<PerPartyRouterFactory, pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  PerPartyRouterFactoryInterface

export declare type PrepareExecute = {
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

export declare const PrepareExecute:
  damlTypes.Serializable<PrepareExecute>

export declare type PrepareSend = {
  destinationChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PrepareSend:
  damlTypes.Serializable<PrepareSend>

export declare type RemoveCustomObservers = {
  parties: damlTypes.Party[],
}

export declare const RemoveCustomObservers:
  damlTypes.Serializable<RemoveCustomObservers>

export declare type SetDeps = {
  newDeps: CCIP_RuntimeV2_PerPartyRouterTypes.SetDepsParams,
}

export declare const SetDeps:
  damlTypes.Serializable<SetDeps>
