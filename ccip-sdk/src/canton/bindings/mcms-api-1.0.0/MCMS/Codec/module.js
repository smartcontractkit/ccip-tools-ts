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

var MCMS_Types = require('../../MCMS/Types/module');

exports.BypasserExecuteBatchParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      calls: damlTypes.List(MCMS_Types.TimelockCall).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      calls: damlTypes.List(MCMS_Types.TimelockCall).encode(__typed__.calls),
    };
  },
};

exports.CancelBatchParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      opId: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      opId: damlTypes.Text.encode(__typed__.opId),
    };
  },
};

exports.ScheduleBatchParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      calls: damlTypes.List(MCMS_Types.TimelockCall).decoder,
      predecessor: damlTypes.Text.decoder,
      salt: damlTypes.Text.decoder,
      delaySecs: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      calls: damlTypes.List(MCMS_Types.TimelockCall).encode(__typed__.calls),
      predecessor: damlTypes.Text.encode(__typed__.predecessor),
      salt: damlTypes.Text.encode(__typed__.salt),
      delaySecs: damlTypes.Int.encode(__typed__.delaySecs),
    };
  },
};

exports.SetConfigParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      signers: damlTypes.List(MCMS_Types.SignerInfo).decoder,
      groupQuorums: damlTypes.List(damlTypes.Int).decoder,
      groupParents: damlTypes.List(damlTypes.Int).decoder,
      clearRoot: damlTypes.Bool.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      signers: damlTypes.List(MCMS_Types.SignerInfo).encode(__typed__.signers),
      groupQuorums: damlTypes.List(damlTypes.Int).encode(__typed__.groupQuorums),
      groupParents: damlTypes.List(damlTypes.Int).encode(__typed__.groupParents),
      clearRoot: damlTypes.Bool.encode(__typed__.clearRoot),
    };
  },
};
