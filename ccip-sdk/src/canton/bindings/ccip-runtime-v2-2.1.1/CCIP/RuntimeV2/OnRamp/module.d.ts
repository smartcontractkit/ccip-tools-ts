// Generated from ../../../CCIP/RuntimeV2/OnRamp/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0';
import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@chainlink/ccip-sdk/src/canton/bindings/mcms-api-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0';
import * as pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-core-v2-2.1.1';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';
import * as pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f from '@chainlink/ccip-sdk/src/canton/bindings/ccip-events-v2-2.0.0';

import * as CCIP_RuntimeV2_OnRampTypes from '../../../CCIP/RuntimeV2/OnRampTypes/module';

export declare type CCIPSendFromRouter = {
  routerPartyOwner: damlTypes.Party,
  routerInstanceId: string,
  currentSequenceNumber: damlTypes.Numeric,
  rmnRemoteCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote>,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry>,
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenConfig>>,
  sendingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>,
}

export declare const CCIPSendFromRouter:
  damlTypes.Serializable<CCIPSendFromRouter>

export declare type CCIPSendFromRouterResult = {
  ccipMessageSent: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent>,
  verifierBlobs: string[],
  messageSentObservers: damlTypes.Party[],
  receipts: pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt[],
}

export declare const CCIPSendFromRouterResult:
  damlTypes.Serializable<CCIPSendFromRouterResult>

export declare type FeeCalculationInputs = {
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  payload: string,
  executorArgs: string,
  hasTokenTransfer: boolean,
  ccipReceiveGasLimit: damlTypes.Int,
  ccvFeeUSDCents: damlTypes.Numeric,
  ccvGasSum: damlTypes.Int,
  ccvBytesSum: damlTypes.Int,
  poolFeeUSDCents: damlTypes.Numeric,
  poolGas: damlTypes.Int,
  poolBytes: damlTypes.Int,
  executorFeeUSDCents: damlTypes.Numeric,
  hasExecutorFee: boolean,
}

export declare const FeeCalculationInputs:
  damlTypes.Serializable<FeeCalculationInputs>

export declare type FeeCalculationResult = {
  totalFeeTokenAmount: damlTypes.Numeric,
  totalUSDCents: damlTypes.Numeric,
  executionCostUSDCents: damlTypes.Numeric,
  executorDestGasLimit: damlTypes.Int,
  executorDestBytesOverhead: damlTypes.Int,
  totalExecutionGasLimit: damlTypes.Int,
  premiumMultiplier: damlTypes.Numeric,
  feeTokenPrice: damlTypes.Numeric,
}

export declare const FeeCalculationResult:
  damlTypes.Serializable<FeeCalculationResult>

export declare type FinalizeFeeFromRouter = {
  routerPartyOwner: damlTypes.Party,
  routerInstanceId: string,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  feeQuoterCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter>,
  sendingMessageCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>,
}

export declare const FinalizeFeeFromRouter:
  damlTypes.Serializable<FinalizeFeeFromRouter>

export declare type GetFeeFromRouter = {
  routerPartyOwner: damlTypes.Party,
  routerInstanceId: string,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  feeQuoterCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter>,
  destChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  ccvFeeQuotes: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.CrossChainVerifierFeeQuote[],
  tokenPoolFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote>,
  executorFeeQuote: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.ExecutorFeeQuote>,
}

export declare const GetFeeFromRouter:
  damlTypes.Serializable<GetFeeFromRouter>

export declare type GetFeeFromRouterResult = {
  feeTokenAmount: damlTypes.Numeric,
}

export declare const GetFeeFromRouterResult:
  damlTypes.Serializable<GetFeeFromRouterResult>

export declare type GetRequiredCCVsForSendFromRouter = {
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  destChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  poolReportedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const GetRequiredCCVsForSendFromRouter:
  damlTypes.Serializable<GetRequiredCCVsForSendFromRouter>

export declare type OnRamp = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  maxUSDCentsPerMsg: damlTypes.Numeric,
  deps: CCIP_RuntimeV2_OnRampTypes.OnRampDeps,
}

export declare interface OnRampInterface {
  Archive: 
    damlTypes.Choice<OnRamp, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  CCIPSendFromRouter: 
    damlTypes.Choice<OnRamp, CCIPSendFromRouter, CCIPSendFromRouterResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  FinalizeFeeFromRouter: 
    damlTypes.Choice<OnRamp, FinalizeFeeFromRouter, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  GetFeeFromRouter: 
    damlTypes.Choice<OnRamp, GetFeeFromRouter, GetFeeFromRouterResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  GetRequiredCCVsForSendFromRouter: 
    damlTypes.Choice<OnRamp, GetRequiredCCVsForSendFromRouter, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  PrepareSendFromRouter: 
    damlTypes.Choice<OnRamp, PrepareSendFromRouter, damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
  SetDeps: 
    damlTypes.Choice<OnRamp, SetDeps, damlTypes.ContractId<OnRamp>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<OnRamp, undefined>>;
}
export declare const OnRamp:
  damlTypes.Template<OnRamp, undefined, '#ccip-runtime-v2:CCIP.RuntimeV2.OnRamp:OnRamp'> &
  damlTypes.ToInterface<OnRamp, pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  OnRampInterface

export declare type PrepareSendFromRouter = {
  destChainSelector: damlTypes.Numeric,
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage,
  routerPartyOwner: damlTypes.Party,
  routerInstanceId: string,
  globalConfigCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.GlobalConfig.GlobalConfig>,
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry>,
  feeQuoterCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.FeeQuoter.FeeQuoter>,
  rmnRemoteCid: damlTypes.ContractId<pkg7a08ead9e5158d6e493c144c63a91b1a7e23b9424359c1551ccfad991ba39c39.CCIP.CoreV2.RMNRemote.RMNRemote>,
  currentSequenceNumber: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const PrepareSendFromRouter:
  damlTypes.Serializable<PrepareSendFromRouter>

export declare type SetDeps = {
  newDeps: CCIP_RuntimeV2_OnRampTypes.SetDepsParams,
}

export declare const SetDeps:
  damlTypes.Serializable<SetDeps>
