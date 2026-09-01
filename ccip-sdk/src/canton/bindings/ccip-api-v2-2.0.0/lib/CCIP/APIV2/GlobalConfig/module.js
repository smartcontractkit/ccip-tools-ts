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
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.IGlobalConfig = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.GlobalConfig:IGlobalConfig',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.GlobalConfig:IGlobalConfig',
  function () { return exports.GlobalConfigView; },
  {
    Archive: {
      template: function () { return exports.IGlobalConfig; },
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
    GlobalConfig_GetDestChainConfig: {
      template: function () { return exports.IGlobalConfig; },
      choiceName: 'GlobalConfig_GetDestChainConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GlobalConfig_GetDestChainConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GlobalConfig_GetDestChainConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return jtv.Decoder.withDefault(null, damlTypes.Optional(exports.DestChainConfig).decoder);
      }),
      resultEncode: function (__typed__) { return damlTypes.Optional(exports.DestChainConfig).encode(__typed__); },
    },
    GlobalConfig_GetSourceChainConfig: {
      template: function () { return exports.IGlobalConfig; },
      choiceName: 'GlobalConfig_GetSourceChainConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GlobalConfig_GetSourceChainConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GlobalConfig_GetSourceChainConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return jtv.Decoder.withDefault(null, damlTypes.Optional(exports.SourceChainConfig).decoder);
      }),
      resultEncode: function (__typed__) { return damlTypes.Optional(exports.SourceChainConfig).encode(__typed__); },
    },
    GlobalConfig_PublicFetch: {
      template: function () { return exports.IGlobalConfig; },
      choiceName: 'GlobalConfig_PublicFetch',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GlobalConfig_PublicFetch.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GlobalConfig_PublicFetch.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.GlobalConfigView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.GlobalConfigView.encode(__typed__); },
    },
  }
);

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
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
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
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GlobalConfigView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.GlobalConfig_GetDestChainConfig = {
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

exports.GlobalConfig_GetSourceChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GlobalConfig_PublicFetch = {
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

exports.SourceChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      isEnabled: damlTypes.Bool.decoder,
      onRampAddresses: damlTypes.List(damlTypes.Text).decoder,
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
      onRampAddresses: damlTypes.List(damlTypes.Text).encode(__typed__.onRampAddresses),
      defaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.defaultCCVs),
      laneMandatedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.laneMandatedCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};
