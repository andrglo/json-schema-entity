'use strict';

var chai = require('chai');
var expect = chai.expect;
chai.should();
var _ = require('lodash');
var validator = require('validator');
var brV = require('br-validations');
var gutil = require('gulp-util');

var entity = require('../src');

var CADASTRO = require('./schemas/CADASTRO.json');
var DOCPAGVC = require('./schemas/DOCPAGVC.json');
var FORNEC = require('./schemas/FORNEC.json');
var EVENTO = require('./schemas/EVENTO.json');
var DOCPAGEV = require('./schemas/DOCPAGEV.json');

var log = console.log;

function decimalPlaces(num) {
  var match = ('' + num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) {
    return 0;
  }
  return Math.max(
    0,
    // Number of digits right of decimal point.
    (match[1] ? match[1].length : 0)
      // Adjust for scientific notation.
    - (match[2] ? +match[2] : 0));
}

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
    return value.length >= 9;
  });
  validator.extend('cep', function(value) {
    return value.length === 8;
  });
  validator.extend('decimals', function(value, max) {
    return decimalPlaces(value) <= max;
  });

  validator.extend('ie', function(value, estado) {
    if (value && !brV.ie(estado).validate(value)) {
      throw new Error('Inscrição estadual inválida')
    }
  });
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
      delete CADASTRO.properties.createdAt; //todo its optional in the schema
      delete CADASTRO.properties.updatedAt;
      tableCadastro = entity('CADASTRO', CADASTRO, {db: db}).useTimestamps();
      tableCadastro.validate('TEST', function() {
        if (!this.NUMERO) {
          throw new Error('NUMERO must be informed');
        }
      });
      done();
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
        .catch(function(err) {
          done(err);
        });
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
        .catch(function(err) {
          done(err);
        });
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
        })
    })

  });

  describe('complex entity', function() {

    var cadAtivo;
    var tableCadastro;
    var tableFornec;
    var tableEvento;
    var tableDocpagvc;
    var tableDocpagev;

    var joao;
    var jose;
    var joana;
    var geralda;
    var any;
    var mario;
    var lidia;
    var mariana;

    before(function() {
      addValidations(validator);
      cadAtivo = require('./entities/cadastro.js')({
        db: db,
        validator: validator
      });
      tableCadastro = entity('CADASTRO', CADASTRO, {db: db});
      tableFornec = entity('FORNEC', FORNEC, {db: db});
      tableEvento = entity('EVENTO', EVENTO, {db: db});
      tableDocpagvc = entity('DOCPAGVC', DOCPAGVC, {db: db});
      tableDocpagev = entity('DOCPAGEV', DOCPAGEV, {db: db});
    });

    describe('check structure', function() {
      it('should have property destino', function() {
        var schema = cadAtivo.getSchema();
        schema.properties.should.have.property('destino');
        schema.properties.destino.should.have.property('items');
        schema.properties.destino.items.should.have.property('properties');
        expect(Object.keys(schema.properties.destino.items.properties).length).to.equal(3);
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
        expect(properties.length).to.equal(33);
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
        expect(Object.keys(schema.properties.fornecedor.properties).length).to.equal(60);
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
          })
      })
    });

    describe('create cadastro', function() {
      it('should not create a new cadastro with a partial enum', function(done) {
        var now = new Date(Date.now());
        cadAtivo
          .create({
            NOMECAD: 'João',
            NUMERO: '1',
            COMPLEMENTO: 'Do not exclude',
            TSN: '1'
          })
          .then(function(record) {
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
          })
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
            expect(record.afterCreate).to.be.true;
            expect(record.afterUpdate).to.be.undefined;
            expect(record.afterPromise).to.be.undefined;
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should create a new cadastro with CPF', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            CGCCPF: '18530249100'
          })
          .then(function(record) {
            jose = record;
            record.should.have.property('CGCCPF');
            done();
          })
          .catch(function(err) {
            done(err);
          })
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
          })
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
          .catch(function(err) {
            done(err)
          })
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
            Suframa: 'not allowed'
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
          .catch(function(error) {
            done(error);
          })
      });
      it('should not accept a new cliente without classe cliente and with Suframa and fornecedor with no NUMERO=99', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Falta classe cliente and have suframa',
            NUMERO: '5',
            Suframa: 'not allowed',
            fornecedor: {
              SIGLAFOR: 'Sigla'
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
            expect(error.errors.length).to.equal(3);
            var classes, suframa, fornecedor;
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
            },
              {
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

            record.should.not.have.property('DATNASC');

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
                "Classe": 'Fornecedor'
              },
              {
                "Classe": 'Cliente'
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
          .catch(function(error) {
            done(error);
          })
      });
      it('lets check the new cliente/fornecedor', function(done) {
        cadAtivo
          .fetch({where: {id: any.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(1);
            var record = recordset[0];
            record.should.have.property('ClassificaçãoCad');
            expect(record.ClassificaçãoCad).to.be.a('array');
            record.should.have.property('DATNASC');
            expect(record.DATNASC.toISOString().substr(0, 10)).to.equal('1999-12-31');
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
          .catch(function(error) {
            done(error);
          })
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
            _.extend(entity, {
              ClassificaçãoCad: [
                {
                  Classe: 'Cliente'
                }
              ],
              cliente: {
                SIGLACLI: 'Sigla',
                DATMAIA: '2015-02-02'
              }
            });
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
                expect(record.afterUpdate).to.be.true;
                expect(record.afterPromise).to.be.true;
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
                    expect(record.cliente.DATMAIA).to.be.a('date');
                    expect(record.cliente.DATMAIA.toISOString().substr(0, 10)).to.equal('2015-02-02');
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
            expect(record.docpagvc[0].VALOR).to.equal(700);
            record.should.have.property('VALORLCTO');
            expect(record.VALORLCTO).to.equal(700);
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
            expect(record.docpagvc[0].DATAVENC.toISOString().substr(0, 10)).to.equal('2015-08-23');
            record.docpagvc[0].should.have.property('DATAVENCZ');
            expect(record.docpagvc[0].DATAVENCZ.toISOString()).to.equal('1999-12-31T00:00:00.000Z');
            record.docpagvc[0].should.have.property('DATAVENCNOZ');
            expect(record.docpagvc[0].DATAVENCNOZ.toISOString()).to.equal(new Date('1999-12-31T19:00:00').toISOString());
            done();
          })
          .catch(function(err) {
            done(err);
          })
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
            expect(record.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.docpagvc[1].VALOR).to.equal(250.02);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('add more one vcto', function(done) {
        joao.docpagvc.push({VALOR: 10, DATAVENC: '2015-09-24'});
        cadAtivo
          .update(joao, joao.id)
          .then(function(record) {
            joao = record;
            record.should.have.property('docpagvc');
            expect(record.docpagvc.length).to.equal(3);
            expect(record.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.docpagvc[1].VALOR).to.equal(250.02);
            expect(record.docpagvc[2].VALOR).to.equal(10);
            done();
          })
          .catch(function(err) {
            done(err);
          })
      });
      it('should not accept a update joão without classe cliente and with Suframa', function(done) {
        cadAtivo
          .update({
            Suframa: 'not allowed',
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
          .catch(function(error) {
            done(error);
          })
      });
      it('check if the joao vctos array generate is equivalent to the external table', function(done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function(recordset) {
            expect(recordset).to.be.a('array');
            expect(recordset.length).to.equal(3);
            done();
          })
          .catch(function(err) {
            done(err);
          });
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
          .catch(function(err) {
            done(err);
          })
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
          .catch(function(err) {
            done(err);
          })
      });
      it('so lets cleanup only COMPLEMENTO', function(done) {
        joao.NOMECAD = 'João';
        joao.COMPLEMENTO = null;
        cadAtivo
          .update(joao, {where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function(record) {
            joao = record;
            expect(joao.COMPLEMENTO).to.equal(null);
            done();
          })
          .catch(function(err) {
            done(err);
          })
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
          .catch(function(err) {
            done(err);
          })
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
          .catch(function(err) {
            done(err);
          })
      });
      it('then lets delete Joao', function(done) {
        joao.docpagvc[0].VALOR = 350.01;
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
            expect(record.afterUpdate).to.be.true;
            expect(record.afterPromise).to.be.true;
            done();
          })
          .catch(function(err) {
            done(err);
          })
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
          .catch(function(err) {
            done(err);
          })
      });
      it('should update Geralda to be a client', function(done) {
        cadAtivo
          .update(_.extend({
            ClassificaçãoCad: [
              {
                "Classe": 'Cliente'
              },
              {
                "Classe": 'Outra'
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
            expect(record.afterUpdate).to.be.true;
            expect(record.afterPromise).to.be.true;

            record.should.not.have.property('DATNASC');

            done();
          })
          .catch(function(err) {
            done(err);
          })
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
          .catch(function(err) {
            done(err);
          })
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
            expect(record.cliente.DATMAIA).to.be.a('date');
            expect(record.cliente.DATMAIA.toISOString().substr(0, 10)).to.equal('2015-02-02');
            expect(record.afterUpdate).to.be.true;
            expect(record.afterPromise).to.be.true;
            done();
          })
          .catch(function(err) {
            done(err);
          })
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
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(250.02);
            done();
          })
          .catch(function(error) {
            done(error);
          })
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
          .catch(function(err) {
            done(err);
          })
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
                'Classe': 'Fornecedor'
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
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(250.02);
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
      it('should report a server error due to a long NUMERO', function(done) {
        cadAtivo
          .create({
            NOMECAD: 'Lidia with two vctos one event each',
            NUMERO: 'TOO LONG TO BE SAVE',
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
          .then(function() {
            done(new Error('Invalid record saved'));
          })
          .catch(function(error) {
            expect(error.name === 'RequestError' ||
              error.name === 'error').to.equal(true); // todo The common layer
            expect(error.message.indexOf('invalid data length') !== -1 ||
              error.message.indexOf('value too long for type character') !== -1).to.equal(true);
            done();
          })
          .catch(function(error) {
            done(error);
          });
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
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('111');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(function(error) {
            done(error);
          });
      });
      it('should not accept to update lidia with one vcto with and two event each', function(done) {
        lidia.fornecedor.NUMERO = '99';
        lidia.fornecedor.docpagvc[0].categoria = [{
          id: '333',
          DESCEVENTO: 'Category 333'
        },
          {
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
          .catch(function(error) {
            done(error);
          });
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
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(350.01);
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(250.02);
            expect(record.fornecedor.docpagvc[0].categoria.id).to.equal('333');
            expect(record.fornecedor.docpagvc[1].categoria.id).to.equal('222');
            done();
          })
          .catch(function(error) {
            done(error);
          })
      });
      it('and then category 111 does not exists any longer', function(done) {
        tableEvento
          .fetch({where: {id: '111'}})
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

    describe('using the instance', function() {
      before(function(done) {
        cadAtivo.fornecedor.docpagvc.categoria.validate(
          'do not alter id', function(was) {
            if (was && this.id !== was.id) {
              throw new Error('id cannot be modified')
            }
          }
        );
        done();
      });
      it('should not be valid due to missing FORNECEDOR=99', function(done) {
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
          .catch(function(error) {
            done(error);
          })
      });
      it('should be valid due to property FORNECEDOR=99', function(done) {
        lidia.fornecedor.NUMERO = '99';
        lidia.validate()
          .then(function() {
            done();
          })
          .catch(function(error) {
            done(error);
          })
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
          .catch(function(error) {
            done(error);
          })
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
    });

    describe('querying', function() {
      var numberOfRecordsToGenerate = 10;
      var minMiliSecsToGenerate = 300;
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
            expect(duration < minMiliSecsToGenerate).to.equal(true);
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
            sort: ['NOMECAD']
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

    });

  });

};
