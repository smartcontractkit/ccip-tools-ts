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

var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');

exports.MCMSReceiver = damlTypes.assembleInterface(
  '#mcms-api:MCMS.MCMSReceiver:MCMSReceiver',
  '#674d8f60de56afd32698ae19516260217c73dd9ed082680fa840ede4b7665240:MCMS.MCMSReceiver:MCMSReceiver',
  function () { return exports.MCMSReceiverView; },
  {
    Archive: {
      template: function () { return exports.MCMSReceiver; },
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
    MCMSReceiver_Entrypoint: {
      template: function () { return exports.MCMSReceiver; },
      choiceName: 'MCMSReceiver_Entrypoint',
      argumentDecoder: damlTypes.lazyMemo(function () {
        return exports.MCMSReceiver_Entrypoint.decoder;
      }),
      argumentEncode: function (__typed__) { return exports.MCMSReceiver_Entrypoint.encode(__typed__); },
      resultDecoder: damlTypes.lazyMemo(function () {
        return damlTypes.Map(damlTypes.Text, damlTypes.ContractId(damlTypes.Unit)).decoder;
      }),
      resultEncode: function (__typed__) { return damlTypes.Map(damlTypes.Text, damlTypes.ContractId(damlTypes.Unit)).encode(__typed__); },
    },
  }
);

exports.ArgValue = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.oneOf(
      jtv.object({
        tag: jtv.constant("AV_Text"),
        value: damlTypes.Text.decoder,
      }),
      jtv.object({
        tag: jtv.constant("AV_Int"),
        value: damlTypes.Int.decoder,
      }),
      jtv.object({
        tag: jtv.constant("AV_Bool"),
        value: damlTypes.Bool.decoder,
      }),
      jtv.object({
        tag: jtv.constant("AV_Party"),
        value: damlTypes.Party.decoder,
      }),
      jtv.object({
        tag: jtv.constant("AV_Time"),
        value: damlTypes.Time.decoder,
      }),
    );
  }),
  encode: function (__typed__) {
    switch(__typed__.tag) {
      case 'AV_Text': return {tag: __typed__.tag, value: damlTypes.Text.encode(__typed__.value)};
      case 'AV_Int': return {tag: __typed__.tag, value: damlTypes.Int.encode(__typed__.value)};
      case 'AV_Bool': return {tag: __typed__.tag, value: damlTypes.Bool.encode(__typed__.value)};
      case 'AV_Party': return {tag: __typed__.tag, value: damlTypes.Party.encode(__typed__.value)};
      case 'AV_Time': return {tag: __typed__.tag, value: damlTypes.Time.encode(__typed__.value)};
      default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type ArgValue';
    }
  },
};

exports.MCMSReceiverView = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      mcmsController: damlTypes.Party.decoder,
      instanceId: damlTypes.Text.decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      mcmsController: damlTypes.Party.encode(__typed__.mcmsController),
      instanceId: damlTypes.Text.encode(__typed__.instanceId),
    };
  },
};

exports.MCMSReceiver_Entrypoint = {
  decoder: damlTypes.lazyMemo(function () {
    return jtv.object({
      functionName: damlTypes.Text.decoder,
      operationData: damlTypes.Text.decoder,
      contractIds: damlTypes.Map(damlTypes.Text, damlTypes.ContractId(damlTypes.Unit)).decoder,
    });
  }),
  encode: function (__typed__) {
    return {
      functionName: damlTypes.Text.encode(__typed__.functionName),
      operationData: damlTypes.Text.encode(__typed__.operationData),
      contractIds: damlTypes.Map(damlTypes.Text, damlTypes.ContractId(damlTypes.Unit)).encode(__typed__.contractIds),
    };
  },
};
