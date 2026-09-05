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

var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@daml.js/splice-api-token-metadata-v1-1.0.0');
var pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 = require('@daml.js/daml-prim-DA-Types-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.IFeeQuoter = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.FeeQuoter:IFeeQuoter',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.FeeQuoter:IFeeQuoter',
  function () { return exports.FeeQuoterView; },
  {
    Archive: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'Archive',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder;
      }),
      argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    FeeQuoter_GetDestinationChainGasPrice: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_GetDestinationChainGasPrice',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_GetDestinationChainGasPrice.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_GetDestinationChainGasPrice.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TimestampedPrice.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TimestampedPrice.encode(__typed__); },
    },
    FeeQuoter_GetFeeTokens: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_GetFeeTokens',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_GetFeeTokens.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_GetFeeTokens.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__); },
    },
    FeeQuoter_GetTokenPrice: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_GetTokenPrice',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_GetTokenPrice.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_GetTokenPrice.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TimestampedPrice.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TimestampedPrice.encode(__typed__); },
    },
    FeeQuoter_GetTokenTransferFee: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_GetTokenTransferFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_GetTokenTransferFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_GetTokenTransferFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.Numeric(0), damlTypes.Int, damlTypes.Int).decoder;
      }),
      resultEncode: function (__typed__) { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.Numeric(0), damlTypes.Int, damlTypes.Int).encode(__typed__); },
    },
    FeeQuoter_PublicFetch: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_PublicFetch',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_PublicFetch.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_PublicFetch.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoterView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.FeeQuoterView.encode(__typed__); },
    },
    FeeQuoter_QuoteGasForExec: {
      template: function () { return exports.IFeeQuoter; },
      choiceName: 'FeeQuoter_QuoteGasForExec',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FeeQuoter_QuoteGasForExec.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FeeQuoter_QuoteGasForExec.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.QuoteGasForExecResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.QuoteGasForExecResult.encode(__typed__); },
    },
  }
);

exports.FeeQuoterView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.FeeQuoter_GetDestinationChainGasPrice = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FeeQuoter_GetFeeTokens = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FeeQuoter_GetTokenPrice = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.token),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FeeQuoter_GetTokenTransferFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      token: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.token),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FeeQuoter_PublicFetch = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      expectedAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.expectedAddress),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FeeQuoter_QuoteGasForExec = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      nonCalldataGas: damlTypes.Int.decoder,
      calldataSize: damlTypes.Int.decoder,
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      nonCalldataGas: damlTypes.Int.encode(__typed__.nonCalldataGas),
      calldataSize: damlTypes.Int.encode(__typed__.calldataSize),
      feeToken: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.feeToken),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.QuoteGasForExecResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      totalGas: damlTypes.Int.decoder,
      gasCostUSDCents: damlTypes.Numeric(0).decoder,
      feeTokenPrice: damlTypes.Numeric(10).decoder,
      premiumMultiplier: damlTypes.Numeric(10).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      totalGas: damlTypes.Int.encode(__typed__.totalGas),
      gasCostUSDCents: damlTypes.Numeric(0).encode(__typed__.gasCostUSDCents),
      feeTokenPrice: damlTypes.Numeric(10).encode(__typed__.feeTokenPrice),
      premiumMultiplier: damlTypes.Numeric(10).encode(__typed__.premiumMultiplier),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TimestampedPrice = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      price: damlTypes.Numeric(10).decoder,
      timestamp: damlTypes.Time.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      price: damlTypes.Numeric(10).encode(__typed__.price),
      timestamp: damlTypes.Time.encode(__typed__.timestamp),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};
