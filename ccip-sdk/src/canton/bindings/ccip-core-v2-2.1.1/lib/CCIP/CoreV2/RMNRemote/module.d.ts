// Generated from ../../../CCIP/CoreV2/RMNRemote/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 from '@daml.js/mcms-api-1.0.0';
import * as pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 from '@daml.js/ccip-api-v2-2.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type AddCustomObservers = {
  parties: damlTypes.Party[],
}

export declare const AddCustomObservers:
  damlTypes.Serializable<AddCustomObservers>

export declare type Curse = {
  subject: string,
}

export declare const Curse:
  damlTypes.Serializable<Curse>

export declare type CurseChain = {
  chainSelector: damlTypes.Numeric,
}

export declare const CurseChain:
  damlTypes.Serializable<CurseChain>

export declare type CurseGlobal = {
}

export declare const CurseGlobal:
  damlTypes.Serializable<CurseGlobal>

export declare type CurseMultiple = {
  subjects: string[],
}

export declare const CurseMultiple:
  damlTypes.Serializable<CurseMultiple>

export declare type GetCursedSubjects = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const GetCursedSubjects:
  damlTypes.Serializable<GetCursedSubjects>

export declare type IsCursed = {
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const IsCursed:
  damlTypes.Serializable<IsCursed>

export declare type IsCursedForChain = {
  chainSelector: damlTypes.Numeric,
  context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext,
  caller: damlTypes.Party,
}

export declare const IsCursedForChain:
  damlTypes.Serializable<IsCursedForChain>

export declare type RMNRemote = {
  instanceId: string,
  rmnOwner: damlTypes.Party,
  ccipOwner: damlTypes.Party,
  customObservers: damlTypes.Party[],
  cursedSubjects: string[],
}

export declare interface RMNRemoteInterface {
  AddCustomObservers: 
    damlTypes.Choice<RMNRemote, AddCustomObservers, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  Archive: 
    damlTypes.Choice<RMNRemote, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  Curse: 
    damlTypes.Choice<RMNRemote, Curse, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  CurseChain: 
    damlTypes.Choice<RMNRemote, CurseChain, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  CurseGlobal: 
    damlTypes.Choice<RMNRemote, CurseGlobal, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  CurseMultiple: 
    damlTypes.Choice<RMNRemote, CurseMultiple, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  GetCursedSubjects: 
    damlTypes.Choice<RMNRemote, GetCursedSubjects, string[], undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  IsCursed: 
    damlTypes.Choice<RMNRemote, IsCursed, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  IsCursedForChain: 
    damlTypes.Choice<RMNRemote, IsCursedForChain, boolean, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  RemoveCustomObservers: 
    damlTypes.Choice<RMNRemote, RemoveCustomObservers, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  Uncurse: 
    damlTypes.Choice<RMNRemote, Uncurse, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  UncurseChain: 
    damlTypes.Choice<RMNRemote, UncurseChain, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  UncurseGlobal: 
    damlTypes.Choice<RMNRemote, UncurseGlobal, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  UncurseMultiple: 
    damlTypes.Choice<RMNRemote, UncurseMultiple, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
  UpdateCCIPOwner: 
    damlTypes.Choice<RMNRemote, UpdateCCIPOwner, damlTypes.ContractId<RMNRemote>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.Template<RMNRemote, undefined>>;
}
export declare const RMNRemote:
  damlTypes.Template<RMNRemote, undefined, '#ccip-core-v2:CCIP.CoreV2.RMNRemote:RMNRemote'> &
  damlTypes.ToInterface<RMNRemote, pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote | pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver> &
  RMNRemoteInterface

export declare type RemoveCustomObservers = {
  parties: damlTypes.Party[],
}

export declare const RemoveCustomObservers:
  damlTypes.Serializable<RemoveCustomObservers>

export declare type Uncurse = {
  subject: string,
}

export declare const Uncurse:
  damlTypes.Serializable<Uncurse>

export declare type UncurseChain = {
  chainSelector: damlTypes.Numeric,
}

export declare const UncurseChain:
  damlTypes.Serializable<UncurseChain>

export declare type UncurseGlobal = {
}

export declare const UncurseGlobal:
  damlTypes.Serializable<UncurseGlobal>

export declare type UncurseMultiple = {
  subjects: string[],
}

export declare const UncurseMultiple:
  damlTypes.Serializable<UncurseMultiple>

export declare type UpdateCCIPOwner = {
  newCCIPOwner: damlTypes.Party,
}

export declare const UpdateCCIPOwner:
  damlTypes.Serializable<UpdateCCIPOwner>
