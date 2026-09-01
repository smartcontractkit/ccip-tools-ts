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
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@daml.js/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@daml.js/mcms-api-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e = require('@daml.js/splice-api-token-burn-mint-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8 = require('@daml.js/chainlink-api-2.0.0');

var CCIP_CoreV2_ExecutingMessage = require('../../../CCIP/CoreV2/ExecutingMessage/module');
var CCIP_CoreV2_SendingMessage = require('../../../CCIP/CoreV2/SendingMessage/module');
var CCIP_CoreV2_TokenAdminRegistryTypes = require('../../../CCIP/CoreV2/TokenAdminRegistryTypes/module');

exports.AcceptAdminRole = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.AddTokenSend = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      amount: damlTypes.Text.decoder,
      destTokenAddress: damlTypes.Text.decoder,
      extraData: damlTypes.Text.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      amount: damlTypes.Text.encode(__typed__.amount),
      destTokenAddress: damlTypes.Text.encode(__typed__.destTokenAddress),
      extraData: damlTypes.Text.encode(__typed__.extraData),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.AddTokenSendFee = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      feeUSDCents: damlTypes.Numeric(0).decoder,
      destGasOverhead: damlTypes.Int.decoder,
      destBytesOverhead: damlTypes.Int.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      feeUSDCents: damlTypes.Numeric(0).encode(__typed__.feeUSDCents),
      destGasOverhead: damlTypes.Int.encode(__typed__.destGasOverhead),
      destBytesOverhead: damlTypes.Int.encode(__typed__.destBytesOverhead),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.ConsumeReceiveTicket = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      tokenReceiveTicketCid: damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      poolInstanceId: damlTypes.Text.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      tokenReceiveTicketCid: damlTypes.ContractId(pkg506234a38fffe1945e3b5ff3a5e444a237fa9592b249b0f7444c194207df2c2d.CCIP.TicketsV2.TokenReceiveTicket).encode(__typed__.tokenReceiveTicketCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.FinalizeExecute = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      executingMessageCid: damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).decoder,
      ticketReceiver: damlTypes.Party.decoder,
      returnData: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      executingMessageCid: damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).encode(__typed__.executingMessageCid),
      ticketReceiver: damlTypes.Party.encode(__typed__.ticketReceiver),
      returnData: damlTypes.Text.encode(__typed__.returnData),
    };
  },
};

exports.Get = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.GetTokenConfigByCid = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.IsAdministrator = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(exports.TokenConfig)).decoder),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      administrator: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(exports.TokenConfig)).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      administrator: damlTypes.Party.encode(__typed__.administrator),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.ProposeAdministrator = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(exports.TokenConfig)).decoder),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.Optional(damlTypes.ContractId(exports.TokenConfig)).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.ProposeAdministratorResult = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenAdminRegistryCid: damlTypes.ContractId(exports.TokenAdminRegistry).decoder,
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      created: damlTypes.Bool.decoder,
      index: damlTypes.Int.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenAdminRegistryCid: damlTypes.ContractId(exports.TokenAdminRegistry).encode(__typed__.tokenAdminRegistryCid),
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      created: damlTypes.Bool.encode(__typed__.created),
      index: damlTypes.Int.encode(__typed__.index),
    };
  },
};

exports.SetBurnMintFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      burnMintFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      burnMintFactory: damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).encode(__typed__.burnMintFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SetInboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      executingMessageCid: damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      executingMessageCid: damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).encode(__typed__.executingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SetOutboundPoolCCVs = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder,
      poolInstanceId: damlTypes.Text.decoder,
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      sendingMessageCid: damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__.sendingMessageCid),
      poolInstanceId: damlTypes.Text.encode(__typed__.poolInstanceId),
      poolCCVs: damlTypes.List(pkgb9f630bb75179b06f350030282a2276259016da59ba60677b3a8280d854dc2d8.Chainlink.InstanceAddress.RawInstanceAddress).encode(__typed__.poolCCVs),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SetPool = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      tokenPool: jtv.Decoder.withDefault(null, damlTypes.Optional(CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      tokenPool: damlTypes.Optional(CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration).encode(__typed__.tokenPool),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.SetTransferFactory = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      transferFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).decoder),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      transferFactory: damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).encode(__typed__.transferFactory),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};

