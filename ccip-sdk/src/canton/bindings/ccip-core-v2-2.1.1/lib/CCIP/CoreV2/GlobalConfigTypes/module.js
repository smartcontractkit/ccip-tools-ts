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

var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.ApplyDestChainConfigUpdatesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainConfigArgs: damlTypes.List(exports.DestChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainConfigArgs: damlTypes.List(exports.DestChainConfigArgs).encode(__typed__.destChainConfigArgs),
    };
  },
};

exports.ApplySourceChainConfigUpdatesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainConfigArgs: damlTypes.List(exports.SourceChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainConfigArgs: damlTypes.List(exports.SourceChainConfigArgs).encode(__typed__.sourceChainConfigArgs),
    };
  },
};

exports.DestChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      addressBytesLength: damlTypes.Int.decoder,
      tokenReceiverAllowed: damlTypes.Bool.decoder,
      baseExecutionGasCost: damlTypes.Int.decoder,
      offRampAddress: damlTypes.Text.decoder,
      defaultExecutor: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      messageNetworkFeeUSDCents: damlTypes.Numeric(0).decoder,
      tokenNetworkFeeUSDCents: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      addressBytesLength: damlTypes.Int.encode(__typed__.addressBytesLength),
      tokenReceiverAllowed: damlTypes.Bool.encode(__typed__.tokenReceiverAllowed),
      baseExecutionGasCost: damlTypes.Int.encode(__typed__.baseExecutionGasCost),
      offRampAddress: damlTypes.Text.encode(__typed__.offRampAddress),
      defaultExecutor: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultExecutor),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.laneMandatedCCVs),
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultCCVs),
      messageNetworkFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.messageNetworkFeeUSDCents),
      tokenNetworkFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.tokenNetworkFeeUSDCents),
    };
  },
};

exports.DestChainConfigArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      isEnabled: damlTypes.Bool.decoder,
      addressBytesLength: damlTypes.Int.decoder,
      tokenReceiverAllowed: damlTypes.Bool.decoder,
      baseExecutionGasCost: damlTypes.Int.decoder,
      offRampAddress: damlTypes.Text.decoder,
      defaultExecutor: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      messageNetworkFeeUSDCents: damlTypes.Numeric(0).decoder,
      tokenNetworkFeeUSDCents: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      addressBytesLength: damlTypes.Int.encode(__typed__.addressBytesLength),
      tokenReceiverAllowed: damlTypes.Bool.encode(__typed__.tokenReceiverAllowed),
      baseExecutionGasCost: damlTypes.Int.encode(__typed__.baseExecutionGasCost),
      offRampAddress: damlTypes.Text.encode(__typed__.offRampAddress),
      defaultExecutor: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultExecutor),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.laneMandatedCCVs),
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultCCVs),
      messageNetworkFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.messageNetworkFeeUSDCents),
      tokenNetworkFeeUSDCents: damlTypes.Numeric(0).encode(__typed__.tokenNetworkFeeUSDCents),
    };
  },
};

exports.SourceChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      onRampAddresses: damlTypes.List(damlTypes.Text).decoder,
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      onRampAddresses: damlTypes.List(damlTypes.Text).encode(__typed__.onRampAddresses),
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultCCVs),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.laneMandatedCCVs),
    };
  },
};

exports.SourceChainConfigArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      isEnabled: damlTypes.Bool.decoder,
      onRampAddresses: damlTypes.List(damlTypes.Text).decoder,
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      onRampAddresses: damlTypes.List(damlTypes.Text).encode(__typed__.onRampAddresses),
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultCCVs),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.laneMandatedCCVs),
    };
  },
};
