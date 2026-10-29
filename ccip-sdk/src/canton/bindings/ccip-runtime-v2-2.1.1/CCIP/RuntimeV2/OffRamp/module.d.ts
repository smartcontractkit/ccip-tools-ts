// Generated from ../../../CCIP/RuntimeV2/OffRamp/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d from '@chainlink/ccip-sdk/src/canton/bindings/ccip-tickets-v2-2.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0';
import * as pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';
import * as pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f from '@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0';

import * as CCIP_RuntimeV2_OffRampTypes from '../../../CCIP/RuntimeV2/OffRampTypes/module';

export declare type ExecuteFromRouter = {
  routerPartyOwner: damlTypes.Party,
  executingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage>,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry>,
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig>>,
  rmnRemoteCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote>,
}

export declare const ExecuteFromRouter:
  damlTypes.Serializable<ExecuteFromRouter>

export declare type ExecuteFromRouterResult = {
  messageId: string,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  sourceChainSelector: damlTypes.Numeric,
  sequenceNumber: damlTypes.Numeric,
  tokenReceiveTicket: damlTypes.Optional<damlTypes.ContractId<pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket>>,
  executionStateChanged: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged>,
}

export declare const ExecuteFromRouterResult:
  damlTypes.Serializable<ExecuteFromRouterResult>

export declare type GetRequiredCCVsForExecuteFromRouter = {
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1,
  receiverRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalThreshold: damlTypes.Int,
  tokenPoolRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const GetRequiredCCVsForExecuteFromRouter:
  damlTypes.Serializable<GetRequiredCCVsForExecuteFromRouter>

export declare type OffRamp = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  deps: CCIP_RuntimeV2_OffRampTypes.OffRampDeps,
}

export declare interface OffRampInterface {
  Archive: 
    damlTypes.Choice<OffRamp, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OffRamp, undefined>>;
  ExecuteFromRouter: 
    damlTypes.Choice<OffRamp, ExecuteFromRouter, ExecuteFromRouterResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OffRamp, undefined>>;
  GetRequiredCCVsForExecuteFromRouter: 
    damlTypes.Choice<OffRamp, GetRequiredCCVsForExecuteFromRouter, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OffRamp, undefined>>;
  PrepareExecute: 
    damlTypes.Choice<OffRamp, PrepareExecute, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.ExecutingMessage.ExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OffRamp, undefined>>;
  SetDeps: 
    damlTypes.Choice<OffRamp, SetDeps, damlTypes.ContractId<OffRamp>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OffRamp, undefined>>;
}
export declare const OffRamp:
  damlTypes.Template<OffRamp, undefined, '#ccip-runtime-v2:CCIP.RuntimeV2.OffRamp:OffRamp'> &
  damlTypes.ToInterface<OffRamp, pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  OffRampInterface

export declare type PrepareExecute = {
  encodedMessage: string,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry>,
  receiverRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  receiverOptionalThreshold: damlTypes.Int,
  receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  rmnRemoteCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote>,
  receiverParty: damlTypes.Party,
  tokenReceiverParty: damlTypes.Optional<damlTypes.Party>,
  caller: damlTypes.Party,
}

export declare const PrepareExecute:
  damlTypes.Serializable<PrepareExecute>

export declare type SetDeps = {
  newDeps: CCIP_RuntimeV2_OffRampTypes.SetDepsParams,
}

export declare const SetDeps:
  damlTypes.Serializable<SetDeps>
