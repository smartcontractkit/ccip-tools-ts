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

var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-metadata-v1-1.0.0');
var pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-codec-v2-2.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@chainlink/ccip-sdk/src/canton/bindings/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@chainlink/ccip-sdk/src/canton/bindings/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@chainlink/ccip-sdk/src/canton/bindings/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@chainlink/ccip-sdk/src/canton/bindings/chainlink-api-2.0.0');

exports.Consume = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
    });
  }),
  encode: function (__typed__) {
    return {};
  },
};

exports.TokenReceiveTicket = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-tickets-v2:CCIP.TicketsV2:TokenReceiveTicket',
    templateIdWithPackageId: '#506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d:CCIP.TicketsV2:TokenReceiveTicket',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        ccipOwner: damlTypes.Party.decoder,
        ccvOwners: damlTypes.List(damlTypes.Party).decoder,
        verifiedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        requiredInboundPoolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
        tokenAdminRegistryInstanceId: damlTypes.Text.decoder,
        poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.decoder,
        poolOwner: damlTypes.Party.decoder,
        receiver: damlTypes.Party.decoder,
        tokenReceiver: damlTypes.Party.decoder,
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
        amount: damlTypes.Text.decoder,
        sourcePoolData: damlTypes.Text.decoder,
        messageId: damlTypes.Text.decoder,
        sourceChainSelector: damlTypes.Numeric(0).decoder,
        finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.decoder,
        context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        ccvOwners: damlTypes.List(damlTypes.Party).encode(__typed__.ccvOwners),
        verifiedCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.verifiedCCVs),
        requiredInboundPoolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.requiredInboundPoolCCVs),
        tokenAdminRegistryInstanceId: damlTypes.Text.encode(__typed__.tokenAdminRegistryInstanceId),
        poolAddress: pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress.encode(__typed__.poolAddress),
        poolOwner: damlTypes.Party.encode(__typed__.poolOwner),
        receiver: damlTypes.Party.encode(__typed__.receiver),
        tokenReceiver: damlTypes.Party.encode(__typed__.tokenReceiver),
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
        amount: damlTypes.Text.encode(__typed__.amount),
        sourcePoolData: damlTypes.Text.encode(__typed__.sourcePoolData),
        messageId: damlTypes.Text.encode(__typed__.messageId),
        sourceChainSelector: damlTypes.Numeric(0).encode(__typed__.sourceChainSelector),
        finality: pkg6feabd6c3535eaaa23c820efbdaed64e15d733bdbfc292b88225888162774cfb.CCIP.CodecV2.FinalityConfig.FinalityConfig.encode(__typed__.finality),
        context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      };
    },
    Archive: {
      template: function () { return exports.TokenReceiveTicket; },
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
      template: function () { return exports.TokenReceiveTicket; },
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
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.ExecutingMessage.ITokenReceiveTicket,
);

// Disable for now - causes logs on the console
// damlTypes.registerTemplate(exports.TokenReceiveTicket, ['506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d', '#ccip-tickets-v2']);
