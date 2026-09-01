// Generated from ../../../CCIP/APIV2/TokenAdminRegistry/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@daml.js/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e from '@daml.js/splice-api-token-burn-mint-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

import * as CCIP_APIV2_ExecutingMessage from '../ExecutingMessage/module';
import * as CCIP_APIV2_SendingMessage from '../SendingMessage/module';

export declare type ITokenAdminRegistry = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenAdminRegistry'> & TokenAdminRegistryView
export declare interface ITokenAdminRegistryInterface {
  Archive:
    damlTypes.Choice<ITokenAdminRegistry, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_AcceptAdminRole:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_AcceptAdminRole, damlTypes.ContractId<ITokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_AddTokenSend:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_AddTokenSend, damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_AddTokenSendFee:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_AddTokenSendFee, damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_ConsumeReceiveTicket:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_ConsumeReceiveTicket, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_FetchTokenConfig:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_FetchTokenConfig, TokenConfigView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_IsAdministrator:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_IsAdministrator, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_ProposeAdministrator:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_ProposeAdministrator, ProposeAdministratorResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_PublicFetch:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_PublicFetch, TokenAdminRegistryView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_SetBurnMintFactory:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_SetBurnMintFactory, damlTypes.ContractId<ITokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_SetInboundPoolCCVs:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_SetInboundPoolCCVs, damlTypes.ContractId<CCIP_APIV2_ExecutingMessage.IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_SetOutboundPoolCCVs:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_SetOutboundPoolCCVs, damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_SetPool:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_SetPool, damlTypes.ContractId<ITokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_SetTransferFactory:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_SetTransferFactory, damlTypes.ContractId<ITokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
  TokenAdminRegistry_TransferAdminRole:
    damlTypes.Choice<ITokenAdminRegistry, TokenAdminRegistry_TransferAdminRole, damlTypes.ContractId<ITokenConfig>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined>>;
}
export declare const ITokenAdminRegistry:
  damlTypes.InterfaceCompanion<ITokenAdminRegistry, undefined, '#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenAdminRegistry'> &
  damlTypes.FromTemplate<ITokenAdminRegistry, unknown> &
  ITokenAdminRegistryInterface

export declare type ITokenConfig = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenConfig'> & TokenConfigView
export declare interface ITokenConfigInterface {
  Archive:
    damlTypes.Choice<ITokenConfig, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenConfig, undefined>>;
  TokenConfig_AssertConfiguredBurnMintFactory:
    damlTypes.Choice<ITokenConfig, TokenConfig_AssertConfiguredBurnMintFactory, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenConfig, undefined>>;
  TokenConfig_AssertConfiguredTransferFactory:
    damlTypes.Choice<ITokenConfig, TokenConfig_AssertConfiguredTransferFactory, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenConfig, undefined>>;
  TokenConfig_PublicFetch:
    damlTypes.Choice<ITokenConfig, TokenConfig_PublicFetch, TokenConfigView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<ITokenConfig, undefined>>;
}
export declare const ITokenConfig:
  damlTypes.InterfaceCompanion<ITokenConfig, undefined, '#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenConfig'> &
  damlTypes.FromTemplate<ITokenConfig, unknown> &
  ITokenConfigInterface

export declare type PoolRegistration = {
  poolOwner: damlTypes.Party,
  poolInstanceId: string,
}

export declare const PoolRegistration:
  damlTypes.Serializable<PoolRegistration>

