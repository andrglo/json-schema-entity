'use strict';

var chai = require('chai');
var expect = chai.expect;
chai.should();
var _ = require('lodash');
var validator = require('validator');
var brV = require('br-validations');
var gutil = require('gulp-util');
var sqlView = require('sql-view');

var entity = require('../src');

var CADASTRO = require('./schemas/CADASTRO.json');
var DOCPAGVC = require('./schemas/DOCPAGVC.json');
var FORNEC = require('./schemas/FORNEC.json');
var EVENTO = require('./schemas/EVENTO.json');
var DOCPAGEV = require('./schemas/DOCPAGEV.json');
var CLASSE = require('./schemas/Classificação.json');

var log = gutil.log;
var logObj = function(name, obj) {
  log(name, JSON.stringify(obj, null, '  '));
};
var logError = function(done) {
  return function(err) {
    if (err) {
      log('Error', gutil.colors.red(JSON.stringify(err, null, '  ')));
    }
    done(err);
  };
};

function addValidations(validator) {
  validator.extend('cpfcnpj', function(value) {
    return brV.cpf.validate(value) || brV.cnpj.validate(value);
  });
  validator.extend('cpf', function(value) {
    return brV.cpf.validate(value);
  });
  validator.extend('cnpj', function(value) {
    return brV.cnpj.validate(value);
  });
  validator.extend('br-phone', function(value) {
    return new Promise(function(resolve, reject) {
      if (value.length >= 9) {
        resolve();
      } else {
        reject(new Error('br-phone must be greater than nine'));
      }
    });
  });
  validator.extend('cep', function(value, p1, p2) {
    expect(p1).to.equal('any string');
    expect(p2).to.be.a('array');
    expect(p2.length).to.equal(2);
    expect(p2[0]).to.equal('a');
    expect(p2[1]).to.equal('array');
    return value.length === 8;
  });
  validator.extend('ie', function(value, estado) {
    if (value && !brV.ie(estado).validate(value)) {
      throw new Error('Inscrição estadual inválida');
    }
  });
}

// Define as constant
const privateData = new WeakMap();

class MyClass {
  constructor(name, age) {
    privateData.set(this, {name: name, age: age});
    //this.address = 'strrer'
    Object.defineProperty(this, 'cst', {
      get: function() {
        return privateData.get(this)['cst'];
      },
      set: function(value) {
        privateData.get(this).cst = value;
      },
      enumerable: true
    });
  }

  get latest() {
    return privateData.get(this).latest;
  }

  set latest(latest) {
    let data = privateData.get(this);
    data.latest = latest;
  }

  getName() {
    return privateData.get(this).name;
  }

  getAge() {
    return privateData.get(this).age;
  }

  //get address() {
  //  return this.address;
  //}
  //
  //set address(address) {
  //  //this.address = address;
  //}

  addColumn(name) {
    Object.defineProperty(this, name, {
      get: function() {
        return privateData.get(this)[name];
      },
      set: function(value) {
        privateData.get(this)[name] = value;
      },
      enumerable: true
    });
  }

}

