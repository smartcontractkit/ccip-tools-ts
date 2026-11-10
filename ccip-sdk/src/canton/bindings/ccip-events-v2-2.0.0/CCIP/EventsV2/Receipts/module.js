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

exports.IssuerType = {
  IssuerType_CCV: 'IssuerType_CCV',
  IssuerType_Pool: 'IssuerType_Pool',
  IssuerType_Executor: 'IssuerType_Executor',
  IssuerType_Network: 'IssuerType_Network',
  keys: ['IssuerType_CCV', 'IssuerType_Pool', 'IssuerType_Executor', 'IssuerType_Network'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.IssuerType.IssuerType_CCV),
      jtv.constant(exports.IssuerType.IssuerType_Pool),
      jtv.constant(exports.IssuerType.IssuerType_Executor),
      jtv.constant(exports.IssuerType.IssuerType_Network),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.Receipt = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      issuerType: exports.IssuerType.decoder,
      issuerAddress: damlTypes.Text.decoder,
      versionTag: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Text).decoder),
      destGasLimit: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      feeTokenAmount: damlTypes.Numeric(0).decoder,
      extraArgs: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      issuerType: exports.IssuerType.encode(__typed__.issuerType),
      issuerAddress: damlTypes.Text.encode(__typed__.issuerAddress),
      versionTag: damlTypes.Optional(damlTypes.Text).encode(__typed__.versionTag),
      destGasLimit: damlTypes.Int.encode(__typed__.destGasLimit),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      feeTokenAmount: damlTypes.Numeric(0).encode(__typed__.feeTokenAmount),
      extraArgs: damlTypes.Text.encode(__typed__.extraArgs),
    };
  },
};
