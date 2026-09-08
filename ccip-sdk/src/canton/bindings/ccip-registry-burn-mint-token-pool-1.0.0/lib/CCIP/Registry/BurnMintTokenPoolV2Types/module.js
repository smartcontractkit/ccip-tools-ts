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

var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@daml.js/ccip-codec-v2-2.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.AddPoolReceiveContextContractValueParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
      referentInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
      referentInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.referentInstanceAddress),
    };
  },
};

exports.AddPoolReceiveContextNonContractValueParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
      valuePayload: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
      valuePayload: damlTypes.Text.encode(__typed__.valuePayload),
    };
  },
};

exports.ApplyChainUpdatesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelectorsToRemove: damlTypes.List(damlTypes.Numeric(0)).decoder,
      chainsToAdd: damlTypes.List(exports.ChainUpdate).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelectorsToRemove: damlTypes.List(damlTypes.Numeric(0)).encode(__typed__.remoteChainSelectorsToRemove),
      chainsToAdd: damlTypes.List(exports.ChainUpdate).encode(__typed__.chainsToAdd),
    };
  },
};

exports.ApplyTokenTransferFeeConfigUpdatesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenTransferFeeConfigArgs: damlTypes.List(exports.TokenTransferFeeConfigArgs).decoder,
      disableTokenTransferFeeConfigArgs: damlTypes.List(damlTypes.Numeric(0)).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenTransferFeeConfigArgs: damlTypes.List(exports.TokenTransferFeeConfigArgs).encode(__typed__.tokenTransferFeeConfigArgs),
      disableTokenTransferFeeConfigArgs: damlTypes.List(damlTypes.Numeric(0)).encode(__typed__.disableTokenTransferFeeConfigArgs),
    };
  },
};

exports.ChainUpdate = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelector: damlTypes.Numeric(0).decoder,
      remotePools: damlTypes.List(damlTypes.Text).decoder,
      remoteTokenAddress: damlTypes.Text.decoder,
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
      remotePools: damlTypes.List(damlTypes.Text).encode(__typed__.remotePools),
      remoteTokenAddress: damlTypes.Text.encode(__typed__.remoteTokenAddress),
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.inboundCCVs),
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.outboundCCVs),
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finalityConfig),
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundRateLimiter),
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundCustomBlockConfirmationsRateLimiter),
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.outboundRateLimiter),
    };
  },
};

exports.LaneDeploySpec = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelector: damlTypes.Numeric(0).decoder,
      remotePools: damlTypes.List(damlTypes.Text).decoder,
      remoteTokenAddress: damlTypes.Text.decoder,
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      inbound: exports.RateLimiterDeploySpec.decoder,
      outbound: exports.RateLimiterDeploySpec.decoder,
      inboundCustomFinality: exports.RateLimiterDeploySpec.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
      remotePools: damlTypes.List(damlTypes.Text).encode(__typed__.remotePools),
      remoteTokenAddress: damlTypes.Text.encode(__typed__.remoteTokenAddress),
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.inboundCCVs),
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.outboundCCVs),
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finalityConfig),
      inbound: exports.RateLimiterDeploySpec.encode(__typed__.inbound),
      outbound: exports.RateLimiterDeploySpec.encode(__typed__.outbound),
      inboundCustomFinality: exports.RateLimiterDeploySpec.encode(__typed__.inboundCustomFinality),
    };
  },
};

exports.RateLimitConfigArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remoteChainSelector: damlTypes.Numeric(0).decoder,
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundRateLimiter),
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundCustomBlockConfirmationsRateLimiter),
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.outboundRateLimiter),
    };
  },
};

exports.RateLimiterDeploySpec = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instanceId: damlTypes.Text.decoder,
      isEnabled: damlTypes.Bool.decoder,
      capacity: damlTypes.Numeric(0).decoder,
      rate: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      capacity: damlTypes.Numeric(0).encode(__typed__.capacity),
      rate: damlTypes.Numeric(0).encode(__typed__.rate),
    };
  },
};

exports.RemoteChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      remotePools: damlTypes.List(damlTypes.Text).decoder,
      remoteTokenAddress: damlTypes.Text.decoder,
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      remotePools: damlTypes.List(damlTypes.Text).encode(__typed__.remotePools),
      remoteTokenAddress: damlTypes.Text.encode(__typed__.remoteTokenAddress),
      inboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.inboundCCVs),
      outboundCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.outboundCCVs),
      finalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finalityConfig),
      inboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundRateLimiter),
      inboundCustomBlockConfirmationsRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.inboundCustomBlockConfirmationsRateLimiter),
      outboundRateLimiter: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.outboundRateLimiter),
    };
  },
};

exports.RemovePoolReceiveContextValueParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      contextKey: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      contextKey: damlTypes.Text.encode(__typed__.contextKey),
    };
  },
};

exports.SetDynamicConfigParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimitAdmin: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimitAdmin: damlTypes.Optional(damlTypes.Party).encode(__typed__.rateLimitAdmin),
    };
  },
};

exports.SetObserversParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      observers: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      observers: damlTypes.List(damlTypes.Party).encode(__typed__.observers),
    };
  },
};

exports.SetRateLimitConfigParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      caller: damlTypes.Party.decoder,
      rateLimiterInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      newIsEnabled: damlTypes.Bool.decoder,
      newCapacity: damlTypes.Numeric(0).decoder,
      newRate: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      caller: damlTypes.Party.encode(__typed__.caller),
      rateLimiterInstanceAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rateLimiterInstanceAddress),
      newIsEnabled: damlTypes.Bool.encode(__typed__.newIsEnabled),
      newCapacity: damlTypes.Numeric(0).encode(__typed__.newCapacity),
      newRate: damlTypes.Numeric(0).encode(__typed__.newRate),
    };
  },
};

exports.SetRateLimiterReferencesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimitConfigArgs: damlTypes.List(exports.RateLimitConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimitConfigArgs: damlTypes.List(exports.RateLimitConfigArgs).encode(__typed__.rateLimitConfigArgs),
    };
  },
};

exports.SetTransferTimeoutParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      transferTimeout: exports.TransferTimeout.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      transferTimeout: exports.TransferTimeout.encode(__typed__.transferTimeout),
    };
  },
};

exports.TokenTransferFeeConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      feeBps: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      feeBps: damlTypes.Numeric(0).encode(__typed__.feeBps),
    };
  },
};

exports.TokenTransferFeeConfigArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      isEnabled: damlTypes.Bool.decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      feeBps: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      feeBps: damlTypes.Numeric(0).encode(__typed__.feeBps),
    };
  },
};

exports.TransferTimeout = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("Indefinite"),
        value: damlTypes.Unit.decoder,
      }),
      jtv.object({
        tag: jtv.constant("RelativeHours"),
        value: damlTypes.Int.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'Indefinite': return {tag: __typed__.tag, value: damlTypes.Unit.encode(__typed__.value)};
      case 'RelativeHours': return {tag: __typed__.tag, value: damlTypes.Int.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type TransferTimeout';
    }
  },
};