module.exports = function(options) {

  var db;
  describe('single table', function() {

    var start;
    var end;

    var tableCadastro;
    var joao;

    var minNanoSecsToSave = 3 * 1000000; // 3 milliseconds (min min = 1)

    before(function(done) {
      db = options.db;
      tableCadastro = entity('CADASTRO', CADASTRO, {db: db}).useTimestamps();
      tableCadastro.validate('TEST', function() {
        if (!this.NUMERO) {
          throw new Error('NUMERO must be informed');
        }
      });
      tableCadastro.createTables()
        .then(function() {
          done();
        })
        .catch(logError(done));
    });

    it('study classes', function(done) {
      var m = new MyClass('andre', 34);
      m.addColumn('teste')
      Object.freeze(m)
      var n = new MyClass('bruna', 29);
      Object.freeze(n)

      logObj('m', m)
      logObj('m.name', m.getName())
      //m.ABC = 'cde'
      //m.address = 'new addre'
      logObj('m', m)
      logObj('n', n)
      logObj('n.name', n.getName())

      m.latest = 'nowww';
      logObj('m after latest', m)
      logObj('latest', m.latest)
      m.teste = 'teste included'
      m.cst = 1001;
      logObj('teste', m.teste)
      logObj('m', m)

      //done(new Error('See'))
      done()
    });

    it('record should not exist', function(done) {
      tableCadastro
        .fetch({where: {id: 8}})
        .then(function(recordset) {
          expect(recordset).to.be.a('array');
          expect(recordset.length).to.equal(0);
          done();
        })
        .catch(function(err) {
          done(err);
        });
    });
    it('record should not be created due validation', function(done) {
      tableCadastro
        .create({
          NOMECAD: 'João'
        })
        .then(function() {
          done(new Error('Record with missing NUMERO has been created'));
        })
        .catch(function(error) {
          expect(error.name).to.equal('EntityError');
          expect(error.type).to.equal('ValidationError');
          expect(error.errors).to.be.a('array');
          expect(error.errors[0].path).to.equal('TEST');
          done();
        })
        .catch(logError(done));
    });
    it('record should be created', function(done) {
      var now = Date.now();
      start = process.hrtime();
      tableCadastro
        .create({
          NOMECAD: 'João',
          NUMERO: '1',
          Inativo: 'Não'
        })
        .then(function(record) {
          end = process.hrtime(start);
          joao = record;
          record.should.have.property('id');
          record.should.have.property('createdAt');
          record.should.have.property('updatedAt');
          expect(end[1] > minNanoSecsToSave).to.equal(true); // mssql Macbook 33.700 iMac retina 22.786
          record.createdAt.toISOString().should.equal(record.updatedAt.toISOString());
          expect(record.createdAt).to.be.a('date');
          expect(record.createdAt >= now).to.equal(true);
          done();
        })
        .catch(function(err) {
          done(err);
        });
    });
    it('then can have only one field updated', function(done) {
      var now = new Date(Date.now());
      tableCadastro
        .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
        .then(function(recordset) {
          var record = recordset[0];
          start = process.hrtime();
          return tableCadastro.update({
            IDENT: 'J',
            TipoSimplesNacional: '2 - Optante ME/EPP'
          }, {where: {id: record.id, updatedAt: record.updatedAt}});
        })
        .then(function(record) {
          end = process.hrtime(start);
          record.should.have.property('NOMECAD');
          record.should.have.property('IDENT');
          record.should.have.property('NUMERO');
          expect(end[1] > minNanoSecsToSave).to.equal(true); // mssql Macbook 20.320 iMac retina 13.110
          expect(record.createdAt).to.be.a('date');
          expect(record.updatedAt >= now).to.equal(true);
          expect(record.updatedAt >= joao.updatedAt).to.equal(true);
          expect(record.updatedAt >= record.createdAt).to.equal(true);
          joao = record;
          done();
        })
        .catch(logError(done));
    });
    it('and can be deleted', function(done) {
      start = process.hrtime();
      tableCadastro
        .destroy({where: {id: joao.id, updatedAt: joao.updatedAt}})
        .then(function(res) {
          end = process.hrtime(start);
          expect(end[1] > minNanoSecsToSave).to.equal(true); // mssql Macbook 14.349 iMac retina 11.443
          expect(res).to.equal(undefined);
          done();
        })
        .catch(function(err) {
          done(err);
        });
    });

  });

  describe('complex entity', function() {

    var cadAtivo;
    var tableCadastro;
    var tableFornec;
    var tableEvento;
    var tableDocpagvc;
    var tableDocpagev;

    var joao;
    var joana;
    var geralda;
    var any;
    var mario;
    var lidia;
    var mariana;
    var jessica;

    before(function(done) {
      addValidations(validator);

      var classificacao = entity('Classificação', CLASSE, {db: db});
      var docpagev = entity('DOCPAGEV', DOCPAGEV, {db: db});
      cadAtivo = require('./entities/cadastro.js')({
        db: db,
        validator: validator,
        classificacao: classificacao,
        docpagev: docpagev
      });
      cadAtivo
        .createTables()
        .then(function() {
          return cadAtivo.syncTables();
        })
        .then(function() {
          tableEvento = entity('EVENTO', EVENTO, {db: db});
          return tableEvento.createTables();
        })
        .then(function() {
          tableCadastro = entity('CADASTRO', CADASTRO, {db: db});
          return tableCadastro.syncTables();
        })
        .then(function() {
          tableFornec = entity('FORNEC', FORNEC, {db: db});
          return tableFornec.syncTables();
        })
        .then(function() {
          tableDocpagvc = entity('DOCPAGVC', DOCPAGVC, {db: db});
          return tableDocpagvc.syncTables();
        })
        .then(function() {
          tableDocpagev = entity('DOCPAGEV', DOCPAGEV, {db: db});
          return tableDocpagev.createTables();
        })
        .then(function() {
          return docpagev.syncTables();
        })
        .then(function() {
          return classificacao.createTables();
        })
        .then(function() {
          done();
        })
        .catch(logError(done));
    });

    describe('check structure', function() {

      it('should not accept a invalid db layer', function() {
        try {
          entity('CADASTRO', CADASTRO, {db: {}}).useTimestamps();
          //noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid entity created');
        } catch (error) {
          error.should.have.property('message');
          expect(error.message).to.equal('Adapter for this conector is not implemented');
        }
      });
      it('should have property destino', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('destino');
        schema.properties.destino.should.have.property('items');
        schema.properties.destino.items.should.have.property('properties');
        expect(Object.keys(schema.properties.destino.items.properties).length).to.equal(5);
      });
      it('should have property outroDestino', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('outroDestino');
        schema.properties.outroDestino.should.have.property('items');
        schema.properties.outroDestino.items.should.have.property('properties');
        expect(Object.keys(schema.properties.outroDestino.items.properties).length).to.equal(3);
      });
      it('should have a customized title for property TipoSimplesNacional', function() {
        var schema = cadAtivo.getSchema();
        var properties = Object.keys(schema.properties);
        expect(properties.length).to.equal(37);
        expect(properties.indexOf('FAX')).to.equal(-1);
        expect(properties.indexOf('IM')).to.above(-1);
        expect(properties.indexOf('TSN')).to.above(-1);
        expect(schema.properties.TSN.title).to.equal('TSN')
      });
      it('should have property fornecedor', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('fornecedor');
        schema.properties.fornecedor.should.have.property('type');
        schema.properties.fornecedor.type.should.equal('object');
        schema.properties.fornecedor.should.have.property('properties');
        expect(Object.keys(schema.properties.fornecedor.properties).length).to.equal(61);
      });
      it('should have property cliente', function() {
        cadAtivo.should.have.property('cliente');
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('cliente');
        schema.properties.cliente.should.have.property('type');
        schema.properties.cliente.type.should.equal('object');
        schema.properties.cliente.should.have.property('properties');
        schema.properties.cliente.properties.should.not.have.property('ENDCOB');
        schema.properties.cliente.properties.should.not.have.property('NUMCOMPP');
        schema.properties.cliente.properties.should.have.property('Número de compras a prazo');
        schema.properties.cliente.properties.should.have.property('RAMO');
        schema.properties.cliente.properties.RAMO.title.should.equal('Ramo de atuação');
        expect(Object.keys(schema.properties.cliente.properties).length).to.equal(66);
      });
      it('should have property classificacaocad', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('ClassificaçãoCad');
        schema.properties.ClassificaçãoCad.should.have.property('items');
        schema.properties.ClassificaçãoCad.items.should.have.property('properties');
        expect(Object.keys(schema.properties.ClassificaçãoCad.items.properties).length).to.equal(1);
      });
      it('should have property docpagvc', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('docpagvc');
        schema.properties.docpagvc.should.have.property('items');
        schema.properties.docpagvc.items.should.have.property('properties');
        expect(Object.keys(schema.properties.docpagvc.items.properties).length).to.equal(6);
      });
      it('should have property docpagvc in fornecedor', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('fornecedor');
        schema.properties.fornecedor.properties.should.have.property('docpagvc');
        schema.properties.fornecedor.properties.docpagvc.should.have.property('items');
        schema.properties.fornecedor.properties.docpagvc.items.should.have.property('properties');
        expect(Object.keys(schema.properties.fornecedor.properties.docpagvc.items.properties).length).to.equal(4);
      });
      it('should not have entity methods in association', function() {
        cadAtivo.fornecedor.should.not.have.property('fetch');
        cadAtivo.fornecedor.should.not.have.property('setScope');
        cadAtivo.fornecedor.should.not.have.property('getSchema');
        cadAtivo.fornecedor.should.not.have.property('create');
        cadAtivo.fornecedor.should.not.have.property('update');
        cadAtivo.fornecedor.should.not.have.property('destroy');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('fetch');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('setScope');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('getSchema');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('create');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('update');
        cadAtivo.fornecedor.docpagvc.should.not.have.property('destroy');
      });
    });

    describe('get cadastro id 8', function() {
      it('should not exist', function(done) {
        cadAtivo
          .fetch({where: {id: 8}})
          .then(function(cadastro) {
            expect(cadastro).to.be.a('array');
            expect(cadastro.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
    });

    describe('create cadastro', function() {
      it('should not create a new cadastro with a partial enum', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'João',
            NUMERO: '1',
            COMPLEMENTO: 'Do not exclude',
            TSN: '1'
          })
          .then(function() {
            done(new Error('Invalid record created'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('TSN');
            error.should.have.property('message');
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('should create a new cadastro', function(done) {
        var now = new Date(Date.now());
        cadAtivo
          .create({
            NOMECAD: 'João',
            NUMERO: '1',
            COMPLEMENTO: 'Do not exclude'
          })
          .then(function(record) {
            joao = record;
            record.should.have.property('id');
            record.should.have.property('createdAt');
            record.should.have.property('updatedAt');
            record.createdAt.toISOString().should.equal(record.updatedAt.toISOString());
            expect(record.createdAt).to.be.a('date');
            expect(record.createdAt >= now).to.equal(true);
            record.should.have.property('Inativo');
            expect(record.Inativo).to.equal('Não');
            expect(record.afterCreate).to.equal('true');
            expect(record.afterUpdate).to.be.undefined;
            expect(record.afterPromise).to.be.undefined;
            done();
          })
          .catch(logError(done));
      });
      it('should not create a new cadastro with wrong CPF', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            CGCCPF: '18530249111'
          })
          .then(function() {
            done(new Error('Invalid record created'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('CGCCPF');
            error.should.have.property('message');
            done();
          })
          .catch(logError(done));
      });
      it('should not create a new cadastro with wrong br-phone', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              }
            ],
            cliente: {
              FONECOB: '1'
            }
          })
          .then(function() {
            done(new Error('Invalid record created'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('FONECOB');
            error.should.have.property('message');
            done();
          })
          .catch(logError(done));
      });
      it('should create a new cadastro with CPF', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            CGCCPF: '18530249100'
          })
          .then(function(record) {
            record.should.have.property('CGCCPF');
            done();
          })
          .catch(logError(done));
      });
      it('should reject create a new cadastro with the same CPF', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Rick',
            NUMERO: '3',
            CGCCPF: '18530249100'
          })
          .then(function() {
            done(new Error('Record with CPF duplicated has been created'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Duplicated CPF');
            error.should.have.property('message');
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('should throw a CEP and a NUMERO validation error', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'CEP incompleto',
            CEP: '30000',
            NUMERO: '9000',
            fornecedor: {}
          })
          .then(function() {
            done(new Error('Saved with incorrect CEP'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(2);
            expect(error.errors[0].path).to.equal('CEP');
            expect(error.errors[1].path).to.equal('Only in fornecedor');
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should throw a INSCEST validation error', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'IE não é deste estado',
            ESTADO: 'SP',
            NUMERO: '4',
            INSCEST: '1860558000110'
          })
          .then(function() {
            done(new Error('Saved with incorrect INSCEST'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('INSCEST');
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should throw a maxLength and a decimals validation error', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Too many decimas',
            NUMERO: '4',
            VALORLCTO: 12345.678
          })
          .then(function() {
            done(new Error('Saved with too many decimals'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(2);
            expect(error.errors[0].path).to.equal('VALORLCTO');
            expect(error.errors[1].path).to.equal('VALORLCTO');
            var message = error.errors[0].message + ' - ' + error.errors[1].message;
            expect(message).to.contains('decimals');
            expect(message).to.contains('exceeds maximum length');
            done();
          })
          .catch(logError(done));
      });
      it('should throw 2 ENDERECO validation error', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Wrong',
            NUMERO: '4',
            ENDERECO: 'Road'
          })
          .then(function() {
            done(new Error('Saved with wrong ENDERECO'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(2);
            expect(error.errors[0].path).to.equal('ENDERECO');
            expect(error.errors[1].path).to.equal('ENDERECO');
            var message = error.errors[0].message + ' - ' + error.errors[1].message;
            expect(message).to.contains('STREET or AVENUE');
            expect(message).to.contains('uppercase');
            done();
          })
          .catch(logError(done));
      });
      it('should create 3 new classes', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Eu sou corredor, nadador e cliente',
            NUMERO: '5',
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              },
              {
                Classe: 'Corredor'
              },
              {
                Classe: 'Nadador'
              }
            ]
          })
          .then(function(record) {
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad).to.be.a('array');
            expect(record.ClassificaçãoCad.length).to.equal(3);
            expect(_.find(record.ClassificaçãoCad, 'Classe', 'Cliente')).to.be.a('object');
            expect(_.find(record.ClassificaçãoCad, 'Classe', 'Corredor')).to.be.a('object');
            expect(_.find(record.ClassificaçãoCad, 'Classe', 'Nadador')).to.be.a('object');
            done();
          })
          .catch(logError(done));
      });
      it('should not accept a new cliente without classe cliente', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Falta classe cliente',
            NUMERO: '5',
            fornecedor: {
              SIGLAFOR: 'Sigla',
              NUMERO: '99'
            },
            ClassificaçãoCad: [
              {
                "Classe": 'Fornecedor'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          })
          .then(function() {
            done(new Error('Saved with missing classe'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Classes');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('should not accept a new cadastro with field Suframa', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Suframa is invalid',
            NUMERO: '5',
            Suframa: 'not allow'
          })
          .then(function() {
            done(new Error('Saved with Suframa'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Teste de promise');
            done();
          })
          .catch(logError(done));
      });
      it('should not accept a new cliente without classe cliente and with Suframa and fornecedor with no NUMERO=99', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Falta classe cliente and have suframa',
            NUMERO: '5',
            Suframa: 'not allow',
            fornecedor: {
              SIGLAFOR: 'Sigla'
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          })
          .then(function() {
            done(new Error('Saved with missing classe'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(3);
            var classes;
            var suframa;
            var fornecedor;
            error.errors.forEach(function(detail) {
              if (detail.path === 'Classes') {
                classes = true
              } else if (detail.path === 'Teste de promise') {
                suframa = true
              } else if (detail.path === 'Only in fornecedor') {
                fornecedor = true
              }
            });
            expect(classes).to.equal(true);
            expect(suframa).to.equal(true);
            expect(fornecedor).to.equal(true);
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('should reject a new cadastro with two auto relations without NUMERO', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Joana',
            NUMERO: '10',
            fornecedor: {},
            destino: [{
              nome: 'Maria',
              IDENT: 'Fatima'
            },
              {
                nome: 'Maria 2',
                IDENT: 'Fatima 2'
              }],
            outroDestino: {
              NOMECAD: 'Gilda',
              IDENT: 'Jessica'
            }
          })
          .then(function(record) {
            done(new Error('Invalid record created'));
          })
          .catch(function() {
            done();
          })
      });
      it('hook test should not accept a new cadastro with field BAIRRO=X', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Bairro is invalid',
            NUMERO: '5',
            BAIRRO: 'X'
          })
          .then(function() {
            done(new Error('Saved with BAIRRO=X'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('bairro');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('hook test should not accept a new cadastro with field PAIS=X', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Pais is invalid',
            NUMERO: '5',
            PAIS: 'X'
          })
          .then(function() {
            done(new Error('Saved with PAIS=X'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('pais');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('hook test should not accept a new cadastro with field BAIRRO=X, PAIS=X but ' +
        'only one error can be reported and should be the first hook added', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Bairro and pais are invalid',
            NUMERO: '5',
            BAIRRO: 'X',
            PAIS: 'X'
          })
          .then(function() {
            done(new Error('Saved with BAIRRO=X, PAIS=X'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('bairro');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('should create a new cadastro with two hasMany self relation', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Joana',
            NUMERO: '10',
            destino: [{
              nome: 'Maria',
              IDENT: 'Fatima',
              NUMERO: '11'
            }, {
              nome: 'Maria 2',
              IDENT: 'Fatima 2',
              NUMERO: '12'
            }],
            outroDestino: {
              NOMECAD: 'Gilda',
              IDENT: 'Jessica',
              NUMERO: '13'
            }
          })
          .then(function(record) {
            joana = record;
            record.should.have.property('destino');
            expect(record.destino.length).to.equal(2);
            record.destino[0].should.have.property('nome');
            record.destino[0].should.not.have.property('NOMECAD');

            record.destino[0].NUMLANORI.should.equal(record.id);
            record.destino[1].NUMLANORI.should.equal(record.id);
            record.should.have.property('outroDestino');
            record.outroDestino[0].NOMECAD.should.equal('Gilda');
            record.outroDestino[0].IDENT.should.equal('Jessica');
            record.outroDestino[0].FKOUTRO.should.equal(record.id);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should create a new cadastro with one hasOne self relation', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Geralda',
            NUMERO: '10',
            destino: {
              nome: 'GildaNA',
              IDENT: 'JessicaNA',
              NUMERO: '13'
            },
            maisOutroDestino: {
              NOMECAD: 'Gilda',
              IDENT: 'Jessica',
              NUMERO: '13'
            },
            docpagvc: {
              VALOR: 700,
              DATAVENC: '2015-08-23'
            }
          })
          .then(function(record) {
            geralda = record;
            record.should.have.property('maisOutroDestino');
            record.maisOutroDestino.NOMECAD.should.equal('Gilda');
            record.maisOutroDestino.IDENT.should.equal('Jessica');
            record.maisOutroDestino.NUMLANORI2.should.equal(record.id);

            record.should.have.property('docpagvc');
            expect(record.docpagvc).to.be.a('array');
            expect(record.docpagvc.length).to.equal(1);

            expect(record.DATNASC).to.equal(undefined);

            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('check if the vctos array generate an external table', function(done) {
        tableDocpagev
          .fetch({where: {NUMDOC: geralda.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('should accept a new cliente/fornecedor', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Cliente ok',
            NUMERO: '5',
            DATNASC: '1999-12-31',
            DATNASCZ: '1999-12-31T00:00:00Z',
            DATNASCNOZ: new Date('1999-12-31T19:00:00'),
            fornecedor: {
              SIGLAFOR: 'Sigla',
              NUMERO: '99'
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              },
              {
                Classe: 'Cliente'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          })
          .then(function(record) {
            any = record;
            done();
          })
          .catch(logError(done));
      });
      it('lets check the new cliente/fornecedor', function(done) {
        cadAtivo
          .fetch({where: {id: any.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = any = recordset[0];
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad).to.be.a('array');
            record.should.have.property('DATNASC');
            expect(record.DATNASC).to.equal('1999-12-31');
            record.should.have.property('DATNASCZ');
            expect(record.DATNASCZ.toISOString()).to.equal('1999-12-31T00:00:00.000Z');
            record.should.have.property('DATNASCNOZ');
            expect(record.DATNASCNOZ.toISOString()).to.equal(new Date('1999-12-31T19:00:00').toISOString());
            expect(record.cliente).to.be.a('object');
            expect(record.fornecedor).to.be.a('object');
            expect(record.ClassificaçãoCad.length).to.equal(2);
            expect(_.find(record.ClassificaçãoCad, 'Classe', 'Cliente')).to.be.a('object');
            expect(_.find(record.ClassificaçãoCad, 'Classe', 'Fornecedor')).to.be.a('object');
            done();
          })
          .catch(logError(done));
      });

      it('lets clear the date', function(done) {
        any.DATNASC = null;
        any.save()
          .then(function() {
            expect(any.DATNASC).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });

      it('lets create with a null date', function(done) {
        any = cadAtivo.createInstance({
          NOMECAD: 'Any new'
        });
        any.DATNASC = null;
        any.save()
          .then(function() {
            expect(any.DATNASC).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });

    });

    describe('update cadastro', function() {

      it('should update João to be a client', function(done) {
        var now = new Date(Date.now());
        cadAtivo
          .fetch({where: {id: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var entity = recordset[0];
            entity.ClassificaçãoCad = [
              {
                Classe: 'Cliente'
              }
            ];
            entity.cliente = {
              SIGLACLI: 'Sigla',
              DATMAIA: '2015-02-02'
            };
            return cadAtivo
              .update(entity)
              .then(function(record) {
                record.should.have.property('cliente');
                expect(record.cliente.SIGLACLI).to.equal('Sigla');
                record.should.have.property('ClassificaçãoCad');
                expect(record.ClassificaçãoCad.length).to.equal(1);
                expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
                expect(record.cliente.DATMAIA).to.be.a('string');
                expect(record.cliente.DATMAIA).to.equal('2015-02-02');
                record.should.have.property('updatedAt');
                expect(record.updatedAt).to.be.a('date');
                expect(record.updatedAt >= now).to.equal(true);
                expect(record.updatedAt > joao.updatedAt).to.equal(true);
                expect(record.afterCreate).to.be.undefined;
                expect(record.afterUpdate).to.equal('true');
                expect(record.afterPromise).to.equal('true');
                return cadAtivo
                  .fetch({where: {id: joao.id}})
                  .then(function(recordset) {
                    expect(recordset).to.be.a('array');
                    expect(recordset.length).to.equal(1);
                    var record = recordset[0];
                    record.should.have.property('cliente');
                    expect(record.cliente.SIGLACLI).to.equal('Sigla');
                    record.should.have.property('ClassificaçãoCad');
                    expect(record.ClassificaçãoCad.length).to.equal(1);
                    expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
                    expect(record.cliente.DATMAIA).to.be.a('string');
                    expect(record.cliente.DATMAIA).to.equal('2015-02-02');
                    record.should.have.property('updatedAt');
                    expect(record.updatedAt).to.be.a('date');
                    expect(record.updatedAt >= now).to.equal(true);
                    expect(record.updatedAt > joao.updatedAt).to.equal(true);
                    joao = record;
                    done();
                  })
              })
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('replace hasMany array', function(done) {
        cadAtivo
          .update({
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              },
              {
                Classe: 'Fornecedor'
              }
            ],
            updatedAt: joao.updatedAt
          }, {where: {id: joao.id}})
          .then(function(record) {
            joao = record;
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(2);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should not remove a item from the array that cannot be removed', function(done) {
        cadAtivo
          .update({
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ],
            updatedAt: joao.updatedAt
          }, joao.id)
          .then(function(r) {
            done(new Error('Saved invalid record'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Classes');
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('add vctos array', function(done) {
        cadAtivo
          .update({
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              }
            ],
            docpagvc: {
              VALOR: 700,
              DATAVENC: '2015-08-23',
              DATAVENCZ: '1999-12-31T00:00:00Z',
              DATAVENCNOZ: new Date('1999-12-31T19:00:00')
            },
            VALORLCTO: 700,
            updatedAt: joao.updatedAt
          }, joao.id)
          .then(function(record) {
            joao = record;
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(1);
            record.should.have.property('docpagvc');
            expect(record.docpagvc.length).to.equal(1);
            expect(Number(record.docpagvc[0].VALOR)).to.equal(700);
            record.should.have.property('VALORLCTO');
            expect(Number(record.VALORLCTO)).to.equal(700);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('check if the added vctos array generate an external table', function(done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('and check the vctos array', function(done) {
        cadAtivo
          .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = recordset[0];
            record.should.have.property('docpagvc');
            expect(record.docpagvc.length).to.equal(1);
            expect(Number(record.docpagvc[0].VALOR)).to.equal(700);
            record.should.have.property('VALORLCTO');
            expect(Number(record.VALORLCTO)).to.equal(700);
            record.docpagvc[0].should.have.property('DATAVENC');
            expect(record.docpagvc[0].DATAVENC).to.equal('2015-08-23');
            record.docpagvc[0].should.have.property('DATAVENCZ');
            expect(record.docpagvc[0].DATAVENCZ.toISOString()).to.equal('1999-12-31T00:00:00.000Z');
            record.docpagvc[0].should.have.property('DATAVENCNOZ');
            expect(record.docpagvc[0].DATAVENCNOZ.toISOString()).to.equal(new Date('1999-12-31T19:00:00').toISOString());
            done();
          })
          .catch(logError(done));
      });
      it('replace vctos array', function(done) {
        cadAtivo
          .update({
            docpagvc: [{
              VALOR: 350.01,
              DATAVENC: '2015-08-23'
            },
              {
                VALOR: 250.02,
                DATAVENC: '2015-09-23'
              }],
            updatedAt: joao.updatedAt
          }, joao.id)
          .then(function(record) {
            joao = record;
            record.should.have.property('docpagvc');
            expect(record.docpagvc.length).to.equal(2);
            expect(Number(record.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.docpagvc[1].VALOR)).to.equal(250.02);
            done();
          })
          .catch(logError(done));
      });
      it('add more one vcto', function(done) {
        joao.docpagvc.push({VALOR: 10, DATAVENC: '2015-09-24'});
        cadAtivo
          .update(joao, joao.id)
          .then(function(record) {
            joao = record;
            record.should.have.property('docpagvc');
            expect(record.docpagvc.length).to.equal(3);
            expect(Number(record.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.docpagvc[1].VALOR)).to.equal(250.02);
            expect(Number(record.docpagvc[2].VALOR)).to.equal(10);
            done();
          })
          .catch(logError(done));
      });
      it('should not accept a update joão without classe cliente and with Suframa', function(done) {
        cadAtivo
          .update({
            Suframa: 'not allow',
            fornecedor: {
              SIGLAFOR: 'Sigla',
              NUMERO: '99'
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          }, {where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function() {
            done(new Error('Saved invalid record'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(2);
            var classes, suframa;
            error.errors.forEach(function(detail) {
              if (detail.path === 'Classes') {
                classes = true
              } else if (detail.path === 'Teste de promise') {
                suframa = true
              }
            });
            expect(classes).to.equal(true);
            expect(suframa).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('check if the joao vctos array generate is equivalent to the external table', function(done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(3);
            done();
          })
          .catch(logError(done));
      });
      it('finally lets try delete Joao without timestamp', function(done) {
        cadAtivo
          .destroy(joao.id)
          .then(function() {
            done(new Error('Invalid delete'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            error.should.have.property('message');
            expect(error.type).to.equal('RecordModifiedOrDeleted');
            done();
          })
          .catch(logError(done));
      });
      it('lets try again with timestamp to delete Joao', function(done) {
        cadAtivo
          .destroy({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function() {
            done(new Error('Invalid delete'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('COMPLEMENTO');
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('so lets cleanup COMPLEMENTO and modify NOMECAD', function(done) {
        joao.NOMECAD = 'Outro João';
        joao.COMPLEMENTO = null;
        cadAtivo
          .update(joao, {where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function() {
            done(new Error('Invalid update'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('NOMECAD');
            done();
          })
          .catch(logError(done));
      });
      it('so lets cleanup only COMPLEMENTO', function(done) {
        joao.NOMECAD = 'João';
        joao.COMPLEMENTO = null;
        cadAtivo
          .update(joao, {where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function(record) {
            joao = record;
            expect(joao.COMPLEMENTO).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });
      it('and check COMPLEMENTO', function(done) {
        cadAtivo
          .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = recordset[0];
            expect(record.COMPLEMENTO).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });
      it('should not save a smaller valor in vctos', function(done) {
        joao.docpagvc[0].VALOR = 350;
        cadAtivo
          .update(joao)
          .then(function() {
            done(new Error('Invalid update'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('ValidationError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Only greater or equal');
            done();
          })
          .catch(logError(done));
      });
      it('should delete joao vctos', function(done) {
        joao.docpagvc = null;
        cadAtivo
          .update(joao)
          .then(function(record) {
            record.should.not.have.property('docpagvc');
            done();
          })
          .catch(logError(done));
      });
      it('lets check joao vctos', function(done) {
        cadAtivo
          .fetch({where: {id: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = joao = recordset[0];
            record.should.not.have.property('docpagvc');
            done();
          })
          .catch(logError(done));
      });
      it('lets try a update without parameters', function(done) {
        cadAtivo
          .update({NOMECAD: 'joao'})
          .then(function() {
            done(new Error('Invalid destroy'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidArgument');
            expect(error.message.indexOf('need a primary key') !== -1).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('lets try a update without where', function(done) {
        cadAtivo
          .update({NOMECAD: 'joao'}, {})
          .then(function() {
            done(new Error('Invalid destroy'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidArgument');
            expect(error.message.indexOf('Where clause not defined') !== -1).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('lets try a delete without parameters', function(done) {
        cadAtivo
          .destroy()
          .then(function() {
            done(new Error('Invalid destroy'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidArgument');
            expect(error.message.indexOf('need a primary key') !== -1).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('lets try a delete without where', function(done) {
        cadAtivo
          .destroy({})
          .then(function() {
            done(new Error('Invalid destroy'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidArgument');
            expect(error.message.indexOf('Where clause not defined') !== -1).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('then lets delete Joao', function(done) {
        cadAtivo
          .destroy({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function(record) {
            expect(record).to.equal(undefined);
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('check if the joao vctos array external table was deleted', function(done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('confirm Joana data after create', function(done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = joana = recordset[0];
            record.should.have.property('destino');
            expect(record.destino.length).to.equal(2);
            record.should.have.property('outroDestino');
            record.outroDestino[0].NOMECAD.should.equal('Gilda');
            record.outroDestino[0].IDENT.should.equal('Jessica');
            record.should.have.property('updatedAt');
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should update Joana to be a client', function(done) {
        cadAtivo
          .update(_.extend({
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          }, joana), joana.id)
          .then(function(record) {
            joana = record;
            record.should.have.property('destino');
            expect(record.destino.length).to.equal(2);
            Number(record.destino[0].NUMLANORI).should.equal(record.id);
            Number(record.destino[1].NUMLANORI).should.equal(record.id);
            record.should.have.property('outroDestino');
            record.outroDestino[0].NOMECAD.should.equal('Gilda');
            record.outroDestino[0].IDENT.should.equal('Jessica');
            Number(record.outroDestino[0].FKOUTRO).should.equal(record.id);
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(1);
            expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
            record.should.have.property('updatedAt');

            record.cliente.should.not.have.property('DATMAIA');

            expect(record.afterCreate).to.be.undefined;
            expect(record.afterUpdate).to.equal('true');
            expect(record.afterPromise).to.equal('true');
            done();
          })
          .catch(logError(done));
      });
      it('confirm Joana data after update', function(done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = joana = recordset[0];
            record.should.have.property('destino');
            expect(record.destino.length).to.equal(2);
            record.should.have.property('outroDestino');
            record.outroDestino[0].NOMECAD.should.equal('Gilda');
            record.outroDestino[0].IDENT.should.equal('Jessica');
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(1);
            expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
            record.should.have.property('updatedAt');
            record.cliente.should.not.have.property('DATMAIA');
            done();
          })
          .catch(logError(done));
      });
      it('should update Geralda to be a client', function(done) {
        cadAtivo
          .update(_.extend({
            ClassificaçãoCad: [
              {
                Classe: 'Cliente'
              },
              {
                Classe: 'Outra'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla',
              DATMAIA: '2015-02-02'
            }
          }, geralda), geralda.id)
          .then(function(record) {
            geralda = record;
            record.should.have.property('maisOutroDestino');
            record.maisOutroDestino.NOMECAD.should.equal('Gilda');
            record.maisOutroDestino.IDENT.should.equal('Jessica');
            record.maisOutroDestino.NUMLANORI2.should.equal(record.id);
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(2);
            expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
            record.should.have.property('updatedAt');
            expect(record.cliente.DATMAIA).to.be.a('string');
            expect(record.cliente.DATMAIA).to.equal('2015-02-02');
            expect(record.afterUpdate).to.equal('true');
            expect(record.afterPromise).to.equal('true');

            record.should.not.have.property('DATNASC');

            done();
          })
          .catch(logError(done));
      });
    });

    describe('preventing delete', function() {
      it('should create a new cadastro', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Mariana',
            NUMERO: '1',
            FAX: '3133717171',
            CELULAR: '3133717171',
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function(record) {
            mariana = record;
            done();
          })
          .catch(logError(done));
      });
      it('cannot be deleted', function(done) {
        cadAtivo
          .destroy({where: {id: mariana.id, updatedAt: mariana.updatedAt}})
          .catch(function(error) {
            expect(error.type).to.equal('beforeDeleteHookError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Fax');
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
    });

    describe('checking methods', function() {
      it('joana should have quitar after fetch', function(done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            joana = recordset[0];
            expect(joana.quitar).to.be.a('function');
            joana.quitar();
            expect(joana.quitado).to.equal('S');
            expect(joana.ClassificaçãoCad[0].quitar).to.be.a('function');
            joana.ClassificaçãoCad[0].quitar();
            expect(joana.ClassificaçãoCad[0].quitado).to.equal('S');
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('mariana should have quitar after create', function(done) {
        expect(mariana.quitar).to.be.a('function');
        mariana.quitar();
        expect(mariana.quitado).to.equal('S');
        expect(mariana.ClassificaçãoCad[0].quitar).to.be.a('function');
        mariana.ClassificaçãoCad[0].quitar();
        expect(mariana.ClassificaçãoCad[0].quitado).to.equal('S');
        done();
      });
      it('geralda should have quitar after update', function(done) {
        expect(geralda.quitar).to.be.a('function');
        geralda.quitar();
        expect(geralda.quitado).to.equal('S');
        expect(geralda.ClassificaçãoCad[0].quitar).to.be.a('function');
        expect(geralda.ClassificaçãoCad[0].quitado).to.equal(undefined);
        geralda.ClassificaçãoCad[0].quitar();
        expect(geralda.ClassificaçãoCad[0].quitado).to.equal('S');
        expect(geralda.ClassificaçãoCad[1].quitar).to.be.a('function');
        expect(geralda.ClassificaçãoCad[1].quitado).to.equal(undefined);
        expect(geralda.cliente.quitar).to.equal(undefined);
        expect(geralda.cliente.quitado).to.equal(undefined);
        expect(geralda.destino.quitar).to.equal(undefined);
        expect(geralda.destino.quitado).to.equal(undefined);
        expect(geralda.maisOutroDestino.quitar).to.equal(undefined);
        expect(geralda.maisOutroDestino.quitado).to.equal(undefined);
        done();
      });
    });

    describe('joana deletion', function() {
      it('then lets delete Joana', function(done) {
        cadAtivo
          .destroy({where: {id: joana.id, updatedAt: joana.updatedAt}})
          .then(function(record) {
            expect(record).to.equal(undefined);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('so Joana does not exists', function(done) {
        tableCadastro
          .fetch({where: {id: joana.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('neither Maria...', function(done) {
        tableCadastro
          .fetch({where: {id: joana.destino[0].id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('...Maria 2...', function(done) {
        tableCadastro
          .fetch({where: {id: joana.destino[1].id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('...or Gilda', function(done) {
        tableCadastro
          .fetch({where: {id: joana.outroDestino[0].id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
    });

    describe('scope handling', function() {
      it('update Geralda to be out of scope', function(done) {
        cadAtivo
          .update({Inativo: 'Sim', updatedAt: geralda.updatedAt}, geralda.id)
          .then(function(record) {
            geralda = record;
            record.should.have.property('maisOutroDestino');
            record.maisOutroDestino.NOMECAD.should.equal('Gilda');
            record.maisOutroDestino.IDENT.should.equal('Jessica');
            Number(record.maisOutroDestino.NUMLANORI2).should.equal(record.id);
            record.should.have.property('cliente');
            expect(record.cliente.SIGLACLI).to.equal('Sigla');
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad.length).to.equal(2);
            expect(record.ClassificaçãoCad[0].Classe).to.equal('Cliente');
            record.should.have.property('updatedAt');
            expect(record.cliente.DATMAIA).to.be.a('string');
            expect(record.cliente.DATMAIA).to.equal('2015-02-02');
            expect(record.afterUpdate).to.equal('true');
            expect(record.afterPromise).to.equal('true');
            done();
          })
          .catch(logError(done));
      });
      it('then geralda disappears, cant be found...', function(done) {
        cadAtivo
          .fetch({where: {id: geralda.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
      it('geralda cant be updated', function(done) {
        cadAtivo
          .update({Inativo: 'N', updatedAt: geralda.updatedAt}, geralda.id)
          .then(function(record) {
            done(new Error('Invalid update'));
          })
          .catch(function(error) {
            expect(error.type).to.equal('RecordModifiedOrDeleted');
            expect(error.errors).to.equal(undefined);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('and geralda cant be deleted', function(done) {
        cadAtivo
          .destroy({where: {id: geralda.id, updatedAt: geralda.updatedAt}})
          .then(function(record) {
            done(new Error('Invalid delete'));
          })
          .catch(function(error) {
            expect(error.type).to.equal('RecordModifiedOrDeleted');
            expect(error.errors).to.equal(undefined);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('but geralda still exists', function(done) {
        tableCadastro
          .fetch({where: {id: geralda.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var geralda = recordset[0];
            expect(geralda.Inativo).to.equal('Sim');
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
    });

    describe('inner level check', function() {
      it('should accept a new fornecedor with two vctos', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'mario with two vctos',
            NUMERO: '5555',
            fornecedor: {
              SIGLAFOR: 'Two vcts',
              NUMERO: '99',
              docpagvc: [{
                VALOR: 350.01,
                DATAVENC: '2015-08-23'
              },
                {
                  VALOR: 250.02,
                  DATAVENC: '2015-09-23'
                }]
            },
            ClassificaçãoCad: [
              {
                "Classe": 'Fornecedor'
              }
            ]
          })
          .then(function(record) {
            mario = record;
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            done();
          })
          .catch(logError(done))
      });
      it('lets check mario, the new fornecedor with two vctos', function(done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = mario = recordset[0];
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('add more one vcto to mario', function(done) {
        mario.fornecedor.docpagvc.push({VALOR: 10.99, DATAVENC: '2015-09-24'});
        mario.fornecedor.NUMERO = '99'; // NUMERO is only for tests purposes
        cadAtivo
          .update(mario, mario.id)
          .then(function(record) {
            mario = record;
            record.should.have.property('fornecedor');
            record.fornecedor.should.have.property('docpagvc');
            record.should.not.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(3);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(Number(record.fornecedor.docpagvc[2].VALOR)).to.equal(10.99);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('lets check mario, the new fornecedor with three vctos', function(done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = mario = recordset[0];
            record.should.have.property('fornecedor');
            record.fornecedor.should.have.property('docpagvc');
            record.should.not.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(3);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(Number(record.fornecedor.docpagvc[2].VALOR)).to.equal(10.99);
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('remove the first vcto from mario', function(done) {
        mario.fornecedor.docpagvc.shift();
        mario.fornecedor.NUMERO = '99'; // NUMERO is only for tests purposes
        cadAtivo
          .update(mario, mario.id)
          .then(function(record) {
            mario = record;
            record.should.have.property('fornecedor');
            record.fornecedor.should.have.property('docpagvc');
            record.should.not.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(250.02);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(10.99);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('lets check mario, the new fornecedor with two vctos again', function(done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = mario = recordset[0];
            record.should.have.property('fornecedor');
            record.fornecedor.should.have.property('docpagvc');
            record.should.not.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(250.02);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(10.99);
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('then lets delete mario', function(done) {
        cadAtivo
          .destroy({where: {id: mario.id, updatedAt: mario.updatedAt}})
          .then(function(record) {
            expect(record).to.equal(undefined);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('so mario does not exists', function(done) {
        tableCadastro
          .fetch({where: {id: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('nor mario fornecedor record', function(done) {
        tableFornec
          .fetch({where: {id: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(logError(done));
      });
      it('nor any mario fornecedor docpgavc record', function(done) {
        tableDocpagvc
          .fetch({where: {FORNEC: mario.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
    });

    describe('mutation on the third level', function() {
      before(function() {
        cadAtivo.fornecedor.docpagvc.hasOne('EVENTO as categoria', EVENTO);
      });
      it('should accept a new fornecedor with two vctos with on event each', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Lidia with two vctos one event each',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [{
                VALOR: 350.01,
                DATAVENC: '2015-08-23',
                categoria: {
                  id: '111',
                  DESCEVENTO: 'Category 111'
                }
              },
                {
                  VALOR: 250.02,
                  DATAVENC: '2015-09-23',
                  categoria: {
                    id: '222',
                    DESCEVENTO: 'Category 222'
                  }
                }]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function(record) {
            lidia = record;
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            record.fornecedor.docpagvc[0].should.have.property('categoria');
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('111');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('lets check lidia, the new fornecedor with two vctos and events', function(done) {
        cadAtivo
          .fetch({where: {id: lidia.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = recordset[0];
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            record.fornecedor.docpagvc[0].should.have.property('categoria');
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('111');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('then lets delete lidia', function(done) {
        cadAtivo
          .destroy({where: {id: lidia.id, updatedAt: lidia.updatedAt}})
          .then(function(record) {
            expect(record).to.equal(undefined);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('so lidia does not exists', function(done) {
        tableCadastro
          .fetch({where: {id: lidia.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('nor lidia fornecedor record', function(done) {
        tableFornec
          .fetch({where: {id: lidia.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('nor any lidia fornecedor docpgavc record', function(done) {
        tableDocpagvc
          .fetch({where: {FORNEC: lidia.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('nor any lidia fornecedor docpgavc event record', function(done) {
        tableEvento
          .fetch({where: {VCTO: lidia.fornecedor.docpagvc[0].id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            tableEvento
              .fetch({where: {VCTO: lidia.fornecedor.docpagvc[1].id}})
              .then(function(recordset) {
                expect(recordset).to.be.a('array');
                expect(recordset.length).to.equal(0);
                done();
              })
              .catch(function(err) {
                done(err);
              })
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should not accept a new fornecedor with one vcto with and two event each', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Invalid',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [{
                VALOR: 350.01,
                DATAVENC: '2015-08-23',
                categoria: [{
                  id: '111',
                  DESCEVENTO: 'Category 111'
                },
                  {
                    id: '2222',
                    DESCEVENTO: 'Category 222'
                  }]
              }]
            },
            ClassificaçãoCad: [
              {
                "Classe": 'Fornecedor'
              }
            ]
          })
          .then(function() {
            done(new Error('Invalid entity created'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidData');
            expect(error.errors).to.equal(undefined);
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should report a server error', function(done) {
        var command;
        if (cadAtivo.db.dialect === 'mssql') {
          command = 'CREATE TRIGGER reminder ON CADASTRO ' +
            'AFTER INSERT ' +
            'AS ' +
            'IF (SELECT NUMERO FROM INSERTED)=\'INVLD\' RAISERROR (\'INVLD\', 11, 1)';
        } else {
          command = 'CREATE FUNCTION rec_insert() RETURNS trigger ' +
            'AS $rec_insert$ BEGIN ' +
            'IF new."NUMERO" =\'INVLD\' THEN RAISE EXCEPTION \'INVLD\'; END IF; ' +
            'RETURN new; END; ' +
            '$rec_insert$ LANGUAGE plpgsql; ' +
            'CREATE TRIGGER reminder AFTER INSERT ON "CADASTRO" ' +
            'FOR EACH ROW ' +
            'EXECUTE PROCEDURE rec_insert();';
        }
        cadAtivo.db.execute(command)
          .then(function() {
            return cadAtivo
              .create({
                NOMECAD: 'Any',
                NUMERO: 'INVLD'
              })
              .then(function() {
                done(new Error('Invalid record saved'));
              })
              .catch(function(error) {
                expect(error.name === 'RequestError' ||
                  error.name === 'error').to.equal(true);
                expect(error.message).to.equal('INVLD');
                done();
              });
          })
          .catch(logError(done));
      });
      it('then lets recreate lidia as the first time', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Lidia with two vctos one event each',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [{
                VALOR: 350.01,
                DATAVENC: '2015-08-23',
                categoria: {
                  id: '111',
                  DESCEVENTO: 'Category 111'
                }
              }, {
                VALOR: 250.02,
                DATAVENC: '2015-09-23',
                categoria: {
                  id: '222',
                  DESCEVENTO: 'Category 222'
                }
              }]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function(record) {
            lidia = record;
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            record.fornecedor.docpagvc[0].should.have.property('categoria');
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('111');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(logError(done));
      });
      it('should not accept to update lidia with one vcto with and two event each', function(done) {
        lidia.fornecedor.NUMERO = '99';
        lidia.fornecedor.docpagvc[0].categoria = [{
          id: '333',
          DESCEVENTO: 'Category 333'
        }, {
          id: '444',
          DESCEVENTO: 'Category 444'
        }];
        cadAtivo
          .update(lidia, {where: {id: lidia.id, updatedAt: lidia.updatedAt}})
          .then(function() {
            done(new Error('Invalid entity update'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidData');
            expect(error.errors).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });
      it('should now accept to update lidia with one vcto with one event', function(done) {
        lidia.fornecedor.NUMERO = '99';
        lidia.fornecedor.docpagvc[0].categoria = [{
          id: '333',
          DESCEVENTO: 'Category 333'
        }];
        cadAtivo
          .update(lidia, {where: {id: lidia.id, updatedAt: lidia.updatedAt}})
          .then(function(record) {
            lidia = record;
            record.should.have.property('fornecedor');
            record.should.not.have.property('docpagvc');
            record.fornecedor.should.have.property('docpagvc');
            expect(record.fornecedor.docpagvc.length).to.equal(2);
            record.fornecedor.docpagvc[0].should.have.property('categoria');
            expect(Number(record.fornecedor.docpagvc[0].VALOR)).to.equal(350.01);
            expect(Number(record.fornecedor.docpagvc[1].VALOR)).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('333');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(logError(done));
      });
      it('and then category 111 does not exists any longer', function(done) {
        tableEvento
          .fetch({where: {id: '111'}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(0);
            done();
          })
          .catch(logError(done));
      });
    });

    describe('using the instance', function() {
      before(function(done) {
        cadAtivo.fornecedor.docpagvc.categoria.validate(
          'do not alter id', function(was) {
            if (was && this.id !== was.id) {
              throw new Error('id cannot be modified');
            }
          }
        );
        done();
      });
      it('should not be valid due to missing FORNECEDOR=99', function(done) {
        lidia.fornecedor.NUMERO = null;
        lidia.validate()
          .then(function() {
            done(new Error('Validated invalid instance'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('Only in fornecedor');
            done();
          })
          .catch(logError(done));
      });
      it('should be valid due to property FORNECEDOR=99', function(done) {
        lidia.fornecedor.NUMERO = '99';
        lidia.validate()
          .then(function() {
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should not be valid due to categoria cant have id changed', function(done) {
        lidia.fornecedor.docpagvc[0].categoria.id = 'X';
        lidia.fornecedor.docpagvc[0].categoria.validate()
          .then(function() {
            done(new Error('Validated invalid instance'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('do not alter id');
            done();
          })
          .catch(logError(done));
      });
      it('should not be valid too when validating the entity', function(done) {
        lidia.validate()
          .then(function() {
            done(new Error('Validated invalid instance'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.errors).to.be.a('array');
            expect(error.errors.length).to.equal(1);
            expect(error.errors[0].path).to.equal('do not alter id');
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should create a new instance', function() {
        jessica = cadAtivo
          .createInstance({
            NOMECAD: 'Jessica',
            NUMERO: '1'
          });
        jessica.should.have.property('save');
        jessica.should.have.property('destroy');
      });
      it('that cannot be destroyed due to not be saved', function(done) {
        jessica
          .destroy()
          .then(function() {
            done(new Error(('Invalid operation')));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidOperation');
            expect(error.message).to.equal('Instance is new');
            done();
          });
      });
      it('should save to disk', function(done) {
        jessica
          .save()
          .then(function() {
            jessica.should.have.property('id');
            jessica.should.have.property('updatedAt');
            jessica.should.have.property('createdAt');
            jessica.should.have.property('NOMECAD');
            jessica.NOMECAD.should.equal('Jessica');
            done();
          })
          .catch(logError(done));
      });
      it('then be modified and saved again', function(done) {
        jessica.NUMERO = '123';
        var updatedAt = jessica.updatedAt;
        jessica
          .save()
          .then(function() {
            jessica.should.have.property('NUMERO');
            jessica.NUMERO.should.equal('123');
            expect(jessica.updatedAt > updatedAt).to.equal(true);
            done();
          })
          .catch(logError(done));
      });
      it('then can be destroyed', function(done) {
        jessica
          .destroy()
          .then(function() {
            jessica.should.have.property('id');
            jessica.should.not.have.property('updatedAt');
            jessica.should.not.have.property('createdAt');
            done();
          })
          .catch(logError(done));
      });
      it('then cannot be destroyed due to be new again', function(done) {
        jessica
          .destroy()
          .then(function() {
            done(new Error(('Invalid operation')));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidOperation');
            expect(error.message).to.equal('Instance is new');
            done();
          })
          .catch(logError(done));
      });

      describe('without knowing what level it is', function() {
        var lucia;
        var vcto = [];
        before(function(done) {
          lucia = cadAtivo.createInstance({
            NOMECAD: 'Lucia',
            NUMERO: '7',
            docpagvc: [{
              VALOR: 100.01,
              DATAVENC: '2015-08-23'
            }, {
              VALOR: 200.02,
              DATAVENC: '2015-09-23'
            }],
            fornecedor: {
              SIGLAFOR: 'Lucia as fornecedor',
              NUMERO: '99',
              docpagvc: [{
                VALOR: 300.01,
                DATAVENC: '2015-08-23',
                categoria: {
                  id: '111',
                  DESCEVENTO: 'Category 111'
                }
              }, {
                VALOR: 400.02,
                DATAVENC: '2015-09-23'
              }]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          });
          vcto[0] = lucia.docpagvc[0];
          vcto[1] = lucia.docpagvc[1];
          vcto[2] = lucia.fornecedor.docpagvc[0];
          vcto[3] = lucia.fornecedor.docpagvc[1];
          done();
        });
        it('should be saved to disk using any component', function(done) {
          vcto[3]
            .save()
            .then(function() {
              lucia.should.have.property('id');
              lucia.should.have.property('updatedAt');
              lucia.should.have.property('createdAt');
              lucia.should.have.property('NOMECAD');
              lucia.NOMECAD.should.equal('Lucia');
              lucia.should.have.property('docpagvc');
              lucia.should.have.property('fornecedor');
              lucia.fornecedor.should.have.property('docpagvc');
              vcto[3].should.have.property('id');
              var was = lucia.was();
              was.should.have.property('id');
              was.should.have.property('updatedAt');
              was.should.have.property('createdAt');
              was.should.have.property('NOMECAD');
              was.NOMECAD.should.equal('Lucia');
              was.should.have.property('docpagvc');
              was.should.have.property('fornecedor');
              was.fornecedor.should.have.property('docpagvc');
              vcto[3].was().should.have.property('id');
              done();
            })
            .catch(logError(done));
        });
        it('could be saved to disk using any component via entity create', function(done) {
          vcto[3]
            .entity()
            .create({NOMECAD: 'John Doe'})
            .then(function(record) {
              record.should.have.property('id');
              record.should.have.property('updatedAt');
              record.should.have.property('createdAt');
              record.should.have.property('NOMECAD');
              record.NOMECAD.should.equal('John Doe');
              done();
            })
            .catch(logError(done));
        });
        it('could be saved to disk using entiy via entity create', function(done) {
          lucia
            .entity()
            .create({NOMECAD: 'Mary Lou'})
            .then(function(record) {
              record.should.have.property('id');
              record.should.have.property('updatedAt');
              record.should.have.property('createdAt');
              record.should.have.property('NOMECAD');
              record.NOMECAD.should.equal('Mary Lou');
              done();
            })
            .catch(logError(done));
        });
        it('if we push another vcto it should be mutated to instance after save', function(done) {
          var newVcto = {
            VALOR: 500.03,
            DATAVENC: '2015-10-23',
            categoria: {
              id: '777',
              DESCEVENTO: 'Category 777'
            }
          };
          lucia.fornecedor.docpagvc.push(newVcto);
          lucia
            .save()
            .then(function() {
              newVcto.should.have.property('id');
              expect(lucia.fornecedor.docpagvc[2] === newVcto).to.equal(true);
              newVcto.should.have.property('save');
              done();
            })
            .catch(logError(done));
        });
        var jane;
        it('will mutate a plain object to a instance after create', function(done) {
          jane = {
            NOMECAD: 'Jane'
          };
          cadAtivo
            .create(jane)
            .then(function(record) {
              record.should.have.property('id');
              record.should.have.property('save');
              expect(jane).to.equal(record);
              done();
            })
            .catch(logError(done));
        });
      });
    });

    describe('querying', function() {
      var numberOfRecordsToGenerate = 10;
      var minMiliSecsToGenerate = 500;
      it('should create ' + numberOfRecordsToGenerate + ' records in an minimum time', function(done) {
        gutil.log('Is generating ' + numberOfRecordsToGenerate + ' entities...');
        var duration = process.hrtime();
        var promise = Promise.resolve();
        var i = 1;
        _.times(numberOfRecordsToGenerate, function() {
          var order = i++;
          promise = promise.then(function() {
            return cadAtivo
              .create({
                NOMECAD: _.padLeft(String(order), 3, '00'),
                NUMERO: 'QRYTST',
                fornecedor: {
                  SIGLAFOR: 'query test',
                  NUMERO: '99',
                  docpagvc: [{
                    VALOR: 1,
                    DATAVENC: '2015-01-01',
                    categoria: {
                      id: 'CAT1_' + order,
                      DESCEVENTO: 'query test 1'
                    }
                  },
                    {
                      VALOR: 2,
                      DATAVENC: '2015-01-02',
                      categoria: {
                        id: 'CAT2_' + order,
                        DESCEVENTO: 'query test 2'
                      }
                    }]
                },
                ClassificaçãoCad: [
                  {
                    Classe: 'Fornecedor'
                  }
                ]
              });
          });
        });

        promise
          .then(function() {
            duration = process.hrtime(duration);
            duration = (duration[0] * 1000) + (duration[1] / 1000000);
            expect(duration).to.below(minMiliSecsToGenerate);
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });

      it('should read the records', function(done) {
        cadAtivo
          .fetch({where: {NUMERO: 'QRYTST'}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(numberOfRecordsToGenerate);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });

      it('should read the records using like', function(done) {
        cadAtivo
          .fetch({where: {NUMERO: {like: '%YTST'}}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(numberOfRecordsToGenerate);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });

      it('should read the records using or', function(done) {
        cadAtivo
          .fetch({
            where: {
              or: [
                {NUMERO: 'QRYTST'},
                {NOMECAD: 'QUALQUER'}
              ]
            }
          })
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(numberOfRecordsToGenerate);
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });

      it('should read the 3 records in the expected page', function(done) {
        cadAtivo
          .fetch({
            where: {
              NUMERO: 'QRYTST'
            },
            limit: 3,
            skip: 3,
            order: ['NOMECAD']
          })
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(3);
            var i = 4;
            recordset.map(function(record) {
              expect(i++).to.equal(Number(record.NOMECAD));
            });
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });

      it('should fetch all the records', function(done) {
        cadAtivo
          .fetch()
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.above(0);
            done();
          })
          .catch(logError(done));
      });

    });

    describe('using the entity', function() {
      before(function(done) {
        var sv = sqlView(cadAtivo.db.dialect);
        cadAtivo.getExternalData = function() {
          var view = sv.build('Classificação', {limit: 1, select: 'Nome'});
          return this.db.query(view.statement, view.params);
        };
        done();
      });
      it('should return one record with a column', function(done) {
        cadAtivo.getExternalData()
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            recordset[0].should.have.property('Nome');
            done();
          })
          .catch(logError(done));
      });
    });

    describe('null enum and timestamp handling', function() {
      var beth;
      before(function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Beth',
            NUMERO: '10',
            destino: {
              nome: 'any',
              IDENT: 'any',
              NUMERO: '13',
              Inativo: 'Não'
            }
          })
          .then(function(record) {
            beth = record;
            cadAtivo
              .setProperties(function(properties) {
                properties.futureEnum.enum = [
                  'A',
                  'B',
                  'C'
                ];
              });
            cadAtivo
              .destino
              .setProperties(function(properties) {
                properties.futureEnum.enum = [
                  'A',
                  'B',
                  'C'
                ];
              });
            done();
          })
          .catch(logError(done));
      });
      it('should fetch undefined from those later defined enum columns', function(done) {
        cadAtivo
          .fetch({where: {id: beth.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = beth = recordset[0];
            expect(record.futureEnum).to.equal(undefined);
            expect(record.destino).to.be.a('array');
            expect(record.destino.length).to.equal(1);
            expect(record.destino[0].futureEnum).to.equal(undefined);
            done();
          })
          .catch(logError(done));
      });
      it('should update destino all alone', function(done) {
        cadAtivo
          .fetch({where: {id: beth.destino[0].id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = recordset[0];
            record.NUMERO = '14';
            return record
              .save()
              .then(function() {
                expect(record.updatedAt).to.be.a('date');
                return cadAtivo
                  .fetch({where: {id: record.id}})
                  .then(function(recordset) {
                    expect(recordset).to.be.a('array');
                    expect(recordset.length).to.equal(1);
                    expect(recordset[0].NUMERO).to.equal('14');
                    done();
                  });
              });
          })
          .catch(logError(done));
      });
      it('should be saved as a new record if you remove the foreign key', function(done) {
        var destinoId = beth.destino[0].id;
        delete beth.destino[0].NUMLANORI;
        beth.save()
          .then(function() {
            expect(beth.destino[0].id).to.above(destinoId);
            done();
          })
          .catch(logError(done));
      });
      it('should not be saved if you change the the foreign key', function(done) {
        beth.destino[0].NUMLANORI = 0;
        beth.save()
          .then(function() {
            done(new Error('Invalid record saved'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidData');
            expect(error.message).to.contains('does not match primary key');
            done();
          })
          .catch(logError(done));
      });
      it('should not be saved if you remove the id', function(done) {
        beth.destino[0].NUMLANORI = beth.id;
        delete beth.destino[0].id;
        beth.save()
          .then(function() {
            done(new Error('Invalid record saved, you cannot use the primary key presence to verify if a record exists'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('EntityError');
            expect(error.type).to.equal('InvalidData');
            expect(error.message).to.contains('has no previous data');
            done();
          })
          .catch(logError(done));
      });
      it('should delete destino all alone', function(done) {
        delete beth.destino[0].NUMLANORI;
        beth.save()
          .then(function() {
            return cadAtivo
              .fetch({where: {id: beth.destino[0].id}})
              .then(function(recordset) {
                expect(recordset).to.be.a('array');
                expect(recordset.length).to.equal(1);
                var record = recordset[0];
                return record
                  .destroy()
                  .then(function() {
                    record.should.have.property('id');
                    record.should.not.have.property('updatedAt');
                    record.should.not.have.property('createdAt');
                    done();
                  });
              });
          })
          .catch(logError(done));
      });
      it('should throw an error when updating beth with destino already deleted', function(done) {
        beth.save()
          .then(function() {
            done(new Error('Invalid record updated'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('AssertionError');
            expect(error.message).to.contains('One and only one record');
            done();
          })
          .catch(logError(done));
      });
      it('should throw an error when deleting beth with destino already deleted', function(done) {
        beth.destroy()
          .then(function() {
            done(new Error('Invalid record deletion'));
          })
          .catch(function(error) {
            expect(error.name).to.equal('AssertionError');
            expect(error.message).to.contains('One and only one record');
            done();
          })
          .catch(logError(done));
      });
    });

  });

};
