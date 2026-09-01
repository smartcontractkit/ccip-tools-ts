"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });

/* eslint-disable-next-line no-unused-vars */
var jtv = require('@mojotech/json-type-validation');
/* eslint-disable-next-line no-unused-vars */
var damlTypes = require('@daml/types');

var CCIP_CodecV2_FinalityConfig = require('../../../CCIP/CodecV2/FinalityConfig/module');

exports.MessageV1 = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      destChainSelector: damlTypes.Numeric(0).decoder,
      sequenceNumber: damlTypes.Numeric(0).decoder,
      executionGasLimit: damlTypes.Int.decoder,
      ccipReceiveGasLimit: damlTypes.Int.decoder,
      finality: CCIP_CodecV2_FinalityConfig.DecodedFinality.decoder,
      ccvAndExecutorHash: damlTypes.Text.decoder,
      onRampAddress: damlTypes.Text.decoder,
      offRampAddress: damlTypes.Text.decoder,
      sender: damlTypes.Text.decoder,
      receiver: damlTypes.Text.decoder,
      destBlob: damlTypes.Text.decoder,
      tokenTransfer: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.TokenTransferV1).decoder),
      messageData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      sequenceNumber: damlTypes.Numeric(0).encode(__typed__.sequenceNumber),
      executionGasLimit: damlTypes.Int.encode(__typed__.executionGasLimit),
      ccipReceiveGasLimit: damlTypes.Int.encode(__typed__.ccipReceiveGasLimit),
      finality: CCIP_CodecV2_FinalityConfig.DecodedFinality.encode(__typed__.finality),
      ccvAndExecutorHash: damlTypes.Text.encode(__typed__.ccvAndExecutorHash),
      onRampAddress: damlTypes.Text.encode(__typed__.onRampAddress),
      offRampAddress: damlTypes.Text.encode(__typed__.offRampAddress),
      sender: damlTypes.Text.encode(__typed__.sender),
      receiver: damlTypes.Text.encode(__typed__.receiver),
      destBlob: damlTypes.Text.encode(__typed__.destBlob),
      tokenTransfer: damlTypes.Optional(exports.TokenTransferV1).encode(__typed__.tokenTransfer),
      messageData: damlTypes.Text.encode(__typed__.messageData),
    };
  },
};

exports.TokenTransferV1 = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      amount: damlTypes.Text.decoder,
      sourcePoolAddress: damlTypes.Text.decoder,
      sourceTokenAddress: damlTypes.Text.decoder,
      destTokenAddress: damlTypes.Text.decoder,
      tokenReceiver: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      amount: damlTypes.Text.encode(__typed__.amount),
      sourcePoolAddress: damlTypes.Text.encode(__typed__.sourcePoolAddress),
      sourceTokenAddress: damlTypes.Text.encode(__typed__.sourceTokenAddress),
      destTokenAddress: damlTypes.Text.encode(__typed__.destTokenAddress),
      tokenReceiver: damlTypes.Text.encode(__typed__.tokenReceiver),
      extraData: damlTypes.Text.encode(__typed__.extraData),
    };
  },
};
