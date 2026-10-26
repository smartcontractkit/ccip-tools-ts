// Generated from ../../CCIP/CCIPReceiver/module.daml

import type * as pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-client-api-v2-2.0.0'
import type * as pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb from '@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0'
import type * as pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4 from '@chainlink/ccip-sdk/src/canton/bindings/ccip-extension-api-v2-2.0.0'
import type * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0'
import type * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0'
import type * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0'
import type * as damlTypes from '@daml/types'
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation'

export declare type CCIPMessageReceived = {
  owner: damlTypes.Party
  router: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  messageId: string
  message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1
  tokenReleaseResult: damlTypes.Optional<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ReleaseOrMintResult>
}

export declare interface CCIPMessageReceivedInterface {
  Archive: damlTypes.Choice<
    CCIPMessageReceived,
    pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive,
    {},
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPMessageReceived, undefined>>
}
export declare const CCIPMessageReceived: damlTypes.Template<
  CCIPMessageReceived,
  undefined,
  '#ccip-receiver-v2:CCIP.CCIPReceiver:CCIPMessageReceived'
> &
  damlTypes.ToInterface<CCIPMessageReceived, never> &
  CCIPMessageReceivedInterface

export declare type CCIPReceiver = {
  instanceId: string
  owner: damlTypes.Party
  requiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[]
  optionalCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[]
  optionalThreshold: damlTypes.Int
  receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig
}

export declare interface CCIPReceiverInterface {
  Archive: damlTypes.Choice<
    CCIPReceiver,
    pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive,
    {},
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPReceiver, undefined>>
  Execute: damlTypes.Choice<
    CCIPReceiver,
    Execute,
    damlTypes.ContractId<CCIPMessageReceived>,
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPReceiver, undefined>>
  GetRequiredCCVs: damlTypes.Choice<
    CCIPReceiver,
    GetRequiredCCVs,
    pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[],
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPReceiver, undefined>>
  UpdateRequiredCCVs: damlTypes.Choice<
    CCIPReceiver,
    UpdateRequiredCCVs,
    damlTypes.ContractId<CCIPReceiver>,
    undefined
  > &
    damlTypes.ChoiceFrom<damlTypes.Template<CCIPReceiver, undefined>>
}
export declare const CCIPReceiver: damlTypes.Template<
  CCIPReceiver,
  undefined,
  '#ccip-receiver-v2:CCIP.CCIPReceiver:CCIPReceiver'
> &
  damlTypes.ToInterface<CCIPReceiver, never> &
  CCIPReceiverInterface

export declare type CCVInput = {
  ccvCid: damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.CrossChainVerifier.ICrossChainVerifier>
  verifierResults: string
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const CCVInput: damlTypes.Serializable<CCVInput>

export declare type Execute = {
  routerCid: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  encodedMessage: string
  tokenTransfer: damlTypes.Optional<TokenTransferInput>
  ccvInputs: CCVInput[]
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const Execute: damlTypes.Serializable<Execute>

export declare type GetRequiredCCVs = {
  routerCid: damlTypes.ContractId<pkgb8e4dfb8d64853c7f9aee4e93385462587745bdc703fceb750993f2723ebd984.CCIP.ClientV2.PerPartyRouter>
  encodedMessage: string
  tokenPoolCid: damlTypes.Optional<
    damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool>
  >
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const GetRequiredCCVs: damlTypes.Serializable<GetRequiredCCVs>

export declare type TokenTransferInput = {
  tokenPoolCid: damlTypes.ContractId<pkg289011bdbefe42c7dbea0a4f101127095e8b5f5281d45c84f6eca06de11689a4.CCIP.InterfacesV2.TokenPool.ITokenPool>
  tokenReceiverParty: damlTypes.Party
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext
}

export declare const TokenTransferInput: damlTypes.Serializable<TokenTransferInput>

export declare type UpdateRequiredCCVs = {
  newRequiredCCVs: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress[]
}

export declare const UpdateRequiredCCVs: damlTypes.Serializable<UpdateRequiredCCVs>
