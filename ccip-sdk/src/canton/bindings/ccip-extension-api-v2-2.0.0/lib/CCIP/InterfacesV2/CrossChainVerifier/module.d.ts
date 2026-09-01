// Generated from ../../../CCIP/InterfacesV2/CrossChainVerifier/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type ICrossChainVerifier = damlTypes.Interface<'#ccip-extension-api-v2:CCIP.InterfacesV2.CrossChainVerifier:ICrossChainVerifier'> & CrossChainVerifierView
export declare interface ICrossChainVerifierInterface {
  Archive:
    damlTypes.Choice<ICrossChainVerifier, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined>>;
  CrossChainVerifier_CalculateFee:
    damlTypes.Choice<ICrossChainVerifier, CrossChainVerifier_CalculateFee, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined>>;
  CrossChainVerifier_ForwardToVerifier:
    damlTypes.Choice<ICrossChainVerifier, CrossChainVerifier_ForwardToVerifier, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined>>;
  CrossChainVerifier_GetFee:
    damlTypes.Choice<ICrossChainVerifier, CrossChainVerifier_GetFee, CrossChainVerifierFeeQuote, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined>>;
  CrossChainVerifier_VerifyMessage:
    damlTypes.Choice<ICrossChainVerifier, CrossChainVerifier_VerifyMessage, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined>>;
}
export declare const ICrossChainVerifier:
  damlTypes.InterfaceCompanion<ICrossChainVerifier, undefined, '#ccip-extension-api-v2:CCIP.InterfacesV2.CrossChainVerifier:ICrossChainVerifier'> &
  damlTypes.FromTemplate<ICrossChainVerifier, unknown> &
  ICrossChainVerifierInterface

export declare type CrossChainVerifierFeeQuote = {
  ccvInstanceId: string,
  ccvOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  gasForVerification: damlTypes.Int,
  payloadSizeBytes: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const CrossChainVerifierFeeQuote:
  damlTypes.Serializable<CrossChainVerifierFeeQuote>

export declare type CrossChainVerifierView = {
  instanceId: string,
  owner: damlTypes.Party,
  ccipOwner: damlTypes.Party,
  storageLocations: string[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const CrossChainVerifierView:
  damlTypes.Serializable<CrossChainVerifierView>

export declare type CrossChainVerifier_CalculateFee = {
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CrossChainVerifier_CalculateFee:
  damlTypes.Serializable<CrossChainVerifier_CalculateFee>

export declare type CrossChainVerifier_ForwardToVerifier = {
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  verifierArgs: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CrossChainVerifier_ForwardToVerifier:
  damlTypes.Serializable<CrossChainVerifier_ForwardToVerifier>

export declare type CrossChainVerifier_GetFee = {
  destChainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CrossChainVerifier_GetFee:
  damlTypes.Serializable<CrossChainVerifier_GetFee>

export declare type CrossChainVerifier_VerifyMessage = {
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  executingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>,
  verifierResults: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CrossChainVerifier_VerifyMessage:
  damlTypes.Serializable<CrossChainVerifier_VerifyMessage>
