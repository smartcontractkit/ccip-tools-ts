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
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@daml.js/ccip-codec-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

exports.IExecutingMessage = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.ExecutingMessage:IExecutingMessage',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.ExecutingMessage:IExecutingMessage',
  function () { return exports.ExecutingMessageView; },
  {
    Archive: {
      template: function () { return exports.IExecutingMessage; },
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
    ExecutingMessage_AddCCVVerification: {
      template: function () { return exports.IExecutingMessage; },
      choiceName: 'ExecutingMessage_AddCCVVerification',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecutingMessage_AddCCVVerification.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ExecutingMessage_AddCCVVerification.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.IExecutingMessage).encode(__typed__); },
    },
    ExecutingMessage_CancelExecute: {
      template: function () { return exports.IExecutingMessage; },
      choiceName: 'ExecutingMessage_CancelExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ExecutingMessage_CancelExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ExecutingMessage_CancelExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
  }
);

exports.ITokenReceiveTicket = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.ExecutingMessage:ITokenReceiveTicket',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.ExecutingMessage:ITokenReceiveTicket',
  function () { return exports.TokenReceiveTicketView; },
  {
    Archive: {
      template: function () { return exports.ITokenReceiveTicket; },
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
    Consume: {
      template: function () { return exports.ITokenReceiveTicket; },
      choiceName: 'Consume',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Consume.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Consume.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
  }
);

exports.Consume = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
    });
  }),
  encode: function (__typed__) {
    return {};
  },
};

exports.ExecutingMessageView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
      offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
      offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.offRamp),
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.globalConfig),
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rmnRemote),
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.tokenAdminRegistry),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.ExecutingMessage_AddCCVVerification = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      versionTag: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      versionTag: damlTypes.Text.encode(__typed__.versionTag),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.ExecutingMessage_CancelExecute = {
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

exports.MessageExecutionState = {
  UNTOUCHED: 'UNTOUCHED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  keys: ['UNTOUCHED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.MessageExecutionState.UNTOUCHED),
      jtv.constant(exports.MessageExecutionState.IN_PROGRESS),
      jtv.constant(exports.MessageExecutionState.SUCCESS),
      jtv.constant(exports.MessageExecutionState.FAILURE),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.TokenReceiveTicketView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      poolOwner: damlTypes.Party.decoder,
      ccvOwners: damlTypes.List(damlTypes.Party).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};
