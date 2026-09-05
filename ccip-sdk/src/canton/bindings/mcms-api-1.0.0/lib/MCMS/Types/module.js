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

exports.AdminParams = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("AP_SetConfig"),
        value: exports.AdminParams.AP_SetConfig.decoder,
      }),
      jtv.object({
        tag: jtv.constant("AP_ClearRoot"),
        value: damlTypes.Unit.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'AP_SetConfig': return {tag: __typed__.tag, value: exports.AdminParams.AP_SetConfig.encode(__typed__.value)};
      case 'AP_ClearRoot': return {tag: __typed__.tag, value: damlTypes.Unit.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type AdminParams';
    }
  },
  AP_SetConfig: {
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        apSigners: damlTypes.List(exports.SignerInfo).decoder,
        apGroupQuorums: damlTypes.List(damlTypes.Int).decoder,
        apGroupParents: damlTypes.List(damlTypes.Int).decoder,
        apClearRoot: damlTypes.Bool.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        apSigners: damlTypes.List(exports.SignerInfo).encode(__typed__.apSigners),
        apGroupQuorums: damlTypes.List(damlTypes.Int).encode(__typed__.apGroupQuorums),
        apGroupParents: damlTypes.List(damlTypes.Int).encode(__typed__.apGroupParents),
        apClearRoot: damlTypes.Bool.encode(__typed__.apClearRoot),
      };
    },
  },
};

exports.BlockedFunction = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      targetInstanceAddress: damlTypes.Text.decoder,
      functionName: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      targetInstanceAddress: damlTypes.Text.encode(__typed__.targetInstanceAddress),
      functionName: damlTypes.Text.encode(__typed__.functionName),
    };
  },
};

exports.ExpiringRoot = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      root: damlTypes.Text.decoder,
      validUntil: damlTypes.Time.decoder,
      opCount: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      root: damlTypes.Text.encode(__typed__.root),
      validUntil: damlTypes.Time.encode(__typed__.validUntil),
      opCount: damlTypes.Int.encode(__typed__.opCount),
    };
  },
};

exports.MultisigConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      signers: damlTypes.List(exports.SignerInfo).decoder,
      groupQuorums: damlTypes.List(damlTypes.Int).decoder,
      groupParents: damlTypes.List(damlTypes.Int).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      signers: damlTypes.List(exports.SignerInfo).encode(__typed__.signers),
      groupQuorums: damlTypes.List(damlTypes.Int).encode(__typed__.groupQuorums),
      groupParents: damlTypes.List(damlTypes.Int).encode(__typed__.groupParents),
    };
  },
};

exports.Op = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      chainId: damlTypes.Int.decoder,
      multisigId: damlTypes.Text.decoder,
      nonce: damlTypes.Int.decoder,
      targetInstanceAddress: damlTypes.Text.decoder,
      functionName: damlTypes.Text.decoder,
      operationData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      chainId: damlTypes.Int.encode(__typed__.chainId),
      multisigId: damlTypes.Text.encode(__typed__.multisigId),
      nonce: damlTypes.Int.encode(__typed__.nonce),
      targetInstanceAddress: damlTypes.Text.encode(__typed__.targetInstanceAddress),
      functionName: damlTypes.Text.encode(__typed__.functionName),
      operationData: damlTypes.Text.encode(__typed__.operationData),
    };
  },
};

exports.Role = {
  Bypasser: 'Bypasser',
  Canceller: 'Canceller',
  Proposer: 'Proposer',
  keys: ['Bypasser', 'Canceller', 'Proposer'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.Role.Bypasser),
      jtv.constant(exports.Role.Canceller),
      jtv.constant(exports.Role.Proposer),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.RoleState = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      config: exports.MultisigConfig.decoder,
      seenHashes: damlTypes.Map(damlTypes.Text, damlTypes.Time).decoder,
      expiringRoot: exports.ExpiringRoot.decoder,
      rootMetadata: exports.RootMetadata.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      config: exports.MultisigConfig.encode(__typed__.config),
      seenHashes: damlTypes.Map(damlTypes.Text, damlTypes.Time).encode(__typed__.seenHashes),
      expiringRoot: exports.ExpiringRoot.encode(__typed__.expiringRoot),
      rootMetadata: exports.RootMetadata.encode(__typed__.rootMetadata),
    };
  },
};

exports.RootMetadata = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      chainId: damlTypes.Int.decoder,
      multisigId: damlTypes.Text.decoder,
      preOpCount: damlTypes.Int.decoder,
      postOpCount: damlTypes.Int.decoder,
      overridePreviousRoot: damlTypes.Bool.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      chainId: damlTypes.Int.encode(__typed__.chainId),
      multisigId: damlTypes.Text.encode(__typed__.multisigId),
      preOpCount: damlTypes.Int.encode(__typed__.preOpCount),
      postOpCount: damlTypes.Int.encode(__typed__.postOpCount),
      overridePreviousRoot: damlTypes.Bool.encode(__typed__.overridePreviousRoot),
    };
  },
};

exports.SignerInfo = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      signerAddress: damlTypes.Text.decoder,
      signerIndex: damlTypes.Int.decoder,
      signerGroup: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      signerAddress: damlTypes.Text.encode(__typed__.signerAddress),
      signerIndex: damlTypes.Int.encode(__typed__.signerIndex),
      signerGroup: damlTypes.Int.encode(__typed__.signerGroup),
    };
  },
};

exports.TimelockCall = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      targetInstanceAddress: damlTypes.Text.decoder,
      functionName: damlTypes.Text.decoder,
      operationData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      targetInstanceAddress: damlTypes.Text.encode(__typed__.targetInstanceAddress),
      functionName: damlTypes.Text.encode(__typed__.functionName),
      operationData: damlTypes.Text.encode(__typed__.operationData),
    };
  },
};
