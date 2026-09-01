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

exports.IRMNRemote = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.RMNRemote:IRMNRemote',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.RMNRemote:IRMNRemote',
  function () { return exports.RMNRemoteView; },
  {
    Archive: {
      template: function () { return exports.IRMNRemote; },
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
    RMNRemote_GetCursedSubjects: {
      template: function () { return exports.IRMNRemote; },
      choiceName: 'RMNRemote_GetCursedSubjects',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RMNRemote_GetCursedSubjects.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RMNRemote_GetCursedSubjects.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(damlTypes.Text).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(damlTypes.Text).encode(__typed__); },
    },
    RMNRemote_IsCursed: {
      template: function () { return exports.IRMNRemote; },
      choiceName: 'RMNRemote_IsCursed',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RMNRemote_IsCursed.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RMNRemote_IsCursed.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    RMNRemote_IsCursedForChain: {
      template: function () { return exports.IRMNRemote; },
      choiceName: 'RMNRemote_IsCursedForChain',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RMNRemote_IsCursedForChain.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RMNRemote_IsCursedForChain.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    RMNRemote_PublicFetch: {
      template: function () { return exports.IRMNRemote; },
      choiceName: 'RMNRemote_PublicFetch',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RMNRemote_PublicFetch.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RMNRemote_PublicFetch.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.RMNRemoteView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.RMNRemoteView.encode(__typed__); },
    },
  }
);

exports.RMNRemoteView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      rmnOwner: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      rmnOwner: damlTypes.Party.encode(__typed__.rmnOwner),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
    };
  },
};

exports.RMNRemote_GetCursedSubjects = {
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

exports.RMNRemote_IsCursed = {
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

exports.RMNRemote_IsCursedForChain = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      chainSelector: damlTypes.Numeric(0).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      chainSelector: damlTypes.Numeric(0).encode(__typed__.chainSelector),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.RMNRemote_PublicFetch = {
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
