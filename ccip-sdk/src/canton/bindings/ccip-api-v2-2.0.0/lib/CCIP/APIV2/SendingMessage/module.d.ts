// Generated from ../../../CCIP/APIV2/SendingMessage/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type ISendingMessage = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.SendingMessage:ISendingMessage'> & SendingMessageView
export declare interface ISendingMessageInterface {
  Archive:
    damlTypes.Choice<ISendingMessage, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ISendingMessage, undefined>>;
  SendingMessage_AddCCVFee:
    damlTypes.Choice<ISendingMessage, SendingMessage_AddCCVFee, damlTypes.ContractId<ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ISendingMessage, undefined>>;
  SendingMessage_AddExecutorFee:
    damlTypes.Choice<ISendingMessage, SendingMessage_AddExecutorFee, damlTypes.ContractId<ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ISendingMessage, undefined>>;
  SendingMessage_AddVerifierData:
    damlTypes.Choice<ISendingMessage, SendingMessage_AddVerifierData, damlTypes.ContractId<ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ISendingMessage, undefined>>;
  SendingMessage_FeeTokenAmount:
    damlTypes.Choice<ISendingMessage, SendingMessage_FeeTokenAmount, damlTypes.Numeric, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ISendingMessage, undefined>>;
}
export declare const ISendingMessage:
  damlTypes.InterfaceCompanion<ISendingMessage, undefined, '#ccip-api-v2:CCIP.APIV2.SendingMessage:ISendingMessage'> &
  damlTypes.FromTemplate<ISendingMessage, unknown> &
  ISendingMessageInterface

export declare type SendingMessageView = {
  ccipOwner: damlTypes.Party,
  sender: damlTypes.Party,
  destChainSelector: damlTypes.Numeric,
  requiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  outboundPoolCCVs: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[]>,
  router: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  onRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const SendingMessageView:
  damlTypes.Serializable<SendingMessageView>

export declare type SendingMessage_AddCCVFee = {
  ccvInstanceId: string,
  feeUSDCents: damlTypes.Numeric,
  destGasLimit: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SendingMessage_AddCCVFee:
  damlTypes.Serializable<SendingMessage_AddCCVFee>

export declare type SendingMessage_AddExecutorFee = {
  executorInstanceId: string,
  executorArgs: string,
  feeUSDCents: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SendingMessage_AddExecutorFee:
  damlTypes.Serializable<SendingMessage_AddExecutorFee>

export declare type SendingMessage_AddVerifierData = {
  ccvInstanceId: string,
  versionTag: string,
  verifierBlob: string,
  messageSentObservers: damlTypes.Party[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SendingMessage_AddVerifierData:
  damlTypes.Serializable<SendingMessage_AddVerifierData>

export declare type SendingMessage_FeeTokenAmount = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SendingMessage_FeeTokenAmount:
  damlTypes.Serializable<SendingMessage_FeeTokenAmount>
