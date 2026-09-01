// Generated from ../../../CCIP/InterfacesV2/TokenPool/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@daml.js/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type ITokenPool = damlTypes.Interface<'#ccip-extension-api-v2:CCIP.InterfacesV2.TokenPool:ITokenPool'> & TokenPoolView
export declare interface ITokenPoolInterface {
  Archive:
    damlTypes.Choice<ITokenPool, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_CalculateFee:
    damlTypes.Choice<ITokenPool, TokenPool_CalculateFee, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_GetFee:
    damlTypes.Choice<ITokenPool, TokenPool_GetFee, TokenPoolFeeQuote, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_GetRequiredCCVs:
    damlTypes.Choice<ITokenPool, TokenPool_GetRequiredCCVs, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_LockOrBurn:
    damlTypes.Choice<ITokenPool, TokenPool_LockOrBurn, LockOrBurnResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_ReleaseFromTicket:
    damlTypes.Choice<ITokenPool, TokenPool_ReleaseFromTicket, ReleaseOrMintResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_VerifyInboundMessage:
    damlTypes.Choice<ITokenPool, TokenPool_VerifyInboundMessage, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
  TokenPool_VerifyOutboundCCVs:
    damlTypes.Choice<ITokenPool, TokenPool_VerifyOutboundCCVs, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenPool, undefined>>;
}
export declare const ITokenPool:
  damlTypes.InterfaceCompanion<ITokenPool, undefined, '#ccip-extension-api-v2:CCIP.InterfacesV2.TokenPool:ITokenPool'> &
  damlTypes.FromTemplate<ITokenPool, unknown> &
  ITokenPoolInterface

export declare type LockOrBurnResult = {
  poolChangeCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  senderChangeCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const LockOrBurnResult:
  damlTypes.Serializable<LockOrBurnResult>

export declare type ReleaseOrMintResult = {
  output: ReleaseOrMintResult_Output,
  poolChangeCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  claimedEventCid: damlTypes.ContractId<{}>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ReleaseOrMintResult:
  damlTypes.Serializable<ReleaseOrMintResult>

export declare type ReleaseOrMintResult_Output =
  | { tag: 'ReleaseOrMintResult_Pending'; value: ReleaseOrMintResult_Output.ReleaseOrMintResult_Pending }
  | { tag: 'ReleaseOrMintResult_Completed'; value: ReleaseOrMintResult_Output.ReleaseOrMintResult_Completed }


export declare const ReleaseOrMintResult_Output:
  damlTypes.Serializable<ReleaseOrMintResult_Output> & {
    ReleaseOrMintResult_Completed: damlTypes.Serializable<ReleaseOrMintResult_Output.ReleaseOrMintResult_Completed>;
    ReleaseOrMintResult_Pending: damlTypes.Serializable<ReleaseOrMintResult_Output.ReleaseOrMintResult_Pending>;
  }

export namespace ReleaseOrMintResult_Output {
  type ReleaseOrMintResult_Completed = {
    receiverHoldingCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  }
  type ReleaseOrMintResult_Pending = {
    transferInstructionCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>,
  }
}

export declare type TokenPoolFeeQuote = {
  poolInstanceId: string,
  poolOwner: damlTypes.Party,
  feeUSDCents: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  tokenFeeBps: damlTypes.Numeric,
  isEnabled: boolean,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const TokenPoolFeeQuote:
  damlTypes.Serializable<TokenPoolFeeQuote>

export declare type TokenPoolView = {
  owner: damlTypes.Party,
  ccipOwner: damlTypes.Party,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const TokenPoolView:
  damlTypes.Serializable<TokenPoolView>

export declare type TokenPool_CalculateFee = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  feeQuoterCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter>,
  tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_CalculateFee:
  damlTypes.Serializable<TokenPool_CalculateFee>

export declare type TokenPool_GetFee = {
  feeQuoterCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter>,
  destChainSelector: damlTypes.Numeric,
  tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_GetFee:
  damlTypes.Serializable<TokenPool_GetFee>

export declare type TokenPool_GetRequiredCCVs = {
  remoteChainSelector: damlTypes.Numeric,
  sourceAmount: string,
  finality: string,
  extraData: string,
  direction: TransferDirection,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_GetRequiredCCVs:
  damlTypes.Serializable<TokenPool_GetRequiredCCVs>

export declare type TokenPool_LockOrBurn = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  senderInputCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  amount: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_LockOrBurn:
  damlTypes.Serializable<TokenPool_LockOrBurn>

export declare type TokenPool_ReleaseFromTicket = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  tokenReceiveTicketCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_ReleaseFromTicket:
  damlTypes.Serializable<TokenPool_ReleaseFromTicket>

export declare type TokenPool_VerifyInboundMessage = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  executingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_VerifyInboundMessage:
  damlTypes.Serializable<TokenPool_VerifyInboundMessage>

export declare type TokenPool_VerifyOutboundCCVs = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  amount: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenPool_VerifyOutboundCCVs:
  damlTypes.Serializable<TokenPool_VerifyOutboundCCVs>

export declare type TransferDirection =
  | 'Outbound'
  | 'Inbound'


export declare const TransferDirection:
  damlTypes.Serializable<TransferDirection> & { readonly keys: TransferDirection[] } & { readonly [e in TransferDirection]: e }
