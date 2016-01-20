'use strict';

var _ = require('lodash');
var assert = require('assert');
var entity = require('../../src');

var log = console.log;

module.exports = function(config) {

  var CADASTRO = _.cloneDeep(require('../schemas/CADASTRO.json'));
  var FORNEC = require('../schemas/FORNEC.json');
  var CLIENTE = _.cloneDeep(require('../schemas/CLIENTE.json'));
  var ClassificacaoCad = require('../schemas/ClassificaçãoCad.json');
  var DOCPAGVC = require('../schemas/DOCPAGVC.json');

  var classificacao = config.classificacao;
  var docpagev = config.docpagev;

  function createClasses(transaction) {
    var insertion = Promise.resolve();
    _.forEach(this.ClassificaçãoCad, (classe) => {
      insertion = insertion
        .then(() => {
          return classificacao.new(this.db).fetch({where: {id: classe.Classe}}, {transaction: transaction});
        })
        .then((recordset) => {
          if (recordset.length === 0) {
            return classificacao.new(this.db).create({id: classe.Classe}, {transaction: transaction});
          }
        });
    });
    return insertion;
  }

  function createEvs(t, result) {
    var id = result.id;
    var docpagvc = !result.docpagvc || _.isArray(result.docpagvc) ? result.docpagvc : [result.docpagvc];
    var insertion = Promise.resolve();
    _.forEach(docpagvc, () => {
      insertion = insertion.then(() => {
        return docpagev.new(this.db).create({
          NUMDOC: id,
          CONTAEV: 'any',
          VALOR: 10
        }, {transaction: t});
      })
    });
    return insertion;
  }

  function updateEvs(t, result) {
    var self = this;
    return destroyEvs.call(self, t)
      .then(function() {
        return createEvs.call(self, t, result);
      });
  }

  function destroyEvs(t) {
    var id = this.id;
    var docpagevEntity = docpagev.new(this.db);
    return docpagevEntity
      .fetch({where: {NUMDOC: id}}, {transaction: t})
      .then((recordset) => {
        var deletion = Promise.resolve();
        _.forEach(recordset, (record) => {
          deletion = deletion.then(() => {
            return docpagevEntity.destroy({
              where: {id: record.id}
            }, {transaction: t})
          })
        });
        return deletion;
      });
  }

  // Schema
  var cadAtivo = entity('CADASTRO as cadAtivo', {
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
      'DATNASCZ',
      'DATNASCNOZ',
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
      'Inativo',
      'VALORLCTO',
      'futureEnum',
      'afterCreate',
      'afterUpdate',
      'afterPromise',
      'quitado'
    ])
  }, config);

  cadAtivo
    .setTitle('Cadastro title changed')
    .setDescription('Cadastro description changed')
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
        'NUMERO',
        'futureEnum',
        'Inativo'
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
        'Classe',
        'quitado'
      ])
    })
    .foreignKey('NUMCAD');

  cadAtivo
    .hasMany('DOCPAGVC as docpagvc', {
      properties: _.pick(DOCPAGVC.properties, [
        'id',
        'NUMCAD',
        'VALOR',
        'DATAVENC',
        'DATAVENCZ',
        'DATAVENCNOZ',
        'SITPGTO',
        'DATAPGTO',
        'Hora do próximo aviso'
      ])
    })
    .foreignKey('NUMCAD');

  cadAtivo.fornecedor
    .hasMany('DOCPAGVC as docpagvc', {
      properties: _.pick(DOCPAGVC.properties, [
        'id',
        'FORNEC',
        'VALOR',
        'DATAVENC',
        'SITPGTO',
        'DATAPGTO',
        'Hora do próximo aviso'
      ])
    })
    .foreignKey('FORNEC');

  // Validation (before transaction, called in create(default), update(default)
  // and destroy(if options.onDelete or options.onDestroy set to true)
  cadAtivo.validate('Classes', function() {
    var rules = {
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
    assert(this.entity, 'this should be a instance in validation');
  });
  cadAtivo.validate('Teste de promise', function() {
    var self = this;
    return Promise.resolve().then(function() {
      if (self.Suframa)
        throw new Error('Teste de promise');
    });
  });

  cadAtivo.validate('Duplicated CPF', function() {
    var self = this;
    if (this.CGCCPF) {
      return this.entity.fetch({where: {CGCCPF: this.CGCCPF}})
        .then(function(recordset) {
          recordset.map(function(record) {
            if (self.CGCCPF === record.CGCCPF && self.id !== record.id) {
              throw new Error('Query for check test');
            }
          });
        });
    }
  });

  cadAtivo.validate('NOMECAD', function() {
    if (this.was && this.NOMECAD !== this.was.NOMECAD) {
      throw new Error('Nome não pode ser alterado');
    }
  }, {onCreate: false});
  cadAtivo.validate('COMPLEMENTO', function() {
    if (this.COMPLEMENTO === 'Do not exclude') {
      throw new Error('Cant delete record');
    }
  }, {onSave: false, onDelete: true});

  cadAtivo.fornecedor.validate('Only in fornecedor', function() {
    assert(this.entity, 'this should be a instance in validation');
    if (this.NUMERO !== '99') {
      return false;
    }
  });

  cadAtivo.docpagvc.validate('Only greater or equal', function() {
    assert(this.entity, 'this should be a instance in validation');
    if (this.VALOR < this.was.VALOR) {
      throw new Error('New value should be greater or equal');
    }
  }, {onCreate: false});

  // Hooks (In transaction)
  cadAtivo.beforeDelete('Fax', function() {
    if (this.FAX)
      throw new Error('fax error');
  });
  cadAtivo.beforeDelete(function() {
  });
  cadAtivo.beforeDelete(function() {
    var self = this;
    return Promise.resolve().then(function() {
      if (self.CELULAR)
        throw new Error('celular error');
    });
  });
  cadAtivo.beforeCreate('bc', function() {
    assert(this.entity, 'this should be a instance in beforeCreate');
  });
  cadAtivo.afterCreate('ac', function(t, result) {
    assert(this.entity, 'this should be a instance in afterCreate');
    assert(result && !result.entity, 'second parameter should be the server return afterCreate');
  });
  cadAtivo.beforeUpdate('bu', function() {
    assert(this.entity, 'this should be a instance in beforeUpdate');
  });
  cadAtivo.afterUpdate('au', function(t, result) {
    assert(this.entity, 'this should be a instance in afterUpdate');
    assert(result && !result.entity, 'second parameter should be the server return afterUpdate');
  });
  cadAtivo.beforeDelete('bd', function() {
    assert(this.entity, 'this should be a instance in beforeDelete');
  });
  cadAtivo.afterDelete('ad', function(t, result) {
    assert(this.entity, 'this should be a instance in afterDelete');
    assert(result && !result.entity, 'second parameter should be the server return afterDelete');
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
    var self = this;
    return Promise.resolve().then(function() {
      if (self.PAIS === 'X') throw new Error('pais cant be X')
    })
  });
  cadAtivo.afterCreate(function(t, result) {
    //noinspection JSPotentiallyInvalidUsageOfThis
    result.afterCreate = 'true';
  });
  cadAtivo.afterUpdate(function(t, result) {
    //noinspection JSPotentiallyInvalidUsageOfThis
    result.afterUpdate = 'true';
    return Promise.resolve().then(function() {
      result.afterPromise = 'true';
    });
  });

  cadAtivo.instanceMethod('quitar', function() {
    if (!this.id) {
      throw new Error('Id not found');
    }
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.quitado = 'S';
  });

  cadAtivo.ClassificaçãoCad.instanceMethod('quitar', function() {
    if (!this.Classe) {
      throw new Error('Classe not found');
    }
    //noinspection JSPotentiallyInvalidUsageOfThis
    this.quitado = 'S';
  });

  cadAtivo.ClassificaçãoCad.beforeCreate('bc', function() {
    assert(this.entity, 'this should be a instance in beforeCreate');
  });
  cadAtivo.ClassificaçãoCad.afterCreate('ac', function(t, result) {
    assert(this.entity, 'this should be a instance in afterCreate');
    assert(result && !result.entity, 'second parameter should be the server return afterCreate');
  });
  cadAtivo.ClassificaçãoCad.beforeUpdate('bu', function() {
    assert(this.entity, 'this should be a instance in beforeUpdate');
  });
  cadAtivo.ClassificaçãoCad.afterUpdate('au', function(t, result) {
    assert(this.entity, 'this should be a instance in afterUpdate');
    assert(result && !result.entity, 'second parameter should be the server return afterUpdate');
  });
  cadAtivo.ClassificaçãoCad.beforeDelete('bd', function() {
    assert(this.entity, 'this should be a instance in beforeDelete');
  });
  cadAtivo.ClassificaçãoCad.afterDelete('ad', function(t, result) {
    assert(this.entity, 'this should be a instance in afterDelete');
    assert(result && !result.entity, 'second parameter should be the server return afterDelete');
  });

  return cadAtivo;
};