export declare type ProposeAdministratorResult = {
  tokenAdminRegistryCid: damlTypes.ContractId<ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  created: boolean,
  index: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const ProposeAdministratorResult:
  damlTypes.Serializable<ProposeAdministratorResult>

export declare type TokenAdminRegistryView = {
  ccipOwner: damlTypes.Party,
  instanceId: string,
}

export declare const TokenAdminRegistryView:
  damlTypes.Serializable<TokenAdminRegistryView>

export declare type TokenAdminRegistry_AcceptAdminRole = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_AcceptAdminRole:
  damlTypes.Serializable<TokenAdminRegistry_AcceptAdminRole>

export declare type TokenAdminRegistry_AddTokenSend = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>,
  poolInstanceId: string,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  amount: string,
  destTokenAddress: string,
  extraData: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_AddTokenSend:
  damlTypes.Serializable<TokenAdminRegistry_AddTokenSend>

export declare type TokenAdminRegistry_AddTokenSendFee = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>,
  poolInstanceId: string,
  feeUSDCents: damlTypes.Numeric,
  destGasOverhead: damlTypes.Int,
  destBytesOverhead: damlTypes.Int,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_AddTokenSendFee:
  damlTypes.Serializable<TokenAdminRegistry_AddTokenSendFee>

export declare type TokenAdminRegistry_ConsumeReceiveTicket = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  tokenReceiveTicketCid: damlTypes.ContractId<CCIP_APIV2_ExecutingMessage.ITokenReceiveTicket>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  poolInstanceId: string,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_ConsumeReceiveTicket:
  damlTypes.Serializable<TokenAdminRegistry_ConsumeReceiveTicket>

export declare type TokenAdminRegistry_FetchTokenConfig = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_FetchTokenConfig:
  damlTypes.Serializable<TokenAdminRegistry_FetchTokenConfig>

export declare type TokenAdminRegistry_IsAdministrator = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<ITokenConfig>>,
  administrator: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_IsAdministrator:
  damlTypes.Serializable<TokenAdminRegistry_IsAdministrator>

export declare type TokenAdminRegistry_ProposeAdministrator = {
  tokenConfigCid: damlTypes.Optional<damlTypes.ContractId<ITokenConfig>>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_ProposeAdministrator:
  damlTypes.Serializable<TokenAdminRegistry_ProposeAdministrator>

export declare type TokenAdminRegistry_PublicFetch = {
  expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_PublicFetch:
  damlTypes.Serializable<TokenAdminRegistry_PublicFetch>

export declare type TokenAdminRegistry_SetBurnMintFactory = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  burnMintFactory: damlTypes.Optional<damlTypes.ContractId<pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory>>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_SetBurnMintFactory:
  damlTypes.Serializable<TokenAdminRegistry_SetBurnMintFactory>

export declare type TokenAdminRegistry_SetInboundPoolCCVs = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  executingMessageCid: damlTypes.ContractId<CCIP_APIV2_ExecutingMessage.IExecutingMessage>,
  poolInstanceId: string,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_SetInboundPoolCCVs:
  damlTypes.Serializable<TokenAdminRegistry_SetInboundPoolCCVs>

export declare type TokenAdminRegistry_SetOutboundPoolCCVs = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<CCIP_APIV2_SendingMessage.ISendingMessage>,
  poolInstanceId: string,
  poolCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_SetOutboundPoolCCVs:
  damlTypes.Serializable<TokenAdminRegistry_SetOutboundPoolCCVs>

export declare type TokenAdminRegistry_SetPool = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenPool: damlTypes.Optional<PoolRegistration>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_SetPool:
  damlTypes.Serializable<TokenAdminRegistry_SetPool>

export declare type TokenAdminRegistry_SetTransferFactory = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  transferFactory: damlTypes.Optional<damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_SetTransferFactory:
  damlTypes.Serializable<TokenAdminRegistry_SetTransferFactory>

export declare type TokenAdminRegistry_TransferAdminRole = {
  tokenConfigCid: damlTypes.ContractId<ITokenConfig>,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenAdminRegistry_TransferAdminRole:
  damlTypes.Serializable<TokenAdminRegistry_TransferAdminRole>

export declare type TokenConfigView = {
  ccipOwner: damlTypes.Party,
  instanceId: string,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenPool: damlTypes.Optional<PoolRegistration>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
}

export declare const TokenConfigView:
  damlTypes.Serializable<TokenConfigView>

export declare type TokenConfig_AssertConfiguredBurnMintFactory = {
  suppliedFactory: damlTypes.ContractId<pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenConfig_AssertConfiguredBurnMintFactory:
  damlTypes.Serializable<TokenConfig_AssertConfiguredBurnMintFactory>

export declare type TokenConfig_AssertConfiguredTransferFactory = {
  suppliedFactory: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenConfig_AssertConfiguredTransferFactory:
  damlTypes.Serializable<TokenConfig_AssertConfiguredTransferFactory>

export declare type TokenConfig_PublicFetch = {
  expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const TokenConfig_PublicFetch:
  damlTypes.Serializable<TokenConfig_PublicFetch>
