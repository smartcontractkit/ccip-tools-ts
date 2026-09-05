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
var pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d = require('@daml.js/ccip-tickets-v2-2.0.0');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@daml.js/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');
var pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f = require('@daml.js/ccip-events-v2-2.0.0');

exports.AddCCVVerification = {
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

exports.CCVVerification = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccvInstanceId: damlTypes.Text.decoder,
      ccvOwner: damlTypes.Party.decoder,
      versionTag: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccvInstanceId: damlTypes.Text.encode(__typed__.ccvInstanceId),
      ccvOwner: damlTypes.Party.encode(__typed__.ccvOwner),
      versionTag: damlTypes.Text.encode(__typed__.versionTag),
    };
  },
};

exports.CancelExecute = {
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

exports.ExecutingMessage = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.ExecutingMessage:ExecutingMessage',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.ExecutingMessage:ExecutingMessage',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.decoder,
        messageId: damlTypes.Text.decoder,
        receiver: damlTypes.Party.decoder,
        tokenReceiver: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
        executor: damlTypes.Party.decoder,
        observingParties: damlTypes.List(damlTypes.Party).decoder,
        ccvVerifications: damlTypes.List(exports.CCVVerification).decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        optionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        optionalCCVThreshold: damlTypes.Int.decoder,
        receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
        sourceDefaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        inboundPoolVerification: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.InboundPoolVerification).decoder),
        deps: exports.ExecutingMessageDeps.decoder,
        state: exports.ExecutingMessageState.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        message: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.MessageCodecV1.MessageV1.encode(__typed__.message),
        messageId: damlTypes.Text.encode(__typed__.messageId),
        receiver: damlTypes.Party.encode(__typed__.receiver),
        tokenReceiver: damlTypes.Optional(damlTypes.Party).encode(__typed__.tokenReceiver),
        executor: damlTypes.Party.encode(__typed__.executor),
        observingParties: damlTypes.List(damlTypes.Party).encode(__typed__.observingParties),
        ccvVerifications: damlTypes.List(exports.CCVVerification).encode(__typed__.ccvVerifications),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        requiredCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredCCVs),
        optionalCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.optionalCCVs),
        optionalCCVThreshold: damlTypes.Int.encode(__typed__.optionalCCVThreshold),
        receiverFinalityConfig: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.receiverFinalityConfig),
        sourceDefaultCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.sourceDefaultCCVs),
        inboundPoolVerification: damlTypes.Optional(exports.InboundPoolVerification).encode(__typed__.inboundPoolVerification),
        deps: exports.ExecutingMessageDeps.encode(__typed__.deps),
        state: exports.ExecutingMessageState.encode(__typed__.state),
      };
    },
    AddCCVVerification: {
      template: function () { return exports.ExecutingMessage; },
      choiceName: 'AddCCVVerification',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddCCVVerification.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddCCVVerification.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ExecutingMessage).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.ExecutingMessage; },
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
    CancelExecute: {
      template: function () { return exports.ExecutingMessage; },
      choiceName: 'CancelExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CancelExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CancelExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    FinalizeExecute: {
      template: function () { return exports.ExecutingMessage; },
      choiceName: 'FinalizeExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeExecuteResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.FinalizeExecuteResult.encode(__typed__); },
    },
    SetInboundPoolCCVs: {
      template: function () { return exports.ExecutingMessage; },
      choiceName: 'SetInboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetInboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetInboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ExecutingMessage).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.IExecutingMessage,
);

damlTypes.registerTemplate(exports.ExecutingMessage, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.ExecutingMessageDeps = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      offRamp: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.offRamp),
      globalConfig: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.globalConfig),
      rmnRemote: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.rmnRemote),
      tokenAdminRegistry: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.tokenAdminRegistry),
    };
  },
};

exports.ExecutingMessageState = {
  ExecutingMessageState_RequirePoolCCVs: 'ExecutingMessageState_RequirePoolCCVs',
  ExecutingMessageState_Prepared: 'ExecutingMessageState_Prepared',
  keys: ['ExecutingMessageState_RequirePoolCCVs', 'ExecutingMessageState_Prepared'],
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.constant(exports.ExecutingMessageState.ExecutingMessageState_RequirePoolCCVs),
      jtv.constant(exports.ExecutingMessageState.ExecutingMessageState_Prepared),
    );
  }),
  encode: function (__typed__) { return __typed__; },
};

exports.FinalizeExecute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryInstanceId: damlTypes.Text.decoder,
      maybePoolAddress: jtv.Decoder.withDefault(null, damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder),
      maybeTicketReceiver: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
      maybeTokenReceiver: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
      maybeInstrumentId: jtv.Decoder.withDefault(null, damlTypes.Optional(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).decoder),
      maybeAmount: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Text).decoder),
      returnData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryInstanceId: damlTypes.Text.encode(__typed__.tokenAdminRegistryInstanceId),
      maybePoolAddress: damlTypes.Optional(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.maybePoolAddress),
      maybeTicketReceiver: damlTypes.Optional(damlTypes.Party).encode(__typed__.maybeTicketReceiver),
      maybeTokenReceiver: damlTypes.Optional(damlTypes.Party).encode(__typed__.maybeTokenReceiver),
      maybeInstrumentId: damlTypes.Optional(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId).encode(__typed__.maybeInstrumentId),
      maybeAmount: damlTypes.Optional(damlTypes.Text).encode(__typed__.maybeAmount),
      returnData: damlTypes.Text.encode(__typed__.returnData),
    };
  },
};

exports.FinalizeExecuteResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenReceiveTicket: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).decoder),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenReceiveTicket: damlTypes.Optional(damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket)).encode(__typed__.tokenReceiveTicket),
      executionStateChanged: damlTypes.ContractId(pkgbfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f.CCIP.EventsV2.Events.ExecutionStateChanged).encode(__typed__.executionStateChanged),
    };
  },
};

exports.InboundPoolVerification = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
    };
  },
};

exports.SetInboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      poolInstanceId: damlTypes.Text.decoder,
      poolOwner: damlTypes.Party.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
    };
  },
};
