// Generated from ../../../CCIP/CoreV2/TokenAdminRegistryTypes/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 from '@daml.js/chainlink-api-2.0.0';

export declare type AcceptAdminParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
}

export declare const AcceptAdminParams:
  damlTypes.Serializable<AcceptAdminParams>

export declare type PoolRegistration = {
  poolOwner: damlTypes.Party,
  poolInstanceId: string,
}

export declare const PoolRegistration:
  damlTypes.Serializable<PoolRegistration>

export declare type ProposeAdminParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
}

export declare const ProposeAdminParams:
  damlTypes.Serializable<ProposeAdminParams>

export declare type SetBurnMintFactoryParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  burnMintFactoryAddress: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
}

export declare const SetBurnMintFactoryParams:
  damlTypes.Serializable<SetBurnMintFactoryParams>

export declare type SetPoolParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  tokenPool: damlTypes.Optional<PoolRegistration>,
}

export declare const SetPoolParams:
  damlTypes.Serializable<SetPoolParams>

export declare type SetTransferFactoryParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  transferFactoryAddress: damlTypes.Optional<pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress>,
}

export declare const SetTransferFactoryParams:
  damlTypes.Serializable<SetTransferFactoryParams>

export declare type TransferAdminParams = {
  instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId,
  newAdmin: damlTypes.Party,
}

export declare const TransferAdminParams:
  damlTypes.Serializable<TransferAdminParams>
