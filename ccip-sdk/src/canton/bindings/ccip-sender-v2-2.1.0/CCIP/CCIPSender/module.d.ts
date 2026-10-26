// Generated from ../../CCIP/CCIPSender/module.daml

import type * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0'
import type * as pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0'
import type * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0'
import type * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0'
import type * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0'
import type * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0'
import type * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0'
import type * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-transfer-instruction-v1-1.0.0'
import type * as damlTypes from '@daml/types'
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation'

export declare type CCIPSender = {
  instanceId: string
  owner: damlTypes.Party
}

export declare interface CCIPSenderInterface {
  Archive: damlTypes.Choice<
    CCIPSender,
    pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive,
    {},
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPSender, undefined>>
  GetFee: damlTypes.Choice<CCIPSender, GetFee, GetFeeResult, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPSender, undefined>>
  GetRequiredCCVs: damlTypes.Choice<
    CCIPSender,
    GetRequiredCCVs,
    pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPSender, undefined>>
  Send: damlTypes.Choice<
    CCIPSender,
    Send,
    pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.CCIPSendResult,
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPSender, undefined>>
}
export declare const CCIPSender: damlTypes.Template<
  CCIPSender,
  undefined,
  '#ccip-sender-v2:CCIP.CCIPSender:CCIPSender'
> &
  damlTypes.ToInterface<CCIPSender, never> &
  CCIPSenderInterface

export declare type CCVSendInput = {
  ccvAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress
  ccvCid: damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier>
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const CCVSendInput: damlTypes.Serializable<CCVSendInput>

export declare type ExecutorInput = {
  executorCid: damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.Executor.IExecutor>
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const ExecutorInput: damlTypes.Serializable<ExecutorInput>

export declare type FeeTokenInput = {
  senderInputCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[]
  feeTokenConfigCid: damlTypes.ContractId<pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig>
  feeTokenTransferFactory: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>
  feeTokenExtraArgs: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ExtraArgs
}

export declare const FeeTokenInput: damlTypes.Serializable<FeeTokenInput>

export declare type GetFee = {
  destinationChainSelector: damlTypes.Numeric
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage
  routerCid: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  ccvSendInputs: CCVSendInput[]
  tokenTransferInput: damlTypes.Optional<TokenTransferInput>
  executorInput: damlTypes.Optional<ExecutorInput>
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const GetFee: damlTypes.Serializable<GetFee>

export declare type GetFeeResult = {
  feeTokenAmount: damlTypes.Numeric
  poolFeeTokenAmount: damlTypes.Numeric
}

export declare const GetFeeResult: damlTypes.Serializable<GetFeeResult>

export declare type GetRequiredCCVs = {
  destinationChainSelector: damlTypes.Numeric
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage
  routerCid: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  tokenPoolCid: damlTypes.Optional<
    damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool>
  >
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const GetRequiredCCVs: damlTypes.Serializable<GetRequiredCCVs>

export declare type Send = {
  destinationChainSelector: damlTypes.Numeric
  message: pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.Canton2AnyMessage
  routerCid: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  feeTokenInput: FeeTokenInput
  ccvSendInputs: CCVSendInput[]
  tokenTransferInput: damlTypes.Optional<TokenTransferInput>
  executorInput: damlTypes.Optional<ExecutorInput>
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const Send: damlTypes.Serializable<Send>

export declare type TokenTransferInput = {
  senderInputCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[]
  tokenPoolCid: damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool>
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const TokenTransferInput: damlTypes.Serializable<TokenTransferInput>
