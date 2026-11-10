// Generated from ../../../CCIP/EventsV2/Events/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';

import * as CCIP_EventsV2_Receipts from '../../../CCIP/EventsV2/Receipts/module';

export declare type CCIPMessageSent = {
  ccipOwner: damlTypes.Party,
  ccvOwners: damlTypes.Party[],
  sender: damlTypes.Party,
  observers: damlTypes.Party[],
  event: CCIPMessageSentEvent,
}

export declare interface CCIPMessageSentInterface {
  Archive: 
    damlTypes.Choice<CCIPMessageSent, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPMessageSent, undefined>>;
}
export declare const CCIPMessageSent:
  damlTypes.Template<CCIPMessageSent, undefined, '#ccip-events-v2:CCIP.EventsV2.Events:CCIPMessageSent'> &
  damlTypes.ToInterface<CCIPMessageSent, pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.ICCIPMessageSent> &
  CCIPMessageSentInterface

export declare type CCIPMessageSentEvent = {
  destChainSelector: damlTypes.Numeric,
  sequenceNumber: damlTypes.Numeric,
  messageId: string,
  feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenAmountBeforeTokenPoolFees: damlTypes.Numeric,
  encodedMessage: string,
  verifierBlobs: string[],
  receipts: CCIP_EventsV2_Receipts.Receipt[],
}

export declare const CCIPMessageSentEvent:
  damlTypes.Serializable<CCIPMessageSentEvent>

export declare type ExecutionStateChanged = {
  ccipOwner: damlTypes.Party,
  ccvOwners: damlTypes.Party[],
  receiver: damlTypes.Party,
  event: ExecutionStateChangedEvent,
}

export declare interface ExecutionStateChangedInterface {
  Archive: 
    damlTypes.Choice<ExecutionStateChanged, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<ExecutionStateChanged, undefined>>;
}
export declare const ExecutionStateChanged:
  damlTypes.Template<ExecutionStateChanged, undefined, '#ccip-events-v2:CCIP.EventsV2.Events:ExecutionStateChanged'> &
  damlTypes.ToInterface<ExecutionStateChanged, pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.IExecutionStateChanged> &
  ExecutionStateChangedInterface

export declare type ExecutionStateChangedEvent = {
  sourceChainSelector: damlTypes.Numeric,
  sequenceNumber: damlTypes.Numeric,
  messageId: string,
  state: pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.MessageExecutionState,
  returnData: string,
}

export declare const ExecutionStateChangedEvent:
  damlTypes.Serializable<ExecutionStateChangedEvent>

export declare type TokenReceiveTicketClaimed = {
  ccipOwner: damlTypes.Party,
  ccvOwners: damlTypes.Party[],
  poolOwner: damlTypes.Party,
  receiver: damlTypes.Party,
  tokenReceiver: damlTypes.Party,
  tokenReceiveTicketCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket>,
  event: TokenReceiveTicketClaimedEvent,
}

export declare interface TokenReceiveTicketClaimedInterface {
  Archive: 
    damlTypes.Choice<TokenReceiveTicketClaimed, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenReceiveTicketClaimed, undefined>>;
}
export declare const TokenReceiveTicketClaimed:
  damlTypes.Template<TokenReceiveTicketClaimed, undefined, '#ccip-events-v2:CCIP.EventsV2.Events:TokenReceiveTicketClaimed'> &
  damlTypes.ToInterface<TokenReceiveTicketClaimed, never> &
  TokenReceiveTicketClaimedInterface

export declare type TokenReceiveTicketClaimedEvent = {
  verifiedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  tokenAdminRegistryInstanceId: string,
  poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  sourceAmount: string,
  localAmount: damlTypes.Numeric,
  sourcePoolData: string,
  messageId: string,
  sourceChainSelector: damlTypes.Numeric,
  finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  output: TokenReceiveTicketClaimed_Output,
}

export declare const TokenReceiveTicketClaimedEvent:
  damlTypes.Serializable<TokenReceiveTicketClaimedEvent>

export declare type TokenReceiveTicketClaimed_Output =
  | { tag: 'TokenReceiveTicketClaimed_Pending'; value: TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Pending }
  | { tag: 'TokenReceiveTicketClaimed_Completed'; value: TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Completed }


export declare const TokenReceiveTicketClaimed_Output:
  damlTypes.Serializable<TokenReceiveTicketClaimed_Output> & {
    TokenReceiveTicketClaimed_Completed: damlTypes.Serializable<TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Completed>;
    TokenReceiveTicketClaimed_Pending: damlTypes.Serializable<TokenReceiveTicketClaimed_Output.TokenReceiveTicketClaimed_Pending>;
  }

export namespace TokenReceiveTicketClaimed_Output {
  type TokenReceiveTicketClaimed_Completed = {
    receiverHoldingCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  }
  type TokenReceiveTicketClaimed_Pending = {
    transferInstructionCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>,
  }
}
