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

var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@daml.js/mcms-api-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');

var CCIP_CoreV2_GlobalConfigTypes = require('../../../CCIP/CoreV2/GlobalConfigTypes/module');

exports.ApplyDestChainConfigUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainConfigUpdates: damlTypes.List(CCIP_CoreV2_GlobalConfigTypes.DestChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainConfigUpdates: damlTypes.List(CCIP_CoreV2_GlobalConfigTypes.DestChainConfigArgs).encode(__typed__.destChainConfigUpdates),
    };
  },
};

exports.ApplySourceChainConfigUpdates = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainConfigUpdates: damlTypes.List(CCIP_CoreV2_GlobalConfigTypes.SourceChainConfigArgs).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainConfigUpdates: damlTypes.List(CCIP_CoreV2_GlobalConfigTypes.SourceChainConfigArgs).encode(__typed__.sourceChainConfigUpdates),
    };
  },
};

exports.GetDestChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      destChainSelector: damlTypes.Numeric(0).decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      destChainSelector: damlTypes.Numeric(0).encode(__typed__.destChainSelector),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GetSourceChainConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      sourceChainSelector: damlTypes.Numeric(0).decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GlobalConfig = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.GlobalConfig:GlobalConfig',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.GlobalConfig:GlobalConfig',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        chainSelector: damlTypes.Numeric(0).decoder,
        destChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_GlobalConfigTypes.DestChainConfig).decoder,
        sourceChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        chainSelector: damlTypes.Numeric(0).encode(__typed__.chainSelector),
        destChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_GlobalConfigTypes.DestChainConfig).encode(__typed__.destChainConfigs),
        sourceChainConfigs: damlTypes.Map(damlTypes.Numeric(0), CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig).encode(__typed__.sourceChainConfigs),
      };
    },
    ApplyDestChainConfigUpdates: {
      template: function () { return exports.GlobalConfig; },
      choiceName: 'ApplyDestChainConfigUpdates',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplyDestChainConfigUpdates.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplyDestChainConfigUpdates.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.GlobalConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.GlobalConfig).encode(__typed__); },
    },
    ApplySourceChainConfigUpdates: {
      template: function () { return exports.GlobalConfig; },
      choiceName: 'ApplySourceChainConfigUpdates',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ApplySourceChainConfigUpdates.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ApplySourceChainConfigUpdates.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.GlobalConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.GlobalConfig).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.GlobalConfig; },
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
    GetDestChainConfig: {
      template: function () { return exports.GlobalConfig; },
      choiceName: 'GetDestChainConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetDestChainConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetDestChainConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return jtv.Decoder.withDefault(null, damlTypes.Optional(CCIP_CoreV2_GlobalConfigTypes.DestChainConfig).decoder);
      }),
      resultEncode: function (__typed__) { return damlTypes.Optional(CCIP_CoreV2_GlobalConfigTypes.DestChainConfig).encode(__typed__); },
    },
    GetSourceChainConfig: {
      template: function () { return exports.GlobalConfig; },
      choiceName: 'GetSourceChainConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetSourceChainConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetSourceChainConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return jtv.Decoder.withDefault(null, damlTypes.Optional(CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig).decoder);
      }),
      resultEncode: function (__typed__) { return damlTypes.Optional(CCIP_CoreV2_GlobalConfigTypes.SourceChainConfig).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.GlobalConfig.IGlobalConfig,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.GlobalConfig, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);
