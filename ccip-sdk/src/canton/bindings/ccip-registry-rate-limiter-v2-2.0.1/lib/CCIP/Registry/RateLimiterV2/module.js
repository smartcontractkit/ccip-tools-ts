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
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');

exports.ConsumeCapacity = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      requested: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      requested: damlTypes.Numeric(0).encode(__typed__.requested),
    };
  },
};

exports.ConsumeCapacityResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      rateLimiterCid: damlTypes.ContractId(exports.RateLimiter).decoder,
      availableBeforeConsume: damlTypes.Numeric(0).decoder,
      consumed: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      rateLimiterCid: damlTypes.ContractId(exports.RateLimiter).encode(__typed__.rateLimiterCid),
      availableBeforeConsume: damlTypes.Numeric(0).encode(__typed__.availableBeforeConsume),
      consumed: damlTypes.Numeric(0).encode(__typed__.consumed),
    };
  },
};

exports.RateLimitDirection = {
  RateLimitDirection_Outbound: 'RateLimitDirection_Outbound',
  RateLimitDirection_Inbound: 'RateLimitDirection_Inbound',
  keys: ['RateLimitDirection_Outbound', 'RateLimitDirection_Inbound'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.RateLimitDirection.RateLimitDirection_Outbound),
      jtv.constant(exports.RateLimitDirection.RateLimitDirection_Inbound),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.RateLimitMode = {
  RateLimitMode_DefaultFinality: 'RateLimitMode_DefaultFinality',
  RateLimitMode_CustomFinality: 'RateLimitMode_CustomFinality',
  keys: ['RateLimitMode_DefaultFinality', 'RateLimitMode_CustomFinality'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.RateLimitMode.RateLimitMode_DefaultFinality),
      jtv.constant(exports.RateLimitMode.RateLimitMode_CustomFinality),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.RateLimiter = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-registry-rate-limiter-v2:CCIP.Registry.RateLimiterV2:RateLimiter',
    templateIdWithPackageId: '#6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92:CCIP.Registry.RateLimiterV2:RateLimiter',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        poolInstanceId: damlTypes.Text.decoder,
        poolOwner: damlTypes.Party.decoder,
        remoteChainSelector: damlTypes.Numeric(0).decoder,
        direction: exports.RateLimitDirection.decoder,
        mode: exports.RateLimitMode.decoder,
        isEnabled: damlTypes.Bool.decoder,
        capacity: damlTypes.Numeric(0).decoder,
        rate: damlTypes.Numeric(0).decoder,
        tokens: damlTypes.Numeric(0).decoder,
        lastUpdated: damlTypes.Time.decoder,
        observers: damlTypes.List(damlTypes.Party).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
        poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
        remoteChainSelector: damlTypes.Numeric(0).encode(__typed__.remoteChainSelector),
        direction: exports.RateLimitDirection.encode(__typed__.direction),
        mode: exports.RateLimitMode.encode(__typed__.mode),
        isEnabled: damlTypes.Bool.encode(__typed__.isEnabled),
        capacity: damlTypes.Numeric(0).encode(__typed__.capacity),
        rate: damlTypes.Numeric(0).encode(__typed__.rate),
        tokens: damlTypes.Numeric(0).encode(__typed__.tokens),
        lastUpdated: damlTypes.Time.encode(__typed__.lastUpdated),
        observers: damlTypes.List(damlTypes.Party).encode(__typed__.observers),
      };
    },
    Archive: {
      template: function () { return exports.RateLimiter; },
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
    ConsumeCapacity: {
      template: function () { return exports.RateLimiter; },
      choiceName: 'ConsumeCapacity',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ConsumeCapacity.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ConsumeCapacity.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ConsumeCapacityResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ConsumeCapacityResult.encode(__typed__); },
    },
    SetConfig: {
      template: function () { return exports.RateLimiter; },
      choiceName: 'SetConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RateLimiter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RateLimiter).encode(__typed__); },
    },
    SetObservers: {
      template: function () { return exports.RateLimiter; },
      choiceName: 'SetObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RateLimiter).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RateLimiter).encode(__typed__); },
    },
  },
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.RateLimiter, ['6856206c569bf6c13704eb5cd3fedecb64245fce1af80898b4ddf6580f51fa92', '#ccip-registry-rate-limiter-v2']);

exports.SetConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newIsEnabled: damlTypes.Bool.decoder,
      newCapacity: damlTypes.Numeric(0).decoder,
      newRate: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newIsEnabled: damlTypes.Bool.encode(__typed__.newIsEnabled),
      newCapacity: damlTypes.Numeric(0).encode(__typed__.newCapacity),
      newRate: damlTypes.Numeric(0).encode(__typed__.newRate),
    };
  },
};

exports.SetObservers = {
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
