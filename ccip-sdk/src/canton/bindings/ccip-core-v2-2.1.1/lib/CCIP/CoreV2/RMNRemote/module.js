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
var pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240 = require('@daml.js/mcms-api-1.0.0');
var pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58 = require('@daml.js/ccip-api-v2-2.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');

exports.AddCustomObservers = {
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

exports.Curse = {
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

exports.CurseChain = {
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

exports.CurseGlobal = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
    });
  }),
  encode: function (__typed__) {
    return {};
  },
};

exports.CurseMultiple = {
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

exports.GetCursedSubjects = {
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

exports.IsCursed = {
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

exports.IsCursedForChain = {
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

exports.RMNRemote = damlTypes.assembleTemplate(
  {
    templateId: '#ccip-core-v2:CCIP.CoreV2.RMNRemote:RMNRemote',
    templateIdWithPackageId: '#35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3:CCIP.CoreV2.RMNRemote:RMNRemote',
    keyDecoder: jtv.constant(undefined),
    keyEncode: function () { throw 'EncodeError'; },
    decoder: damlTypes.lazyMemo(function () {
      return jtv.object({
        instanceId: damlTypes.Text.decoder,
        rmnOwner: damlTypes.Party.decoder,
        ccipOwner: damlTypes.Party.decoder,
        customObservers: damlTypes.List(damlTypes.Party).decoder,
        cursedSubjects: damlTypes.List(damlTypes.Text).decoder,
      });
    }),
    encode: function (__typed__) {
      return {
        instanceId: damlTypes.Text.encode(__typed__.instanceId),
        rmnOwner: damlTypes.Party.encode(__typed__.rmnOwner),
        ccipOwner: damlTypes.Party.encode(__typed__.ccipOwner),
        customObservers: damlTypes.List(damlTypes.Party).encode(__typed__.customObservers),
        cursedSubjects: damlTypes.List(damlTypes.Text).encode(__typed__.cursedSubjects),
      };
    },
    AddCustomObservers: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'AddCustomObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.AddCustomObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.AddCustomObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    Archive: {
      template: function () { return exports.RMNRemote; },
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
    Curse: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'Curse',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Curse.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Curse.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    CurseChain: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'CurseChain',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CurseChain.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CurseChain.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    CurseGlobal: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'CurseGlobal',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CurseGlobal.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CurseGlobal.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    CurseMultiple: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'CurseMultiple',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.CurseMultiple.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.CurseMultiple.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    GetCursedSubjects: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'GetCursedSubjects',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.GetCursedSubjects.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.GetCursedSubjects.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.List(damlTypes.Text).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.List(damlTypes.Text).encode(__typed__); },
    },
    IsCursed: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'IsCursed',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.IsCursed.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.IsCursed.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    IsCursedForChain: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'IsCursedForChain',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.IsCursedForChain.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.IsCursedForChain.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Bool.decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Bool.encode(__typed__); },
    },
    RemoveCustomObservers: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'RemoveCustomObservers',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.RemoveCustomObservers.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.RemoveCustomObservers.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    Uncurse: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'Uncurse',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.Uncurse.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.Uncurse.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    UncurseChain: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'UncurseChain',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UncurseChain.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UncurseChain.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    UncurseGlobal: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'UncurseGlobal',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UncurseGlobal.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UncurseGlobal.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    UncurseMultiple: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'UncurseMultiple',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UncurseMultiple.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UncurseMultiple.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
    UpdateCCIPOwner: {
      template: function () { return exports.RMNRemote; },
      choiceName: 'UpdateCCIPOwner',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.UpdateCCIPOwner.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.UpdateCCIPOwner.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.ContractId(exports.RMNRemote).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.ContractId(exports.RMNRemote).encode(__typed__); },
    },
  },
  pkg7fffaf108129d37413d8edfbd91ffe373051b2cb0621c26e245093c6138daf58.CCIP.APIV2.RMNRemote.IRMNRemote,
  pkg674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240.MCMS.MCMSReceiver.MCMSReceiver,
);

damlTypes.registerTemplate(exports.RMNRemote, ['35086e11b8984749fa11117698187768af4550987924602e33e78624ba4b50e3', '#ccip-core-v2']);

exports.RemoveCustomObservers = {
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

exports.Uncurse = {
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

exports.UncurseChain = {
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

exports.UncurseGlobal = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
    });
  }),
  encode: function (__typed__) {
    return {};
  },
};

exports.UncurseMultiple = {
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

exports.UpdateCCIPOwner = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      newCCIPOwner: damlTypes.Party.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      newCCIPOwner: damlTypes.Party.encode(__typed__.newCCIPOwner),
    };
  },
};
