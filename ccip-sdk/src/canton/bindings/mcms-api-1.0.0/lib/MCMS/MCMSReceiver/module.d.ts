// Generated from ../../MCMS/MCMSReceiver/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type MCMSReceiver = damlTypes.Interface<'#mcms-api:MCMS.MCMSReceiver:MCMSReceiver'> & MCMSReceiverView
export declare interface MCMSReceiverInterface {
  Archive:
    damlTypes.Choice<MCMSReceiver, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<MCMSReceiver, undefined>>;
  MCMSReceiver_Entrypoint:
    damlTypes.Choice<MCMSReceiver, MCMSReceiver_Entrypoint, damlTypes.Map<string, damlTypes.ContractId<{}>>, undefined> &
    damlTypes.ChoiceFrom<damlTypes.InterfaceCompanion<MCMSReceiver, undefined>>;
}
export declare const MCMSReceiver:
  damlTypes.InterfaceCompanion<MCMSReceiver, undefined, '#mcms-api:MCMS.MCMSReceiver:MCMSReceiver'> &
  damlTypes.FromTemplate<MCMSReceiver, unknown> &
  MCMSReceiverInterface

export declare type ArgValue =
  | { tag: 'AV_Text'; value: string }
  | { tag: 'AV_Int'; value: damlTypes.Int }
  | { tag: 'AV_Bool'; value: boolean }
  | { tag: 'AV_Party'; value: damlTypes.Party }
  | { tag: 'AV_Time'; value: damlTypes.Time }


export declare const ArgValue:
  damlTypes.Serializable<ArgValue>

export declare type MCMSReceiverView = {
  mcmsController: damlTypes.Party,
  instanceId: string,
}

export declare const MCMSReceiverView:
  damlTypes.Serializable<MCMSReceiverView>

export declare type MCMSReceiver_Entrypoint = {
  functionName: string,
  operationData: string,
  contractIds: damlTypes.Map<string, damlTypes.ContractId<{}>>,
}

export declare const MCMSReceiver_Entrypoint:
  damlTypes.Serializable<MCMSReceiver_Entrypoint>
