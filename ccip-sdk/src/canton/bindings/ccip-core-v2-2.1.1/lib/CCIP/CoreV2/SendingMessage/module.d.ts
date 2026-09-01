// Generated from ../../../CCIP/CoreV2/SendingMessage/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@daml.js/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';
import * as pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f from '@daml.js/ccip-events-v2-2.0.0';

export declare type AddCCVFee = {
  ccvInstanceId: string,
  feeUSDCents: damlTypes.Numeric,
  destGasLimit: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const AddCCVFee:
  damlTypes.Serializable<AddCCVFee>

export declare type AddExecutorFee = {
  executorInstanceId: string,
  executorArgs: string,
  feeUSDCents: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const AddExecutorFee:
  damlTypes.Serializable<AddExecutorFee>

export declare type AddTokenSend = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: string,
  destTokenAddress: string,
  extraData: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const AddTokenSend:
  damlTypes.Serializable<AddTokenSend>

export declare type AddTokenSendFee = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const AddTokenSendFee:
  damlTypes.Serializable<AddTokenSendFee>

export declare type AddVerifierData = {
  ccvInstanceId: string,
  versionTag: string,
  verifierBlob: string,
  messageSentObservers: damlTypes.Party[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const AddVerifierData:
  damlTypes.Serializable<AddVerifierData>

export declare type BuildMessage = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const BuildMessage:
  damlTypes.Serializable<BuildMessage>

export declare type CCVFee = {
  ccvInstanceId: string,
  ccvOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  destGasLimit: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
}

export declare const CCVFee:
  damlTypes.Serializable<CCVFee>

export declare type ExecutionMode =
  | 'ExecutionMode_Executor'
  | 'ExecutionMode_NoExecutor'


export declare const ExecutionMode:
  damlTypes.Serializable<ExecutionMode> & { readonly keys: ExecutionMode[] } & { readonly [e in ExecutionMode]: e }

export declare type ExecutorFee = {
  executorInstanceId: string,
  executorOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
}

export declare const ExecutorFee:
  damlTypes.Serializable<ExecutorFee>

export declare type FeeTokenAmount = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const FeeTokenAmount:
  damlTypes.Serializable<FeeTokenAmount>

export declare type FinalizeFee = {
  feeTokenPrice: damlTypes.Numeric,
  premiumMultiplier: damlTypes.Numeric,
  totalExecutionGasLimit: damlTypes.Int,
  executorDestGasLimit: damlTypes.Int,
  executorDestBytesOverhead: damlTypes.Int,
  executionCostUSDCents: damlTypes.Numeric,
}

export declare const FinalizeFee:
  damlTypes.Serializable<FinalizeFee>

export declare type FinalizeSend = {
  messageSender: damlTypes.Party,
  messageSentObservers: damlTypes.Party[],
  verifierBlobs: string[],
  receipts: pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Receipts.Receipt[],
}

export declare const FinalizeSend:
  damlTypes.Serializable<FinalizeSend>

export declare type FinalizeSendResult = {
  ccipMessageSent: damlTypes.ContractId<pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.CCIPMessageSent>,
}

export declare const FinalizeSendResult:
  damlTypes.Serializable<FinalizeSendResult>

export declare type SendingMessage = {
  deps: SendingMessageDeps,
  ccipOwner: damlTypes.Party,
  sender: damlTypes.Party,
  destChainSelector: damlTypes.Numeric,
  destAddressBytesLength: damlTypes.Int,
  sequenceNumber: damlTypes.Numeric,
  destDefaultCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  requiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  requiredExecutor: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
  executorAddress: string,
  executionMode: damlTypes.Optional<ExecutionMode>,
  sourceChainSelector: damlTypes.Numeric,
  senderAddress: string,
  receiver: string,
  payload: string,
  executionGasLimit: damlTypes.Int,
  ccipReceiveGasLimit: damlTypes.Int,
  ccvAndExecutorHash: string,
  onRampAddress: string,
  offRampAddress: string,
  tokenReceiver: string,
  tokenArgs: string,
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  networkFeeUSDCents: damlTypes.Numeric,
  expectedTokenInstrumentId: damlTypes.Optional<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId>,
  tokenAmountBeforeTokenPoolFees: damlTypes.Numeric,
  outboundPoolCCVs: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[]>,
  executorArgs: string,
  executorFee: damlTypes.Optional<ExecutorFee>,
  executorDestGasLimit: damlTypes.Int,
  executorDestBytesOverhead: damlTypes.Int,
  executorFeeTokenAmount: damlTypes.Numeric,
  observingParties: damlTypes.Party[],
  ccvFees: CCVFee[],
  tokenSendFee: damlTypes.Optional<TokenSendFee>,
  ccvFeeTokenAmounts: damlTypes.Numeric[],
  tokenSendFeeTokenAmount: damlTypes.Numeric,
  networkFeeTokenAmount: damlTypes.Numeric,
  tokenSendData: damlTypes.Optional<TokenSendData>,
  verifierData: VerifierData[],
  ccvOwners: damlTypes.Party[],
  message: damlTypes.Optional<pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1>,
  encodedMessage: string,
  messageId: string,
  state: SendingMessageState,
}

export declare interface SendingMessageInterface {
  AddCCVFee: 
    damlTypes.Choice<SendingMessage, AddCCVFee, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  AddExecutorFee: 
    damlTypes.Choice<SendingMessage, AddExecutorFee, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  AddTokenSend: 
    damlTypes.Choice<SendingMessage, AddTokenSend, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  AddTokenSendFee: 
    damlTypes.Choice<SendingMessage, AddTokenSendFee, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  AddVerifierData: 
    damlTypes.Choice<SendingMessage, AddVerifierData, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  Archive: 
    damlTypes.Choice<SendingMessage, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  BuildMessage: 
    damlTypes.Choice<SendingMessage, BuildMessage, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  FeeTokenAmount: 
    damlTypes.Choice<SendingMessage, FeeTokenAmount, damlTypes.Numeric, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  FinalizeFee: 
    damlTypes.Choice<SendingMessage, FinalizeFee, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  FinalizeSend: 
    damlTypes.Choice<SendingMessage, FinalizeSend, FinalizeSendResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
  SetOutboundPoolCCVs: 
    damlTypes.Choice<SendingMessage, SetOutboundPoolCCVs, damlTypes.ContractId<SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<SendingMessage, undefined>>;
}
export declare const SendingMessage:
  damlTypes.Template<SendingMessage, undefined, '#ccip-core-v2:CCIP.CoreV2.SendingMessage:SendingMessage'> &
  damlTypes.ToInterface<SendingMessage, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage> &
  SendingMessageInterface

export declare type SendingMessageDeps = {
  router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const SendingMessageDeps:
  damlTypes.Serializable<SendingMessageDeps>

export declare type SendingMessageState =
  | 'SendingMessageState_RequirePoolCCVs'
  | 'SendingMessageState_Prepared'
  | 'SendingMessageState_TokenLocked'
  | 'SendingMessageState_ExecutorFinalized'
  | 'SendingMessageState_FeeFinalized'


export declare const SendingMessageState:
  damlTypes.Serializable<SendingMessageState> & { readonly keys: SendingMessageState[] } & { readonly [e in SendingMessageState]: e }

export declare type SetOutboundPoolCCVs = {
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
}

export declare const SetOutboundPoolCCVs:
  damlTypes.Serializable<SetOutboundPoolCCVs>

export declare type TokenSendData = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: string,
  destTokenAddress: string,
  extraData: string,
}

export declare const TokenSendData:
  damlTypes.Serializable<TokenSendData>

export declare type TokenSendFee = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
}

export declare const TokenSendFee:
  damlTypes.Serializable<TokenSendFee>

export declare type VerifierData = {
  ccvInstanceId: string,
  ccvOwner: damlTypes.Party,
  versionTag: string,
  verifierBlob: string,
  messageSentObservers: damlTypes.Party[],
}

export declare const VerifierData:
  damlTypes.Serializable<VerifierData>
