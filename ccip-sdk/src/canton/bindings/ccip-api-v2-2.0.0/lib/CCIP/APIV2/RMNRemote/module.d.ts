// Generated from ../../../CCIP/APIV2/RMNRemote/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type IRMNRemote = damlTypes.Interface<'#ccip-api-v2:CCIP.APIV2.RMNRemote:IRMNRemote'> & RMNRemoteView
export declare interface IRMNRemoteInterface {
  Archive:
    damlTypes.Choice<IRMNRemote, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IRMNRemote, undefined>>;
  RMNRemote_GetCursedSubjects:
    damlTypes.Choice<IRMNRemote, RMNRemote_GetCursedSubjects, string[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IRMNRemote, undefined>>;
  RMNRemote_IsCursed:
    damlTypes.Choice<IRMNRemote, RMNRemote_IsCursed, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IRMNRemote, undefined>>;
  RMNRemote_IsCursedForChain:
    damlTypes.Choice<IRMNRemote, RMNRemote_IsCursedForChain, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IRMNRemote, undefined>>;
  RMNRemote_PublicFetch:
    damlTypes.Choice<IRMNRemote, RMNRemote_PublicFetch, RMNRemoteView, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<IRMNRemote, undefined>>;
}
export declare const IRMNRemote:
  damlTypes.InterfaceCompanion<IRMNRemote, undefined, '#ccip-api-v2:CCIP.APIV2.RMNRemote:IRMNRemote'> &
  damlTypes.FromTemplate<IRMNRemote, unknown> &
  IRMNRemoteInterface

export declare type RMNRemoteView = {
  ccipOwner: damlTypes.Party,
  rmnOwner: damlTypes.Party,
  instanceId: string,
}

export declare const RMNRemoteView:
  damlTypes.Serializable<RMNRemoteView>

export declare type RMNRemote_GetCursedSubjects = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const RMNRemote_GetCursedSubjects:
  damlTypes.Serializable<RMNRemote_GetCursedSubjects>

export declare type RMNRemote_IsCursed = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const RMNRemote_IsCursed:
  damlTypes.Serializable<RMNRemote_IsCursed>

export declare type RMNRemote_IsCursedForChain = {
  chainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const RMNRemote_IsCursedForChain:
  damlTypes.Serializable<RMNRemote_IsCursedForChain>

export declare type RMNRemote_PublicFetch = {
  expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const RMNRemote_PublicFetch:
  damlTypes.Serializable<RMNRemote_PublicFetch>
