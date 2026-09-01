// Generated from ../../../CCIP/CodecV2/MessageCodecV1/module.daml

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as CCIP_CodecV2_FinalityConfig from '../FinalityConfig/module';

export declare type MessageV1 = {
  sourceChainSelector: damlTypes.Numeric,
  destChainSelector: damlTypes.Numeric,
  sequenceNumber: damlTypes.Numeric,
  executionGasLimit: damlTypes.Int,
  ccipReceiveGasLimit: damlTypes.Int,
  finality: CCIP_CodecV2_FinalityConfig.DecodedFinality,
  ccvAndExecutorHash: string,
  onRampAddress: string,
  offRampAddress: string,
  sender: string,
  receiver: string,
  destBlob: string,
  tokenTransfer: damlTypes.Optional<TokenTransferV1>,
  messageData: string,
}

export declare const MessageV1:
  damlTypes.Serializable<MessageV1>

export declare type TokenTransferV1 = {
  amount: string,
  sourcePoolAddress: string,
  sourceTokenAddress: string,
  destTokenAddress: string,
  tokenReceiver: string,
  extraData: string,
}

export declare const TokenTransferV1:
  damlTypes.Serializable<TokenTransferV1>
