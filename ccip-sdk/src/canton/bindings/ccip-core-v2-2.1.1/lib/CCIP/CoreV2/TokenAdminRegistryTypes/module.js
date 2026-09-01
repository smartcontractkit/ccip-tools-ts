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
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.AcceptAdminParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
    };
  },
};

exports.PoolRegistration = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolOwner: damlTypes.Party.decoder,
      poolInstanceId: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
    };
  },
};

exports.ProposeAdminParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
    };
  },
};

exports.SetBurnMintFactoryParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      burnMintFactoryAddress: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      burnMintFactoryAddress: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.burnMintFactoryAddress),
    };
  },
};

exports.SetPoolParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenPool: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.PoolRegistration).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      tokenPool: damlTypes.Optional(exports.PoolRegistration).encode(__typed__.tokenPool),
    };
  },
};

exports.SetTransferFactoryParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      transferFactoryAddress: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      transferFactoryAddress: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.transferFactoryAddress),
    };
  },
};

exports.TransferAdminParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
    };
  },
};
