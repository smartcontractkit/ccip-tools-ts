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

exports.AddCustomObserversParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      parties: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      parties: damlTypes.List(damlTypes.Party).encode(__typed__.parties),
    };
  },
};

exports.CurseChainParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      chainSelector: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      chainSelector: damlTypes.Numeric(0).encode(__typed__.chainSelector),
    };
  },
};

exports.CurseMultipleParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      subjects: damlTypes.List(damlTypes.Text).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      subjects: damlTypes.List(damlTypes.Text).encode(__typed__.subjects),
    };
  },
};

exports.CurseParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      subject: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      subject: damlTypes.Text.encode(__typed__.subject),
    };
  },
};

exports.RemoveCustomObserversParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      parties: damlTypes.List(damlTypes.Party).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      parties: damlTypes.List(damlTypes.Party).encode(__typed__.parties),
    };
  },
};

exports.UncurseChainParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      chainSelector: damlTypes.Numeric(0).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      chainSelector: damlTypes.Numeric(0).encode(__typed__.chainSelector),
    };
  },
};

exports.UncurseMultipleParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      subjects: damlTypes.List(damlTypes.Text).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      subjects: damlTypes.List(damlTypes.Text).encode(__typed__.subjects),
    };
  },
};

exports.UncurseParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      subject: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      subject: damlTypes.Text.encode(__typed__.subject),
    };
  },
};
