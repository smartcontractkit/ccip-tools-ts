// Generated from ../../../CCIP/CoreV2/TokenAdminRegistry/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d from '@daml.js/ccip-tickets-v2-2.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@daml.js/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e from '@daml.js/splice-api-token-burn-mint-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

import * as CCIP_CoreV2_ExecutingMessage from '../../../CCIP/CoreV2/ExecutingMessage/module';
import * as CCIP_CoreV2_SendingMessage from '../../../CCIP/CoreV2/SendingMessage/module';
import * as CCIP_CoreV2_TokenAdminRegistryTypes from '../../../CCIP/CoreV2/TokenAdminRegistryTypes/module';

export declare type AcceptAdminRole = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const AcceptAdminRole:
  damlTypes.Serializable<AcceptAdminRole>

export declare type AddTokenSend = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>,
  poolInstanceId: string,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: string,
  destTokenAddress: string,
  extraData: string,
  caller: damlTypes.Party,
}

export declare const AddTokenSend:
  damlTypes.Serializable<AddTokenSend>

export declare type AddTokenSendFee = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>,
  poolInstanceId: string,
  feeUSDCents: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  caller: damlTypes.Party,
}

export declare const AddTokenSendFee:
  damlTypes.Serializable<AddTokenSendFee>

export declare type ConsumeReceiveTicket = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  tokenReceiveTicketCid: damlTypes.ContractId<pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  poolInstanceId: string,
  caller: damlTypes.Party,
}

export declare const ConsumeReceiveTicket:
  damlTypes.Serializable<ConsumeReceiveTicket>

export declare type FinalizeExecute = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  executingMessageCid: damlTypes.ContractId<CCIP_CoreV2_ExecutingMessage.ExecutingMessage>,
  ticketReceiver: damlTypes.Party,
  returnData: string,
}

export declare const FinalizeExecute:
  damlTypes.Serializable<FinalizeExecute>

export declare type Get = {
  caller: damlTypes.Party,
}

export declare const Get:
  damlTypes.Serializable<Get>

export declare type GetTokenConfigByCid = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetTokenConfigByCid:
  damlTypes.Serializable<GetTokenConfigByCid>

export declare type IsAdministrator = {
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<TokenConfig>>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  administrator: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const IsAdministrator:
  damlTypes.Serializable<IsAdministrator>

export declare type ProposeAdministrator = {
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<TokenConfig>>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const ProposeAdministrator:
  damlTypes.Serializable<ProposeAdministrator>

export declare type ProposeAdministratorResult = {
  tokenAdminRegistryCid: damlTypes.ContractId<TokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  created: boolean,
  index: damlTypes.Int,
}

export declare const ProposeAdministratorResult:
  damlTypes.Serializable<ProposeAdministratorResult>

export declare type SetBurnMintFactory = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  burnMintFactory: damlTypes.Optional<damlTypes.ContractId<pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory>>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SetBurnMintFactory:
  damlTypes.Serializable<SetBurnMintFactory>

export declare type SetInboundPoolCCVs = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  executingMessageCid: damlTypes.ContractId<CCIP_CoreV2_ExecutingMessage.ExecutingMessage>,
  poolInstanceId: string,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  caller: damlTypes.Party,
}

export declare const SetInboundPoolCCVs:
  damlTypes.Serializable<SetInboundPoolCCVs>

export declare type SetOutboundPoolCCVs = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>,
  poolInstanceId: string,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  caller: damlTypes.Party,
}

export declare const SetOutboundPoolCCVs:
  damlTypes.Serializable<SetOutboundPoolCCVs>

export declare type SetPool = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenPool: damlTypes.Optional<CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SetPool:
  damlTypes.Serializable<SetPool>

export declare type SetTransferFactory = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  transferFactory: damlTypes.Optional<damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const SetTransferFactory:
  damlTypes.Serializable<SetTransferFactory>

export declare type TokenAdminRegistry = {
  instanceId: string,
  ccipOwner: damlTypes.Party,
  entryCount: damlTypes.Int,
}

export declare interface TokenAdminRegistryInterface {
  AcceptAdminRole: 
    damlTypes.Choice<TokenAdminRegistry, AcceptAdminRole, damlTypes.ContractId<TokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  AddTokenSend: 
    damlTypes.Choice<TokenAdminRegistry, AddTokenSend, damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  AddTokenSendFee: 
    damlTypes.Choice<TokenAdminRegistry, AddTokenSendFee, damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  Archive: 
    damlTypes.Choice<TokenAdminRegistry, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  ConsumeReceiveTicket: 
    damlTypes.Choice<TokenAdminRegistry, ConsumeReceiveTicket, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  FinalizeExecute: 
    damlTypes.Choice<TokenAdminRegistry, FinalizeExecute, CCIP_CoreV2_ExecutingMessage.FinalizeExecuteResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  Get: 
    damlTypes.Choice<TokenAdminRegistry, Get, TokenAdminRegistry, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  GetTokenConfigByCid: 
    damlTypes.Choice<TokenAdminRegistry, GetTokenConfigByCid, TokenConfig, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  IsAdministrator: 
    damlTypes.Choice<TokenAdminRegistry, IsAdministrator, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  ProposeAdministrator: 
    damlTypes.Choice<TokenAdminRegistry, ProposeAdministrator, ProposeAdministratorResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  SetBurnMintFactory: 
    damlTypes.Choice<TokenAdminRegistry, SetBurnMintFactory, damlTypes.ContractId<TokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  SetInboundPoolCCVs: 
    damlTypes.Choice<TokenAdminRegistry, SetInboundPoolCCVs, damlTypes.ContractId<CCIP_CoreV2_ExecutingMessage.ExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  SetOutboundPoolCCVs: 
    damlTypes.Choice<TokenAdminRegistry, SetOutboundPoolCCVs, damlTypes.ContractId<CCIP_CoreV2_SendingMessage.SendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  SetPool: 
    damlTypes.Choice<TokenAdminRegistry, SetPool, damlTypes.ContractId<TokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  SetTransferFactory: 
    damlTypes.Choice<TokenAdminRegistry, SetTransferFactory, damlTypes.ContractId<TokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
  TransferAdminRole: 
    damlTypes.Choice<TokenAdminRegistry, TransferAdminRole, damlTypes.ContractId<TokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenAdminRegistry, undefined>>;
}
export declare const TokenAdminRegistry:
  damlTypes.Template<TokenAdminRegistry, undefined, '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'> &
  damlTypes.ToInterface<TokenAdminRegistry, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  TokenAdminRegistryInterface

export declare type TokenConfig = {
  instanceId: string,
  registryInstanceId: string,
  registryOwner: damlTypes.Party,
  index: damlTypes.Int,
  isCCIPManaged: boolean,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  admin: damlTypes.Optional<damlTypes.Party>,
  pendingAdmin: damlTypes.Optional<damlTypes.Party>,
  tokenPool: damlTypes.Optional<CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration>,
  transferFactory: damlTypes.Optional<damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>>,
  burnMintFactory: damlTypes.Optional<damlTypes.ContractId<pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory>>,
}

export declare interface TokenConfigInterface {
  Archive: 
    damlTypes.Choice<TokenConfig, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<TokenConfig, undefined>>;
}
export declare const TokenConfig:
  damlTypes.Template<TokenConfig, undefined, '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'> &
  damlTypes.ToInterface<TokenConfig, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig> &
  TokenConfigInterface

export declare type TransferAdminRole = {
  tokenConfigCid: damlTypes.ContractId<TokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TransferAdminRole:
  damlTypes.Serializable<TransferAdminRole>
