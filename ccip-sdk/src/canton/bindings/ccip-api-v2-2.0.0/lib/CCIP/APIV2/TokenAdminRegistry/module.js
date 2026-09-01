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
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@daml.js/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e = require('@daml.js/splice-api-token-burn-mint-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

var CCIP_APIV2_ExecutingMessage = require('../../../CCIP/APIV2/ExecutingMessage/module');
var CCIP_APIV2_SendingMessage = require('../../../CCIP/APIV2/SendingMessage/module');

exports.ITokenAdminRegistry = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenAdminRegistry',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.TokenAdminRegistry:ITokenAdminRegistry',
  function () { return exports.TokenAdminRegistryView; },
  {
    Archive: {
      template: function () { return exports.ITokenAdminRegistry; },
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
    TokenAdminRegistry_AcceptAdminRole: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_AcceptAdminRole',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_AcceptAdminRole.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_AcceptAdminRole.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ITokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ITokenConfig).encode(__typed__); },
    },
    TokenAdminRegistry_AddTokenSend: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_AddTokenSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_AddTokenSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_AddTokenSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__); },
    },
    TokenAdminRegistry_AddTokenSendFee: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_AddTokenSendFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_AddTokenSendFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_AddTokenSendFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__); },
    },
    TokenAdminRegistry_ConsumeReceiveTicket: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_ConsumeReceiveTicket',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_ConsumeReceiveTicket.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_ConsumeReceiveTicket.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    TokenAdminRegistry_FetchTokenConfig: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_FetchTokenConfig',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_FetchTokenConfig.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_FetchTokenConfig.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfigView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenConfigView.encode(__typed__); },
    },
    TokenAdminRegistry_IsAdministrator: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_IsAdministrator',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_IsAdministrator.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_IsAdministrator.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    TokenAdminRegistry_ProposeAdministrator: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_ProposeAdministrator',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_ProposeAdministrator.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_ProposeAdministrator.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ProposeAdministratorResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ProposeAdministratorResult.encode(__typed__); },
    },
    TokenAdminRegistry_PublicFetch: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_PublicFetch',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_PublicFetch.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_PublicFetch.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistryView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenAdminRegistryView.encode(__typed__); },
    },
    TokenAdminRegistry_SetBurnMintFactory: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_SetBurnMintFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_SetBurnMintFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_SetBurnMintFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ITokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ITokenConfig).encode(__typed__); },
    },
    TokenAdminRegistry_SetInboundPoolCCVs: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_SetInboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_SetInboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_SetInboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.IExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.IExecutingMessage).encode(__typed__); },
    },
    TokenAdminRegistry_SetOutboundPoolCCVs: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_SetOutboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_SetOutboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_SetOutboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__); },
    },
    TokenAdminRegistry_SetPool: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_SetPool',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_SetPool.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_SetPool.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ITokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ITokenConfig).encode(__typed__); },
    },
    TokenAdminRegistry_SetTransferFactory: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_SetTransferFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_SetTransferFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_SetTransferFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ITokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ITokenConfig).encode(__typed__); },
    },
    TokenAdminRegistry_TransferAdminRole: {
      template: function () { return exports.ITokenAdminRegistry; },
      choiceName: 'TokenAdminRegistry_TransferAdminRole',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry_TransferAdminRole.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenAdminRegistry_TransferAdminRole.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.ITokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ITokenConfig).encode(__typed__); },
    },
  }
);

exports.ITokenConfig = damlTypes.assembleInterface(
  '#ccip-api-v2:CCIP.APIV2.TokenAdminRegistry:ITokenConfig',
  '#7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58:CCIP.APIV2.TokenAdminRegistry:ITokenConfig',
  function () { return exports.TokenConfigView; },
  {
    Archive: {
      template: function () { return exports.ITokenConfig; },
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
    TokenConfig_AssertConfiguredBurnMintFactory: {
      template: function () { return exports.ITokenConfig; },
      choiceName: 'TokenConfig_AssertConfiguredBurnMintFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfig_AssertConfiguredBurnMintFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenConfig_AssertConfiguredBurnMintFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    TokenConfig_AssertConfiguredTransferFactory: {
      template: function () { return exports.ITokenConfig; },
      choiceName: 'TokenConfig_AssertConfiguredTransferFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfig_AssertConfiguredTransferFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenConfig_AssertConfiguredTransferFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    TokenConfig_PublicFetch: {
      template: function () { return exports.ITokenConfig; },
      choiceName: 'TokenConfig_PublicFetch',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfig_PublicFetch.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TokenConfig_PublicFetch.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfigView.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenConfigView.encode(__typed__); },
    },
  }
);

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

exports.ProposeAdministratorResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(exports.ITokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      created: damlTypes.Bool.decoder,
      index: damlTypes.Int.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(exports.ITokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      created: damlTypes.Bool.encode(__typed__.created),
      index: damlTypes.Int.encode(__typed__.index),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenAdminRegistryView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
    };
  },
};

exports.TokenAdminRegistry_AcceptAdminRole = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_AddTokenSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      amount: damlTypes.Text.decoder,
      destTokenAddress: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      amount: damlTypes.Text.encode(__typed__.amount),
      destTokenAddress: damlTypes.Text.encode(__typed__.destTokenAddress),
      extraData: damlTypes.Text.encode(__typed__.extraData),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_AddTokenSendFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_ConsumeReceiveTicket = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      tokenReceiveTicketCid: damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.ITokenReceiveTicket).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      poolInstanceId: damlTypes.Text.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      tokenReceiveTicketCid: damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.ITokenReceiveTicket).encode(__typed__.tokenReceiveTicketCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_FetchTokenConfig = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_IsAdministrator = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(exports.ITokenConfig)).decoder),
      administrator: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(exports.ITokenConfig)).encode(__typed__.tokenConfigCid),
      administrator: damlTypes.Party.encode(__typed__.administrator),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_ProposeAdministrator = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(exports.ITokenConfig)).decoder),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(exports.ITokenConfig)).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_PublicFetch = {
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

exports.TokenAdminRegistry_SetBurnMintFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      burnMintFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      burnMintFactory: damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).encode(__typed__.burnMintFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_SetInboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      executingMessageCid: damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.IExecutingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      executingMessageCid: damlTypes.ContractId(CCIP_APIV2_ExecutingMessage.IExecutingMessage).encode(__typed__.executingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_SetOutboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_APIV2_SendingMessage.ISendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_SetPool = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenPool: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.PoolRegistration).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      tokenPool: damlTypes.Optional(exports.PoolRegistration).encode(__typed__.tokenPool),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_SetTransferFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      transferFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      transferFactory: damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).encode(__typed__.transferFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry_TransferAdminRole = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.ITokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenConfigView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      ccipOwner: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenPool: jtv.Decoder.withDefault(null, damlTypes.Optional(exports.PoolRegistration).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      tokenPool: damlTypes.Optional(exports.PoolRegistration).encode(__typed__.tokenPool),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
    };
  },
};

exports.TokenConfig_AssertConfiguredBurnMintFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      suppliedFactory: damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      suppliedFactory: damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory).encode(__typed__.suppliedFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenConfig_AssertConfiguredTransferFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      suppliedFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      suppliedFactory: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).encode(__typed__.suppliedFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenConfig_PublicFetch = {
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
