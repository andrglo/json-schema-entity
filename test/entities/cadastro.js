'use strict';

var _ = require('lodash');
var co = require('co');
var entity = require('../../src');

var log = console.log;

module.exports = function(config) {

  var CADASTRO = _.cloneDeep(require('../schemas/CADASTRO.json'));
  var FORNEC = require('../schemas/FORNEC.json');
  var Classe = require('../schemas/Classificação.json');
  var CLIENTE = _.cloneDeep(require('../schemas/CLIENTE.json'));
  var ClassificacaoCad = require('../schemas/ClassificaçãoCad.json');
  var DOCPAGVC = require('../schemas/DOCPAGVC.json');
  var DOCPAGEV = require('../schemas/DOCPAGEV.json');

  let classificacao = entity('Classificação', Classe, config);
  let docpagev = entity('DOCPAGEV', DOCPAGEV, config);

  function createClasses(transaction) {
    let classcad = this.ClassificaçãoCad;
    return classcad && co(function*() {
        for (let i = 0; i < classcad.length; i++) {
          let classe = classcad[i].Classe;
          let recordset = yield classificacao.findAll({
            where: {
              id: classe
            }
          }, {transaction: transaction});
          if (recordset.length === 0) {
            yield classificacao.create({id: classe}, {transaction: transaction})
          }
        }
      });
  }

  function createEvs(t) {
    var id = this.id;
    var docpagvc = !this.docpagvc || _.isArray(this.docpagvc) ? this.docpagvc : [this.docpagvc];
    var insertion = Promise.resolve();
    _.forEach(docpagvc, function() {
      insertion = insertion.then(function() {
        return docpagev.create({
          NUMDOC: id,
          CONTAEV: 'any',
          VALOR: 10
        }, {transaction: t});
      })
    });
    return insertion;
  }

  function updateEvs(t) {
    var self = this;
    return destroyEvs.call(self, t)
      .then(function() {
        return createEvs.call(self, t)
      })
  }

  function destroyEvs(t) {
    var id = this.id;
    return docpagev
      .findAll({where: {NUMDOC: id}}, {transaction: t})
      .then(function(recordset) {
        var deletion = Promise.resolve();
        _.forEach(recordset, function(record) {
          deletion = deletion.then(function() {
            return docpagev.destroy({
              where: {id: record.id}
            }, {transaction: t})
          })
        });
        return deletion;
      });
  }

  // Schema
  let cadAtivo = entity('CADASTRO as cadAtivo', {
    title: 'Cadastro entity',
    description: 'Cadastro entity description',
    properties: _.pick(CADASTRO.properties, [
      'id',
      'NOMECAD',
      'IDENT',
      'CGCCPF',
      'INSCEST',
      'InscriçãoMunicipal',
      'DATNASC',
      'ENDERECO',
      'NUMERO',
      'COMPLEMENTO',
      'TipoSimplesNacional',
      'BAIRRO',
      'CEP',
      'CIDADE',
      'PAIS',
      'TELEFONE',
      'ESTADO',
      'FAX',
      'CELULAR',
      'EMAIL',
      'CONTAEV',
      'CONTACC',
      'Suframa',
      'Inativo'
    ])
  }, config);

  cadAtivo
    .setTitle('Cadastro title changed')
    .setProperties(function(properties) {
      properties.CONTAEV = CADASTRO.properties.CONTAEV;
      properties.TSN = properties.TipoSimplesNacional;
      properties.TSN.field = 'TipoSimplesNacional';
      properties.TSN.title = 'TSN';
      delete properties.TipoSimplesNacional;
      //noinspection JSPrimitiveTypeWrapperUsage
      properties.FAX.format = 'hidden';
      properties.IM = properties.InscriçãoMunicipal;
      properties.IM.field = 'InscriçãoMunicipal';
      delete properties.InscriçãoMunicipal;
      //noinspection JSPrimitiveTypeWrapperUsage
      properties.INSCEST.uf = 'ESTADO';
    })
    .setScope({Inativo: 'N'})
    .useTimestamps();

  cadAtivo
    .hasMany('CADASTRO as destino', {
      properties: _.pick(CADASTRO.properties, [
        'id',
        'NOMECAD',
        'IDENT',
        'NUMERO'
      ])
    })
    .foreignKey('NUMLANORI')
    .setProperties(function(properties) {
      properties.nome = properties.NOMECAD;
      properties.nome.field = 'NOMECAD';
      delete properties.NOMECAD;
      properties.Identificação = properties.IDENT;
      properties.Identificação.field = 'IDENT';
      delete properties.IDENT;
    });

  cadAtivo
    .hasMany('CADASTRO as outroDestino', {
      properties: _.pick(CADASTRO.properties, [
        'id',
        'NOMECAD',
        'IDENT',
        'NUMERO'
      ])
    })
    .foreignKey('FKOUTRO');

  cadAtivo
    .hasOne('CADASTRO as maisOutroDestino', {
      properties: _.pick(CADASTRO.properties, [
        'id',
        'NOMECAD',
        'IDENT',
        'NUMERO'
      ])
    })
    .foreignKey('NUMLANORI2');

  cadAtivo
    .hasOne('FORNEC as fornecedor', FORNEC)
    .foreignKey('id');

  cadAtivo
    .hasOne('CLIENTE as cliente', {
      properties: CLIENTE.properties
    })
    .foreignKey('id')
    .setProperties(function(properties) {
      delete properties.ENDCOB;
      properties.RAMO.title = 'Ramo de atuação';
      properties['Número de compras a prazo'] = properties.NUMCOMPP;
      properties['Número de compras a prazo'].field = 'NUMCOMPP';
      delete properties.NUMCOMPP;
    });

  cadAtivo
    .hasMany('ClassificaçãoCad', {
      properties: _.pick(ClassificacaoCad.properties, [
        'NUMCAD', //todo -> not show / but request
        'Classe'
      ])
    })
    .foreignKey('NUMCAD');

  cadAtivo
    .hasMany('DOCPAGVC as docpagvc', {
      properties: _.pick(DOCPAGVC.properties, [
        'id',
        'VALOR',
        'DATAVENC',
        'SITPGTO',
        'DATAPGTO'
      ])
    })
    .foreignKey('NUMCAD');

  cadAtivo.fornecedor
    .hasMany('DOCPAGVC as docpagvc', {
      properties: _.pick(DOCPAGVC.properties, [
        'id',
        'VALOR',
        'DATAVENC',
        'SITPGTO',
        'DATAPGTO'
      ])
    })
    .foreignKey('FORNEC');

  // Validation (before transaction, called in create(default), update(default)
  // and destroy(if options.onDelete or options.onDestroy set to true)
  cadAtivo.validate('Classes', function() {
    let rules = {
      cliente: 'Cliente',
      fornec: 'Fornecedor'
    };
    _.forEach(rules, function(classe, property) {
      if (this[property] && !_.find(this.ClassificaçãoCad, 'Classe', classe)) {
        throw new Error('Classe \'' + classe + '\' deve ser informada')
      }
    }, this);
  });
  cadAtivo.validate('Teste qualquer', function() {
  });
  cadAtivo.validate('Teste de promise', function() {
    let self = this;
    return Promise.resolve().then(function() {
      if (self.Suframa)
        throw new Error('Teste de promise');
    });
  });

  cadAtivo.validate('Duplicated CPF', function() {
    let self = this;
    if (this.CGCCPF) {
      return cadAtivo.findAll({where: {CGCCPF: this.CGCCPF}})
        .then(function(recordset) {
          recordset.map(function(record) {
            if (self.CGCCPF === record.CGCCPF && self.id !== record.id) {
              throw new Error('Query for check test');
            }
          });
        });
    }
  });

  cadAtivo.validate('NOMECAD', function(was) {
    if (was && this.NOMECAD != was.NOMECAD) {
      throw new Error('Nome não pode ser alterado');
    }
  }, {onCreate: false});
  cadAtivo.validate('COMPLEMENTO', function() {
    if (this.COMPLEMENTO === 'Do not exclude') {
      throw new Error('Cant delete record');
    }
  }, {onSave: false, onDelete: true});

  cadAtivo.fornecedor.validate('Only in fornecedor', function() {
    if (this.NUMERO !== '99') {
      throw new Error('Fornecedor deve ter numero 99')
    }
  });

  // Hooks (In transaction)
  cadAtivo.beforeDelete('Fax', function() {
    if (this.FAX)
      throw new Error('fax error');
  });
  cadAtivo.beforeDelete(function() {
  });
  cadAtivo.beforeDelete(function() {
    let self = this;
    return Promise.resolve().then(function() {
      if (self.CELULAR)
        throw new Error('celular error');
    })
  });
  cadAtivo.beforeDelete('Teste qualquer', function() {
  });
  cadAtivo.beforeSave(createClasses); //=> beforeCreate and beforeUpdate
  cadAtivo.afterCreate(createEvs);
  cadAtivo.afterUpdate(updateEvs);
  cadAtivo.beforeDestroy(destroyEvs);
  cadAtivo.beforeSave('bairro', function() {
    //noinspection JSPotentiallyInvalidUsageOfThis
    if (this.BAIRRO === 'X') throw new Error('bairro cant be X')
  });
  cadAtivo.beforeSave('pais', function() {
    //noinspection JSPotentiallyInvalidUsageOfThis
    let self = this;
    return Promise.resolve().then(function() {
      if (self.PAIS === 'X') throw new Error('pais cant be X')
    })
  });
  cadAtivo.afterCreate(function() {
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.afterCreate = true;
  });
  cadAtivo.afterUpdate(function() {
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.afterUpdate = true;
    let self = this;
    return Promise.resolve().then(function() {
      self.afterPromise = true;
    })
  });

  cadAtivo.method('quitar', function() {
    if (!this.id) {
      throw new Error('Id not found');
    }
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.quitado = 'S';
  });

  cadAtivo.method('quitar', function() {
    if (!this.id) {
      throw new Error('Id not found');
    }
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.quitado = 'S';
  });
  cadAtivo.ClassificaçãoCad.method('quitar', function() {
    if (!this.Classe) {
      throw new Error('Classe not found');
    }
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.quitado = 'S';
  });

  //// Events (Never in transaction)
  //pf.on('read', function(model) { //todo Use event emitter
  //  model.EVENTCALLED = 'Yes'
  //});

  return cadAtivo;
};

