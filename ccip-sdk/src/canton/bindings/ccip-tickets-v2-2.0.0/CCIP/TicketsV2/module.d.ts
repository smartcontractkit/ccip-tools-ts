// Generated from ../../CCIP/TicketsV2/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0';

export declare type Consume = {
}

export declare const Consume:
  damlTypes.Serializable<Consume>

export declare type TokenReceiveTicket = {
  ccipOwner: damlTypes.Party,
  ccvOwners: damlTypes.Party[],
  verifiedCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  requiredInboundPoolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  tokenAdminRegistryInstanceId: string,
  poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  poolOwner: damlTypes.Party,
  receiver: damlTypes.Party,
  tokenReceiver: damlTypes.Party,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: string,
  sourcePoolData: string,
  messageId: string,
  sourceChainSelector: damlTypes.Numeric,
  finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare interface TokenReceiveTicketInterface {
  Archive: 
    damlTypes.Choice<TokenReceiveTicket, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenReceiveTicket, undefined>>;
  Consume: 
    damlTypes.Choice<TokenReceiveTicket, Consume, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenReceiveTicket, undefined>>;
}
export declare const TokenReceiveTicket:
  damlTypes.Template<TokenReceiveTicket, undefined, '#ccip-tickets-v2:CCIP.TicketsV2:TokenReceiveTicket'> &
  damlTypes.ToInterface<TokenReceiveTicket, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket> &
  TokenReceiveTicketInterface