exports.TokenAdminRegistry = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        ccipOwner: damlTypes.Party.decoder,
        entryCount: damlTypes.Int.decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        entryCount: damlTypes.Int.encode(__typed__.entryCount),
      };
    },
    AcceptAdminRole: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'AcceptAdminRole',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AcceptAdminRole.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AcceptAdminRole.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.TokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.TokenConfig).encode(__typed__); },
    },
    AddTokenSend: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'AddTokenSend',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddTokenSend.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddTokenSend.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__); },
    },
    AddTokenSendFee: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'AddTokenSendFee',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddTokenSendFee.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddTokenSendFee.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.TokenAdminRegistry; },
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
    ConsumeReceiveTicket: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'ConsumeReceiveTicket',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ConsumeReceiveTicket.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ConsumeReceiveTicket.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Unit.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
    },
    FinalizeExecute: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'FinalizeExecute',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.FinalizeExecute.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.FinalizeExecute.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return CCIP_CoreV2_ExecutingMessage.FinalizeExecuteResult.decoder;
      }),
      resultEncode: function (__typed__) { return CCIP_CoreV2_ExecutingMessage.FinalizeExecuteResult.encode(__typed__); },
    },
    Get: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'Get',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Get.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Get.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenAdminRegistry.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenAdminRegistry.encode(__typed__); },
    },
    GetTokenConfigByCid: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'GetTokenConfigByCid',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetTokenConfigByCid.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetTokenConfigByCid.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.TokenConfig.decoder;
      }),
      resultEncode: function (__typed__) { return exports.TokenConfig.encode(__typed__); },
    },
    IsAdministrator: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'IsAdministrator',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.IsAdministrator.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.IsAdministrator.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    ProposeAdministrator: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'ProposeAdministrator',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.ProposeAdministrator.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.ProposeAdministrator.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return exports.ProposeAdministratorResult.decoder;
      }),
      resultEncode: function (__typed__) { return exports.ProposeAdministratorResult.encode(__typed__); },
    },
    SetBurnMintFactory: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'SetBurnMintFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetBurnMintFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetBurnMintFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.TokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.TokenConfig).encode(__typed__); },
    },
    SetInboundPoolCCVs: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'SetInboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetInboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetInboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_CoreV2_ExecutingMessage.ExecutingMessage).encode(__typed__); },
    },
    SetOutboundPoolCCVs: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'SetOutboundPoolCCVs',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetOutboundPoolCCVs.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetOutboundPoolCCVs.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(CCIP_CoreV2_SendingMessage.SendingMessage).encode(__typed__); },
    },
    SetPool: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'SetPool',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetPool.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetPool.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.TokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.TokenConfig).encode(__typed__); },
    },
    SetTransferFactory: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'SetTransferFactory',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.SetTransferFactory.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.SetTransferFactory.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.TokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.TokenConfig).encode(__typed__); },
    },
    TransferAdminRole: {
      template: function () { return exports.TokenAdminRegistry; },
      choiceName: 'TransferAdminRole',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.TransferAdminRole.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.TransferAdminRole.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.TokenConfig).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.TokenConfig).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenAdminRegistry,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.TokenAdminRegistry, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.TokenConfig = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.TokenAdminRegistry:TokenConfig',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        registryInstanceId: damlTypes.Text.decoder,
        registryOwner: damlTypes.Party.decoder,
        index: damlTypes.Int.decoder,
        isCCIPManaged: damlTypes.Bool.decoder,
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
        admin: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
        pendingAdmin: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder),
        tokenPool: jtv.Decoder.withDefault(null, damlTypes.Optional(CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration).decoder),
        transferFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).decoder),
        burnMintFactory: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).decoder),
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        registryInstanceId: damlTypes.Text.encode(__typed__.registryInstanceId),
        registryOwner: damlTypes.Party.encode(__typed__.registryOwner),
        index: damlTypes.Int.encode(__typed__.index),
        isCCIPManaged: damlTypes.Bool.encode(__typed__.isCCIPManaged),
        instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
        admin: damlTypes.Optional(damlTypes.Party).encode(__typed__.admin),
        pendingAdmin: damlTypes.Optional(damlTypes.Party).encode(__typed__.pendingAdmin),
        tokenPool: damlTypes.Optional(CCIP_CoreV2_TokenAdminRegistryTypes.PoolRegistration).encode(__typed__.tokenPool),
        transferFactory: damlTypes.Optional(damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory)).encode(__typed__.transferFactory),
        burnMintFactory: damlTypes.Optional(damlTypes.ContractId(pkg9cc2cbc838ef38dc2c7f34014c9c452bcf71b8e2a4f939235fc0b5d0924b185e.Splice.Api.Token.BurnMintV1.BurnMintFactory)).encode(__typed__.burnMintFactory),
      };
    },
    Archive: {
      template: function () { return exports.TokenConfig; },
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
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.TokenAdminRegistry.ITokenConfig,
);

damlTypes.registerTemplate(exports.TokenConfig, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.TransferAdminRole = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).decoder,
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.decoder,
      newAdmin: damlTypes.Party.decoder,
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.decoder,
      caller: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      tokenConfigCid: damlTypes.ContractId(exports.TokenConfig).encode(__typed__.tokenConfigCid),
      instrumentId: pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.InstrumentId.encode(__typed__.instrumentId),
      newAdmin: damlTypes.Party.encode(__typed__.newAdmin),
      context: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.ChoiceContext.encode(__typed__.context),
      caller: damlTypes.Party.encode(__typed__.caller),
    };
  },
};
