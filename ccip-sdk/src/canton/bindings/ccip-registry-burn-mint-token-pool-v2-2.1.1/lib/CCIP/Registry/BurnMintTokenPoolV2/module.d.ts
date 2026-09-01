// Generated from ../../../CCIP/Registry/BurnMintTokenPoolV2/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@daml.js/ccip-extension-api-v2-2.0.0';
import * as pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3 from '@daml.js/ccip-core-v2-2.1.1';
import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92 from '@daml.js/ccip-registry-rate-limiter-v2-2.0.1';
import * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@daml.js/ccip-codec-v2-2.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

import * as CCIP_Registry_BurnMintTokenPoolV2Types from '../../../CCIP/Registry/BurnMintTokenPoolV2Types/module';

export declare type AddPoolReceiveContextContractValue = {
  contextKey: string,
  referredContract: damlTypes.ContractId<{}>,
}

export declare const AddPoolReceiveContextContractValue:
  damlTypes.Serializable<AddPoolReceiveContextContractValue>

export declare type AddPoolReceiveContextNonContractValue = {
  contextKey: string,
  value: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.AnyValue,
}

export declare const AddPoolReceiveContextNonContractValue:
  damlTypes.Serializable<AddPoolReceiveContextNonContractValue>

export declare type ApplyChainUpdates = {
  remoteChainSelectorsToRemove: damlTypes.Numeric[],
  chainsToAdd: CCIP_Registry_BurnMintTokenPoolV2Types.ChainUpdate[],
}

export declare const ApplyChainUpdates:
  damlTypes.Serializable<ApplyChainUpdates>

export declare type ApplyTokenTransferFeeConfigUpdates = {
  tokenTransferFeeConfigArgs: CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfigArgs[],
  disableTokenTransferFeeConfigArgs: damlTypes.Numeric[],
}

export declare const ApplyTokenTransferFeeConfigUpdates:
  damlTypes.Serializable<ApplyTokenTransferFeeConfigUpdates>

export declare type BurnMintTokenPool = {
  instanceId: string,
  poolOwner: damlTypes.Party,
  ccipOwner: damlTypes.Party,
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  decimals: damlTypes.Int,
  rateLimitAdmin: damlTypes.Optional<damlTypes.Party>,
  observers: damlTypes.Party[],
  remoteChainConfigs: damlTypes.Map<damlTypes.Numeric, CCIP_Registry_BurnMintTokenPoolV2Types.RemoteChainConfig>,
  tokenTransferFeeConfigs: damlTypes.Map<damlTypes.Numeric, CCIP_Registry_BurnMintTokenPoolV2Types.TokenTransferFeeConfig>,
  poolReceiveContext: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  transferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout,
  deps: BurnMintTokenPoolDeps,
}

export declare interface BurnMintTokenPoolInterface {
  AddPoolReceiveContextContractValue: 
    damlTypes.Choice<BurnMintTokenPool, AddPoolReceiveContextContractValue, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  AddPoolReceiveContextNonContractValue: 
    damlTypes.Choice<BurnMintTokenPool, AddPoolReceiveContextNonContractValue, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  ApplyChainUpdates: 
    damlTypes.Choice<BurnMintTokenPool, ApplyChainUpdates, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  ApplyTokenTransferFeeConfigUpdates: 
    damlTypes.Choice<BurnMintTokenPool, ApplyTokenTransferFeeConfigUpdates, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  Archive: 
    damlTypes.Choice<BurnMintTokenPool, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  CalculateFee: 
    damlTypes.Choice<BurnMintTokenPool, CalculateFee, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  ClearPoolReceiveContext: 
    damlTypes.Choice<BurnMintTokenPool, ClearPoolReceiveContext, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  GetFee: 
    damlTypes.Choice<BurnMintTokenPool, GetFee, pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TokenPoolFeeQuote, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  GetRequiredCCVs: 
    damlTypes.Choice<BurnMintTokenPool, GetRequiredCCVs, pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  Initialize: 
    damlTypes.Choice<BurnMintTokenPool, Initialize, InitializeResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  LockOrBurn: 
    damlTypes.Choice<BurnMintTokenPool, LockOrBurn, pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.LockOrBurnResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  ReleaseFromTicket: 
    damlTypes.Choice<BurnMintTokenPool, ReleaseFromTicket, pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  RemovePoolReceiveContextValue: 
    damlTypes.Choice<BurnMintTokenPool, RemovePoolReceiveContextValue, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  SetDynamicConfig: 
    damlTypes.Choice<BurnMintTokenPool, SetDynamicConfig, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  SetObservers: 
    damlTypes.Choice<BurnMintTokenPool, SetObservers, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  SetRateLimitConfig: 
    damlTypes.Choice<BurnMintTokenPool, SetRateLimitConfig, damlTypes.ContractId<pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  SetRateLimiterReferences: 
    damlTypes.Choice<BurnMintTokenPool, SetRateLimiterReferences, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  SetTransferTimeout: 
    damlTypes.Choice<BurnMintTokenPool, SetTransferTimeout, damlTypes.ContractId<BurnMintTokenPool>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  VerifyInboundMessage: 
    damlTypes.Choice<BurnMintTokenPool, VerifyInboundMessage, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
  VerifyOutboundCCVs: 
    damlTypes.Choice<BurnMintTokenPool, VerifyOutboundCCVs, damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<BurnMintTokenPool, undefined>>;
}
export declare const BurnMintTokenPool:
  damlTypes.Template<BurnMintTokenPool, undefined, '#ccip-registry-burn-mint-token-pool-v2:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'> &
  damlTypes.ToInterface<BurnMintTokenPool, pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  BurnMintTokenPoolInterface

