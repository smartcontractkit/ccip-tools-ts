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

var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');

exports.ApplyFeeQuoterDestChainConfigUpdatesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainConfigArgs: damlTypes.List(exports.FeeQuoterDestChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainConfigArgs: damlTypes.List(exports.FeeQuoterDestChainConfigArgs).encode(__typed__.destChainConfigArgs),
    };
  },
};

exports.ApplyPriceUpdatersUpdateParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      addedPriceUpdaters: damlTypes.List(damlTypes.Party).decoder,
      removedPriceUpdaters: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      addedPriceUpdaters: damlTypes.List(damlTypes.Party).encode(__typed__.addedPriceUpdaters),
      removedPriceUpdaters: damlTypes.List(damlTypes.Party).encode(__typed__.removedPriceUpdaters),
    };
  },
};

exports.FeeQuoterDestChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      maxDataBytes: damlTypes.Int.decoder,
      maxPerMsgGasLimit: damlTypes.Int.decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destGasPerPayloadByteBase: damlTypes.Int.decoder,
      defaultTxGasLimit: damlTypes.Int.decoder,
      linkFeeMultiplierPercent: damlTypes.Numeric(0).decoder,
      defaultTokenFeeUSD: damlTypes.Numeric(0).decoder,
      defaultTokenDestGasOverhead: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      maxDataBytes: damlTypes.Int.encode(__typed__.maxDataBytes),
      maxPerMsgGasLimit: damlTypes.Int.encode(__typed__.maxPerMsgGasLimit),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destGasPerPayloadByteBase: damlTypes.Int.encode(__typed__.destGasPerPayloadByteBase),
      defaultTxGasLimit: damlTypes.Int.encode(__typed__.defaultTxGasLimit),
      linkFeeMultiplierPercent: damlTypes.Numeric(0).encode(__typed__.linkFeeMultiplierPercent),
      defaultTokenFeeUSD: damlTypes.Numeric(0).encode(__typed__.defaultTokenFeeUSD),
      defaultTokenDestGasOverhead: damlTypes.Int.encode(__typed__.defaultTokenDestGasOverhead),
    };
  },
};

exports.FeeQuoterDestChainConfigArgs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      destChainConfig: exports.FeeQuoterDestChainConfig.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      destChainConfig: exports.FeeQuoterDestChainConfig.encode(__typed__.destChainConfig),
    };
  },
};

exports.GasPriceUpdate = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      usdPerUnitGas: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      usdPerUnitGas: damlTypes.Numeric(10).encode(__typed__.usdPerUnitGas),
    };
  },
};

exports.PriceUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenPriceUpdates: damlTypes.List(exports.TokenPriceUpdate).decoder,
      gasPriceUpdates: damlTypes.List(exports.GasPriceUpdate).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenPriceUpdates: damlTypes.List(exports.TokenPriceUpdate).encode(__typed__.tokenPriceUpdates),
      gasPriceUpdates: damlTypes.List(exports.GasPriceUpdate).encode(__typed__.gasPriceUpdates),
    };
  },
};

exports.RemoveFeeTokensParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      feeTokensToRemove: damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      feeTokensToRemove: damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__.feeTokensToRemove),
    };
  },
};

exports.TokenPriceUpdate = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      usdPerToken: damlTypes.Numeric(10).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      usdPerToken: damlTypes.Numeric(10).encode(__typed__.usdPerToken),
    };
  },
};

exports.UpdatePricesParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      priceUpdates: exports.PriceUpdates.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      priceUpdates: exports.PriceUpdates.encode(__typed__.priceUpdates),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