export declare type BurnMintTokenPoolDeps = {
  tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  feeQuoter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
}

export declare const BurnMintTokenPoolDeps:
  damlTypes.Serializable<BurnMintTokenPoolDeps>

export declare type CalculateFee = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  feeQuoterCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter>,
  tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const CalculateFee:
  damlTypes.Serializable<CalculateFee>

export declare type ClearPoolReceiveContext = {
}

export declare const ClearPoolReceiveContext:
  damlTypes.Serializable<ClearPoolReceiveContext>

export declare type GetFee = {
  feeQuoterCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.FeeQuoter.IFeeQuoter>,
  destChainSelector: damlTypes.Numeric,
  tokenInstrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetFee:
  damlTypes.Serializable<GetFee>

export declare type GetRequiredCCVs = {
  remoteChainSelector: damlTypes.Numeric,
  sourceAmount: string,
  finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig,
  extraData: string,
  direction: pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.TransferDirection,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetRequiredCCVs:
  damlTypes.Serializable<GetRequiredCCVs>

export declare type Initialize = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenAdminRegistry>,
  existingTokenConfigCid: damlTypes.Optional<damlTypes.ContractId<pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig>>,
  admin: damlTypes.Party,
  lanes: CCIP_Registry_BurnMintTokenPoolV2Types.LaneDeploySpec[],
}

export declare const Initialize:
  damlTypes.Serializable<Initialize>

export declare type InitializeResult = {
  rateLimiterCids: damlTypes.ContractId<pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter>[],
  tokenConfigCid: damlTypes.ContractId<pkg35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3.CCIP.CoreV2.TokenAdminRegistry.TokenConfig>,
}

export declare const InitializeResult:
  damlTypes.Serializable<InitializeResult>

export declare type LockOrBurn = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  senderInputCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[],
  amount: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const LockOrBurn:
  damlTypes.Serializable<LockOrBurn>

export declare type ReleaseFromTicket = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  rmnRemoteCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote>,
  tokenReceiveTicketCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const ReleaseFromTicket:
  damlTypes.Serializable<ReleaseFromTicket>

export declare type RemovePoolReceiveContextValue = {
  contextKey: string,
}

export declare const RemovePoolReceiveContextValue:
  damlTypes.Serializable<RemovePoolReceiveContextValue>

export declare type SetDynamicConfig = {
  rateLimitAdmin: damlTypes.Optional<damlTypes.Party>,
}

export declare const SetDynamicConfig:
  damlTypes.Serializable<SetDynamicConfig>

export declare type SetObservers = {
  observers: damlTypes.Party[],
}

export declare const SetObservers:
  damlTypes.Serializable<SetObservers>

export declare type SetRateLimitConfig = {
  caller: damlTypes.Party,
  rateLimiterCid: damlTypes.ContractId<pkg6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92.CCIP.Registry.RateLimiterV2.RateLimiter>,
  newIsEnabled: boolean,
  newCapacity: damlTypes.Numeric,
  newRate: damlTypes.Numeric,
}

export declare const SetRateLimitConfig:
  damlTypes.Serializable<SetRateLimitConfig>

export declare type SetRateLimiterReferences = {
  rateLimitConfigArgs: CCIP_Registry_BurnMintTokenPoolV2Types.RateLimitConfigArgs[],
}

export declare const SetRateLimiterReferences:
  damlTypes.Serializable<SetRateLimiterReferences>

export declare type SetTransferTimeout = {
  newTransferTimeout: CCIP_Registry_BurnMintTokenPoolV2Types.TransferTimeout,
}

export declare const SetTransferTimeout:
  damlTypes.Serializable<SetTransferTimeout>

export declare type VerifyInboundMessage = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  executingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage>,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const VerifyInboundMessage:
  damlTypes.Serializable<VerifyInboundMessage>

export declare type VerifyOutboundCCVs = {
  tokenAdminRegistryCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry>,
  tokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>,
  sendingMessageCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.SendingMessage.ISendingMessage>,
  amount: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const VerifyOutboundCCVs:
  damlTypes.Serializable<VerifyOutboundCCVs>
