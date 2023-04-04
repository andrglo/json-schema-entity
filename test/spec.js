'use strict'

/* eslint no-undef:0 */

var assert = require('assert')
var chai = require('chai')
var expect = chai.expect
chai.should()
var _ = require('lodash')
var validator = require('validator')
var sqlView = require('sql-view')

var entity = require('../src')

var CADASTRO = require('./schemas/CADASTRO.json')
var DOCPAGVC = require('./schemas/DOCPAGVC.json')
var FORNEC = require('./schemas/FORNEC.json')
var EVENTO = require('./schemas/EVENTO.json')
var DOCPAGEV = require('./schemas/DOCPAGEV.json')
var CLASSE = require('./schemas/Classificação.json')
var ESTADOS = require('./schemas/ESTADOS.json')

var logError = function (done) {
  return function (err) {
    if (err) {
      console.error(err)
    }
    done(err)
  }
}

function addValidations(validator) {
  validator.cpfcnpj = function (value) {
    return (
      value &&
      (value.length === 11 || value.length === 14) &&
      value !== '18530249111'
    )
  }
  validator.cpf = function (value) {
    return value && value.length === 11
  }
  validator.cnpj = function (value) {
    return value && value.length === 14
  }
  validator['br-phone'] = function (value) {
    if (value.length < 9) {
      throw new Error('br-phone must be greater than nine')
    }
  }
  validator.cep = function (value, p1, p2) {
    expect(p1).to.equal('any string')
    expect(p2).to.be.a('array')
    expect(p2.length).to.equal(2)
    expect(p2[0]).to.equal('a')
    expect(p2[1]).to.equal('array')
    return value.length === 8
  }
  validator.ie = function (value, estado) {
    if (value == '1860558000110' && estado === 'SP') {
      throw new Error('Inscrição estadual inválida')
    }
  }
}

module.exports = function (options) {
  var db
  var db2
  const now = new Date()
  describe('single table', function () {
    var start
    var end

    var entityCadastro
    var tableCadastro
    var tableCadastro2
    var joao

    var minNanoSecsToSave = 1000000 // 1 millisecond

    before(function (done) {
      db = options.db
      db2 = options.db2

      const schema = _.cloneDeep(CADASTRO)
      schema.properties.TICADO = {
        title: 'Ticado',
        type: 'string',
        mapper: {
          write: value => (value === true ? 'S' : 'N'),
          read: value => value === 'S'
        }
      }
      entityCadastro = entity('CADASTRO', schema).useTimestamps(
        'test'
      )
      entityCadastro.validate('TEST', function () {
        if (!this.NUMERO) {
          throw new Error('NUMERO must be informed')
        }
      })
      entityCadastro.setDialect(db.dialect)
      tableCadastro = entityCadastro.new(db)
      tableCadastro2 = entityCadastro.new(db2)
      tableCadastro
        .createTables()
        .then(function () {
          return tableCadastro2.createTables().then(function () {
            done()
          })
        })
        .catch(logError(done))
    })

    it('record should not exist', function (done) {
      tableCadastro
        .fetch({where: {id: 8}})
        .then(function (recordset) {
          expect(recordset).to.be.a('array')
          expect(recordset.length).to.equal(0)
          expect(tableCadastro.db).to.equal(db)
          done()
        })
        .catch(function (err) {
          done(err)
        })
    })
    it('record should not exist in db 2', function (done) {
      tableCadastro2
        .fetch({where: {id: 8}})
        .then(function (recordset) {
          expect(recordset).to.be.a('array')
          expect(recordset.length).to.equal(0)
          expect(tableCadastro2.db).to.equal(db2)
          done()
        })
        .catch(function (err) {
          done(err)
        })
    })
    it('record should not be created due validation', function (done) {
      tableCadastro
        .create({
          NOMECAD: 'João'
        })
        .then(function () {
          done(
            new Error('Record with missing NUMERO has been created')
          )
        })
        .catch(function (error) {
          expect(error.name).to.equal('EntityError')
          expect(error.type).to.equal('ValidationError')
          expect(error.errors).to.be.a('array')
          expect(error.errors[0].path).to.equal('TEST')
          done()
        })
        .catch(logError(done))
    })
    it('record should be created', function (done) {
      start = process.hrtime()
      tableCadastro
        .create({
          NOMECAD: 'João',
          NUMERO: '1',
          DATNASC: '1981-12-01',
          Inativo: 'Não',
          TICADO: true
        })
        .then(function (record) {
          end = process.hrtime(start)
          joao = record
          expect(record.id).to.not.equal(undefined)
          expect(record.updatedAt).to.not.equal(undefined)
          expect(record.DATNASC).to.equal('1981-12-01')
          expect(end[1]).above(minNanoSecsToSave)
          expect(record.TICADO).to.equal(true)
          done()
        })
        .catch(function (err) {
          done(err)
        })
    })
    it('record should be created in db2', function (done) {
      start = process.hrtime()
      tableCadastro2
        .create({
          NOMECAD: 'João',
          NUMERO: '1',
          Inativo: 'Não'
        })
        .then(function (record) {
          end = process.hrtime(start)
          expect(record.id).to.not.equal(undefined)
          expect(record.updatedAt).to.not.equal(undefined)
          expect(end[1]).above(minNanoSecsToSave)
          done()
        })
        .catch(function (err) {
          done(err)
        })
    })
    it('then can have only one field updated', function (done) {
      tableCadastro
        .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
        .then(function (recordset) {
          var record = recordset[0]
          expect(record.TICADO).to.equal(true)
          start = process.hrtime()
          return tableCadastro.update(
            {
              IDENT: 'J',
              TipoSimplesNacional: '2 - Optante ME/EPP'
            },
            {where: {id: record.id, updatedAt: record.updatedAt}}
          )
        })
        .then(function (record) {
          expect(record.TICADO).to.equal(true)
          end = process.hrtime(start)
          record.should.have.property('NOMECAD')
          record.should.have.property('IDENT')
          record.should.have.property('NUMERO')
          expect(end[1]).above(minNanoSecsToSave)
          expect(record.updatedAt >= now).to.equal(true)
          expect(record.updatedAt >= joao.updatedAt).to.equal(true)
          joao = record
          done()
        })
        .catch(logError(done))
    })
    it('lets update a mapped field', function (done) {
      tableCadastro
        .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
        .then(function (recordset) {
          var record = recordset[0]
          expect(record.TICADO).to.equal(true)
          return tableCadastro.update(
            {
              TICADO: false
            },
            {where: {id: record.id, updatedAt: record.updatedAt}}
          )
        })
        .then(function (record) {
          expect(record.TICADO).to.equal(false)
          joao = record
          done()
        })
        .catch(logError(done))
    })
    it('lets fetch a mapped field returning a plain object', function (done) {
      tableCadastro
        .fetch(
          {where: {id: joao.id, updatedAt: joao.updatedAt}},
          {toPlainObject: true}
        )
        .then(function (recordset) {
          var record = recordset[0]
          expect(record.TICADO).to.equal(false)
          done()
        })
        .catch(logError(done))
    })
    it('and can be deleted', function (done) {
      start = process.hrtime()
      tableCadastro
        .destroy({where: {id: joao.id, updatedAt: joao.updatedAt}})
        .then(function (res) {
          end = process.hrtime(start)
          expect(end[1]).above(minNanoSecsToSave)
          expect(res).to.equal(undefined)
          done()
        })
        .catch(function (err) {
          done(err)
        })
    })
  })

  describe('complex entity', function () {
    var entityCadAtivo
    var cadAtivo
    var tableCadastro
    var tableFornec
    var tableEvento
    var tableDocpagvc
    var tableDocpagev
    var tableEstados

    var joao
    var joana
    var geralda
    var any
    var mario
    var lidia
    var mariana
    var jessica

    before(function (done) {
      addValidations(validator)

      var classificacao = entity('Classificação', CLASSE, {
        dialect: db.dialect
      })
      var docpagev = entity('DOCPAGEV', DOCPAGEV, {
        dialect: db.dialect
      })
      entityCadAtivo = require('./entities/cadastro.js')({
        dialect: db.dialect,
        validator: validator,
        classificacao,
        docpagev
      })
      cadAtivo = entityCadAtivo.new(db)
      classificacao = classificacao.new(db)
      docpagev = docpagev.new(db)
      cadAtivo
        .createTables()
        .then(function () {
          return cadAtivo.syncTables()
        })
        .then(function () {
          tableEvento = entity('EVENTO', EVENTO, {
            dialect: db.dialect
          }).new(db)
          return tableEvento.createTables()
        })
        .then(function () {
          tableCadastro = entity('CADASTRO', CADASTRO, {
            dialect: db.dialect
          }).new(db)
          return tableCadastro.syncTables()
        })
        .then(function () {
          tableFornec = entity('FORNEC', FORNEC, {
            dialect: db.dialect
          }).new(db)
          return tableFornec.syncTables()
        })
        .then(function () {
          tableDocpagvc = entity('DOCPAGVC', DOCPAGVC, {
            dialect: db.dialect
          }).new(db)
          return tableDocpagvc.syncTables()
        })
        .then(function () {
          tableDocpagev = entity('DOCPAGEV', DOCPAGEV, {
            dialect: db.dialect
          }).new(db)
          return tableDocpagev.createTables()
        })
        .then(function () {
          tableEstados = entity('ESTADOS', ESTADOS, {
            dialect: db.dialect
          }).new(db)
          return tableEstados.createTables()
        })
        .then(function () {
          return docpagev.syncTables()
        })
        .then(function () {
          return classificacao.createTables()
        })
        .then(function () {
          done()
        })
        .catch(logError(done))
    })

    describe('check structure', function () {
      it('should not accept a invalid db layer', function () {
        try {
          entity('CADASTRO', CADASTRO, {
            dialect: 'mysql'
          }).useTimestamps()
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid entity created')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal(
            'Adapter for this conector is not implemented'
          )
        }
      })
      it('should have a primary key', function () {
        var primaryKey = entityCadAtivo.schema.primaryKey()
        expect(primaryKey).to.be.a('array')
        expect(primaryKey).to.eql(['id'])
      })
      it('should have 6 tables', function () {
        var tables = entityCadAtivo.schema.tables()
        expect(tables).to.be.a('object')
        var keys = Object.keys(tables)
        expect(keys).to.be.a('array')
        expect(keys).to.eql([
          'CADASTRO',
          'FORNEC',
          'DOCPAGVC',
          'CLIENTE',
          'empty',
          'ClassificaçãoCad'
        ])
      })
      it('should have property destino', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('destino')
        schema.properties.destino.should.have.property('items')
        schema.properties.destino.items.should.have.property(
          'properties'
        )
        expect(
          Object.keys(schema.properties.destino.items.properties)
            .length
        ).to.equal(5)
      })
      it('should have property outroDestino', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('outroDestino')
        schema.properties.outroDestino.should.have.property('items')
        schema.properties.outroDestino.items.should.have.property(
          'properties'
        )
        expect(
          Object.keys(schema.properties.outroDestino.items.properties)
            .length
        ).to.equal(3)
      })
      it('should have a customized title for property TipoSimplesNacional', function () {
        var schema = entityCadAtivo.schema.get()
        var properties = Object.keys(schema.properties)
        expect(properties.length).to.equal(39)
        expect(properties.indexOf('FAX')).to.equal(-1)
        expect(properties.indexOf('IM')).to.above(-1)
        expect(properties.indexOf('TSN')).to.above(-1)
        expect(schema.properties.TSN.title).to.equal('TSN')
      })
      it('should have property fornecedor', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('fornecedor')
        schema.properties.fornecedor.should.have.property('type')
        schema.properties.fornecedor.type.should.equal('object')
        schema.properties.fornecedor.should.have.property(
          'properties'
        )
        expect(
          Object.keys(schema.properties.fornecedor.properties).length
        ).to.equal(61)
      })
      it('should have property cliente', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('cliente')
        schema.properties.cliente.should.have.property('type')
        schema.properties.cliente.type.should.equal('object')
        schema.properties.cliente.should.have.property('properties')
        schema.properties.cliente.properties.should.not.have.property(
          'ENDCOB'
        )
        schema.properties.cliente.properties.should.not.have.property(
          'NUMCOMPP'
        )
        schema.properties.cliente.properties.should.have.property(
          'Número de compras a prazo'
        )
        schema.properties.cliente.properties.should.have.property(
          'RAMO'
        )
        schema.properties.cliente.properties.RAMO.title.should.equal(
          'Ramo de atuação'
        )
        expect(
          Object.keys(schema.properties.cliente.properties).length
        ).to.equal(66)
      })
      it('should have property classificacaocad', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('ClassificaçãoCad')
        schema.properties.ClassificaçãoCad.should.have.property(
          'items'
        )
        schema.properties.ClassificaçãoCad.items.should.have.property(
          'properties'
        )
        expect(
          Object.keys(
            schema.properties.ClassificaçãoCad.items.properties
          ).length
        ).to.equal(2)
      })
      it('should have property docpagvc', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('docpagvc')
        schema.properties.docpagvc.should.have.property('items')
        schema.properties.docpagvc.items.should.have.property(
          'properties'
        )
        expect(
          Object.keys(schema.properties.docpagvc.items.properties)
            .length
        ).to.equal(7)
      })
      it('should have property docpagvc in fornecedor', function () {
        var schema = entityCadAtivo.schema.get()
        schema.properties.should.have.property('fornecedor')
        schema.properties.fornecedor.properties.should.have.property(
          'docpagvc'
        )
        schema.properties.fornecedor.properties.docpagvc.should.have.property(
          'items'
        )
        // eslint-disable-next-line max-len
        schema.properties.fornecedor.properties.docpagvc.items.should.have.property(
          'properties'
        )
        expect(
          Object.keys(
            schema.properties.fornecedor.properties.docpagvc.items
              .properties
          ).length
        ).to.equal(5)
      })
      it('should not have entity methods in association', function () {
        entityCadAtivo.fornecedor.should.not.have.property('fetch')
        entityCadAtivo.fornecedor.should.not.have.property('setScope')
        entityCadAtivo.fornecedor.should.not.have.property(
          'getSchema'
        )
        entityCadAtivo.fornecedor.should.not.have.property('create')
        entityCadAtivo.fornecedor.should.not.have.property('update')
        entityCadAtivo.fornecedor.should.not.have.property('destroy')
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'fetch'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'setScope'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'getSchema'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'create'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'update'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'destroy'
        )
      })
      it('should not have entity class methods', function () {
        cadAtivo.should.not.have.property('entityMethod')
        cadAtivo.should.not.have.property('instanceMethod')
        cadAtivo.should.not.have.property('validate')
        cadAtivo.should.not.have.property('hasOne')
        cadAtivo.should.not.have.property('hasMany')
        cadAtivo.should.not.have.property('setTitle')
        cadAtivo.should.not.have.property('setDescription')
        cadAtivo.should.not.have.property('setProperties')
        cadAtivo.should.not.have.property('setScope')
        cadAtivo.should.not.have.property('foreignKey')
      })
      it('entity cadAtivo should not have entity methods', function () {
        entityCadAtivo.should.not.have.property('db')
        entityCadAtivo.should.not.have.property('adapter')
        entityCadAtivo.should.not.have.property('fetch')
        entityCadAtivo.should.not.have.property('create')
        entityCadAtivo.should.not.have.property('update')
        entityCadAtivo.should.not.have.property('destroy')
        entityCadAtivo.should.not.have.property('createInstance')
        entityCadAtivo.should.not.have.property('createTables')
        entityCadAtivo.should.not.have.property('syncTables')
        entityCadAtivo.fornecedor.should.not.have.property('db')
        entityCadAtivo.fornecedor.should.not.have.property('adapter')
        entityCadAtivo.fornecedor.should.not.have.property('fetch')
        entityCadAtivo.fornecedor.should.not.have.property('create')
        entityCadAtivo.fornecedor.should.not.have.property('update')
        entityCadAtivo.fornecedor.should.not.have.property('destroy')
        entityCadAtivo.fornecedor.should.not.have.property(
          'createInstance'
        )
        entityCadAtivo.fornecedor.should.not.have.property(
          'createTables'
        )
        entityCadAtivo.fornecedor.should.not.have.property(
          'syncTable'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'db'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'adapter'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'fetch'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'create'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'update'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'destroy'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'createInstance'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'createTables'
        )
        entityCadAtivo.fornecedor.docpagvc.should.not.have.property(
          'syncTable'
        )
      })
    })

    describe('Instance structure', function () {
      var expectedEnumerableKeys = [
        'id',
        'NOMECAD',
        'IDENT',
        'CGCCPF',
        'INSCEST',
        'DATNASC',
        'DATNASCZ',
        'DATNASCNOZ',
        'ENDERECO',
        'NUMERO',
        'COMPLEMENTO',
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
        'quitado',
        'TSN',
        'IM',
        'destino',
        'outroDestino',
        'maisOutroDestino',
        'fornecedor',
        'cliente',
        'empty',
        'ClassificaçãoCad',
        'docpagvc',
        'updatedAt'
      ]
      var expectedInstanceMethods = [
        'constructor',
        'entity',
        'validate',
        'save',
        'destroy',
        'was',
        'db'
      ]
      var enumerableKeys
      var allKeys
      var symbols
      var instanceMethods
      var emptyInstance
      it('should create an empty new instance with no parameters', function () {
        emptyInstance = cadAtivo.createInstance()
        enumerableKeys = Object.keys(emptyInstance)
        allKeys = Object.getOwnPropertyNames(emptyInstance)
        symbols = Object.getOwnPropertySymbols(emptyInstance)
        instanceMethods = Object.getOwnPropertyNames(
          Object.getPrototypeOf(emptyInstance)
        )
        expect(expectedEnumerableKeys).to.eql(enumerableKeys)
      })
      it('should not accept an invalid CEP value in that instance', function (done) {
        try {
          emptyInstance.CEP = '30170'
          done(new Error('Invalid CEP value accepted in instance'))
        } catch (e) {
          expect(e.message).to.equal(
            "Validation for 'CEP' failed: cep"
          )
          done()
        }
      })
      it('should accept an valid CEP value in that instance', function () {
        emptyInstance.CEP = '30170912'
      })
      it('should not accept an invalid INSCEST value in that instance', function (done) {
        try {
          emptyInstance.ESTADO = 'SP'
          emptyInstance.INSCEST = '1860558000110'
          done(
            new Error('Invalid INSCEST value accepted in instance')
          )
        } catch (e) {
          expect(e.message).to.equal('Inscrição estadual inválida')
          done()
        }
      })
      it('should accept an valid INSCEST value in that instance', function () {
        emptyInstance.ESTADO = 'MG'
        emptyInstance.INSCEST = '0620504710493'
      })
      describe('The empty instance', function () {
        it('Should have an instance method in an extra non enumerable property', function () {
          expect(allKeys.length).to.equal(enumerableKeys.length + 1)
        })
        it('Should have no symbol properties', function () {
          expect(symbols.length).to.equal(0)
        })
        it('Should have six instance (prototypes) methods', function () {
          expect(instanceMethods).to.eql(expectedInstanceMethods)
        })
      })
      describe('The reserved words', function () {
        it('Should not use instance method name for a column', function () {
          try {
            entityCadAtivo.setProperties(function (properties) {
              properties.save = {
                type: 'string',
                maxLength: 1
              }
            })
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Invalid property modification')
          } catch (error) {
            error.should.have.property('message')
            expect(error.message).to.contains(
              'Property save cannot have this name, it is a reserved word, use an alias'
            )
            entityCadAtivo.setProperties(function (properties) {
              delete properties.save
            })
          }
        })
        it('Should not use a timestamp column name for a column', function () {
          try {
            entityCadAtivo.setProperties(function (properties) {
              properties.updatedAt = {
                type: 'string',
                maxLength: 1
              }
            })
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Invalid property modification')
          } catch (error) {
            error.should.have.property('message')
            expect(error.message).to.contains(
              'Properties cannot have timestamp name updatedAt, use an alias'
            )
            entityCadAtivo.setProperties(function (properties) {
              delete properties.updatedAt
            })
          }
        })
      })
    })

    describe('get cadastro id 8', function () {
      it('should not exist', function (done) {
        cadAtivo
          .fetch({where: {id: 8}})
          .then(function (cadastro) {
            expect(cadastro).to.be.a('array')
            expect(cadastro.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
    })

    describe('create cadastro', function () {
      it('should not create a new cadastro with a partial invalid enum', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'João',
            NUMERO: '1',
            COMPLEMENTO: 'Do not exclude',
            TSN: '2 - Optante'
          })
          .then(function () {
            done(new Error('Invalid record created'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('TSN')
            error.should.have.property('message')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should create a new cadastro', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'João',
            NUMERO: '1',
            COMPLEMENTO: 'Do not exclude'
          })
          .then(function (record) {
            joao = record
            expect(record.id).to.not.equal(undefined)
            expect(record.updatedAt).to.not.equal(undefined)
            record.should.have.property('Inativo')
            expect(record.Inativo).to.equal('Não')
            expect(record.afterCreate).to.equal('true')
            expect(record.afterUpdate).to.be.undefined
            expect(record.afterPromise).to.be.undefined
            done()
          })
          .catch(logError(done))
      })
      it('should not create a new cadastro with wrong CPF', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            CGCCPF: '18530249111'
          })
          .then(function () {
            done(new Error('Invalid record created'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('CGCCPF')
            error.should.have.property('message')
            done()
          })
          .catch(logError(done))
      })
      it('should not create a new cadastro with wrong br-phone', function (done) {
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
          .then(function () {
            done(new Error('Invalid record created'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('FONECOB')
            error.should.have.property('message')
            done()
          })
          .catch(logError(done))
      })
      it('should create a new cadastro with CPF', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'José',
            NUMERO: '2',
            CGCCPF: '18530249100'
          })
          .then(function (record) {
            record.should.have.property('CGCCPF')
            done()
          })
          .catch(logError(done))
      })
      it('should reject create a new cadastro with the same CPF', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Rick',
            NUMERO: '3',
            CGCCPF: '18530249100'
          })
          .then(function () {
            done(
              new Error('Record with CPF duplicated has been created')
            )
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('Duplicated CPF')
            error.should.have.property('message')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it(
        'should throw only a CEP not a NUMERO validation error because model ' +
          'validations are executed only when no errors occurs in field validation',
        function (done) {
          cadAtivo
            .create({
              NOMECAD: 'CEP incompleto',
              CEP: '30000',
              NUMERO: '9000',
              fornecedor: {}
            })
            .then(function () {
              done(new Error('Saved with incorrect CEP'))
            })
            .catch(function (error) {
              expect(error.name).to.equal('EntityError')
              expect(error.type).to.equal('ValidationError')
              expect(error.errors).to.be.a('array')
              expect(error.errors.length).to.equal(1)
              expect(error.errors[0].path).to.equal('CEP')
              done()
            })
            .catch(function (error) {
              done(error)
            })
        }
      )
      it('should throw a INSCEST validation error', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'IE não é deste estado',
            ESTADO: 'SP',
            NUMERO: '4',
            INSCEST: '1860558000110'
          })
          .then(function () {
            done(new Error('Saved with incorrect INSCEST'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('INSCEST')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('should throw a maxLength and a decimals validation error', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Too many decimas',
            NUMERO: '4',
            VALORLCTO: 12345.678
          })
          .then(function () {
            done(new Error('Saved with too many decimals'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(2)
            expect(error.errors[0].path).to.equal('VALORLCTO')
            expect(error.errors[1].path).to.equal('VALORLCTO')
            var message =
              error.errors[0].message +
              ' - ' +
              error.errors[1].message
            expect(message).to.contains('decimals')
            expect(message).to.contains('exceeds maximum length')
            done()
          })
          .catch(logError(done))
      })
      it('should throw 2 ENDERECO validation error', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Wrong',
            NUMERO: '4',
            ENDERECO: 'Road'
          })
          .then(function () {
            done(new Error('Saved with wrong ENDERECO'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(2)
            expect(error.errors[0].path).to.equal('ENDERECO')
            expect(error.errors[1].path).to.equal('ENDERECO')
            var message =
              error.errors[0].message +
              ' - ' +
              error.errors[1].message
            expect(message).to.contains('STREET or AVENUE')
            expect(message).to.contains('uppercase')
            done()
          })
          .catch(logError(done))
      })
      it('should create 3 new classes', function (done) {
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
          .then(function (record) {
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad).to.be.a('array')
            expect(record.ClassificaçãoCad.length).to.equal(3)
            expect(
              _.find(record.ClassificaçãoCad, 'Classe', 'Cliente')
            ).to.be.a('object')
            expect(
              _.find(record.ClassificaçãoCad, 'Classe', 'Corredor')
            ).to.be.a('object')
            expect(
              _.find(record.ClassificaçãoCad, 'Classe', 'Nadador')
            ).to.be.a('object')
            done()
          })
          .catch(logError(done))
      })
      it('should not accept a new cliente without classe cliente', function (done) {
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
                Classe: 'Fornecedor'
              }
            ],
            cliente: {
              SIGLACLI: 'Sigla'
            }
          })
          .then(function () {
            done(new Error('Saved with missing classe'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('Classes')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('should not accept a new cadastro with field Suframa', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Suframa is invalid',
            NUMERO: '5',
            Suframa: 'not allow'
          })
          .then(function () {
            done(new Error('Saved with Suframa'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(2)
            expect(error.errors[0].path).to.equal('Teste de promise')
            expect(error.errors[1].path).to.equal(
              'Teste de generator'
            )
            done()
          })
          .catch(logError(done))
      })
      it(
        'should not accept a new cliente without classe cliente and with Suframa ' +
          'and fornecedor with no NUMERO=99',
        function (done) {
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
            .then(function () {
              done(new Error('Saved with missing classe'))
            })
            .catch(function (error) {
              expect(error.name).to.equal('EntityError')
              expect(error.errors).to.be.a('array')
              expect(error.errors.length).to.equal(4)
              var classes
              var suframa = 0
              var fornecedor
              error.errors.forEach(function (detail) {
                if (detail.path === 'Classes') {
                  classes = true
                } else if (
                  detail.path === 'Teste de promise' ||
                  detail.path === 'Teste de generator'
                ) {
                  suframa++
                } else if (detail.path === 'Only in fornecedor') {
                  fornecedor = true
                }
              })
              expect(classes).to.equal(true)
              expect(suframa).to.equal(2)
              expect(fornecedor).to.equal(true)
              done()
            })
            .catch(function (error) {
              done(error)
            })
        }
      )
      it('should reject a new cadastro with two auto relations without NUMERO', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Joana',
            NUMERO: '10',
            fornecedor: {},
            destino: [
              {
                nome: 'Maria',
                IDENT: 'Fatima'
              },
              {
                nome: 'Maria 2',
                IDENT: 'Fatima 2'
              }
            ],
            outroDestino: {
              NOMECAD: 'Gilda',
              IDENT: 'Jessica'
            }
          })
          .then(function (record) {
            done(new Error('Invalid record created'))
          })
          .catch(function () {
            done()
          })
      })
      it('hook test should not accept a new cadastro with field BAIRRO=X', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Bairro is invalid',
            NUMERO: '5',
            BAIRRO: 'X'
          })
          .then(function () {
            done(new Error('Saved with BAIRRO=X'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('bairro')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('hook test should not accept a new cadastro with field PAIS=X', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Pais is invalid',
            NUMERO: '5',
            PAIS: 'X'
          })
          .then(function () {
            done(new Error('Saved with PAIS=X'))
          })
          .catch(function (error) {
            expect(error.name).to.not.equal('EntityError') // not sync
            expect(error.message).to.equal('pais cant be X')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it(
        'hook test should not accept a new cadastro with field BAIRRO=X, PAIS=X but ' +
          'only one error can be reported and should be the first hook added',
        function (done) {
          cadAtivo
            .create({
              NOMECAD: 'Bairro and pais are invalid',
              NUMERO: '5',
              BAIRRO: 'X',
              PAIS: 'X'
            })
            .then(function () {
              done(new Error('Saved with BAIRRO=X, PAIS=X'))
            })
            .catch(function (error) {
              expect(error.name).to.equal('EntityError')
              expect(error.errors).to.be.a('array')
              expect(error.errors.length).to.equal(1)
              expect(error.errors[0].path).to.equal('bairro')
              done()
            })
            .catch(function (error) {
              done(error)
            })
        }
      )
      it('should create a new cadastro with two hasMany self relation', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Joana',
            NUMERO: '10',
            BAIRRO: 'belvedere',
            destino: [
              {
                nome: 'Maria',
                IDENT: 'Fatima',
                NUMERO: '11'
              },
              {
                nome: 'Maria 2',
                IDENT: 'Fatima 2',
                NUMERO: '12'
              }
            ],
            outroDestino: {
              NOMECAD: 'Gilda',
              IDENT: 'Jessica',
              NUMERO: '13'
            }
          })
          .then(function (record) {
            joana = record
            record.should.have.property('destino')
            expect(record.destino.length).to.equal(2)
            record.destino[0].should.have.property('nome')
            record.destino[0].should.not.have.property('NOMECAD')
            record.destino[0].NUMLANORI.should.equal(record.id)
            record.destino[1].NUMLANORI.should.equal(record.id)
            record.should.have.property('outroDestino')
            record.outroDestino[0].NOMECAD.should.equal('Gilda')
            record.outroDestino[0].IDENT.should.equal('Jessica')
            record.outroDestino[0].FKOUTRO.should.equal(record.id)
            expect(record.BAIRRO).equal('belvedere')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should read the new cadastro with two hasMany self relation and do the same checks', function (done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            joana = recordset[0]
            joana.should.have.property('destino')
            expect(joana.destino.length).to.equal(2)
            joana.destino[0].should.have.property('nome')
            joana.destino[0].should.not.have.property('NOMECAD')
            joana.destino[0].NUMLANORI.should.equal(joana.id)
            joana.destino[1].NUMLANORI.should.equal(joana.id)
            joana.should.have.property('outroDestino')
            joana.outroDestino[0].NOMECAD.should.equal('Gilda')
            joana.outroDestino[0].IDENT.should.equal('Jessica')
            joana.outroDestino[0].FKOUTRO.should.equal(joana.id)
            expect(joana.BAIRRO).equal('belvedere')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should create a new cadastro with one hasOne self relation', function (done) {
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
          .then(function (record) {
            geralda = record
            record.should.have.property('maisOutroDestino')
            record.maisOutroDestino.NOMECAD.should.equal('Gilda')
            record.maisOutroDestino.IDENT.should.equal('Jessica')
            record.maisOutroDestino.NUMLANORI2.should.equal(record.id)

            record.should.have.property('docpagvc')
            expect(record.docpagvc).to.be.a('array')
            expect(record.docpagvc.length).to.equal(1)

            expect(record.DATNASC).to.equal(undefined)

            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('check if the vctos array generate an external table', function (done) {
        tableDocpagev
          .fetch({where: {NUMDOC: geralda.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should accept a new cliente/fornecedor', function (done) {
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
          .then(function (record) {
            any = record
            expect(record.DATNASC).to.equal('1999-12-31')
            done()
          })
          .catch(logError(done))
      })
      it('lets check the new cliente/fornecedor', function (done) {
        cadAtivo
          .fetch({where: {id: any.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (any = recordset[0])
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad).to.be.a('array')
            record.should.have.property('DATNASC')
            expect(record.DATNASC).to.equal('1999-12-31')
            expect(record.was.DATNASC).to.equal('1999-12-31')
            record.should.have.property('DATNASCZ')
            expect(record.DATNASCZ.toISOString()).to.equal(
              '1999-12-31T00:00:00.000Z'
            )
            record.should.have.property('DATNASCNOZ')
            expect(record.DATNASCNOZ.toISOString()).to.equal(
              new Date('1999-12-31T19:00:00').toISOString()
            )
            expect(record.cliente).to.be.a('object')
            expect(record.fornecedor).to.be.a('object')
            expect(record.ClassificaçãoCad.length).to.equal(2)
            expect(
              _.find(record.ClassificaçãoCad, 'Classe', 'Cliente')
            ).to.be.a('object')
            expect(
              _.find(record.ClassificaçãoCad, 'Classe', 'Fornecedor')
            ).to.be.a('object')
            done()
          })
          .catch(logError(done))
      })

      it('lets clear the date', function (done) {
        any.DATNASC = null
        any
          .save()
          .then(function () {
            expect(any.DATNASC).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })

      it('lets create with a null date', function (done) {
        any = cadAtivo.createInstance({
          NOMECAD: 'Any new'
        })
        any.DATNASC = null
        any
          .save()
          .then(function () {
            expect(any.DATNASC).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
    })

    describe('update cadastro', function () {
      it('should update João to be a client', function (done) {
        cadAtivo
          .fetch({where: {id: joao.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var entity = recordset[0]
            entity.ClassificaçãoCad = [
              {
                Classe: 'Cliente'
              }
            ]
            entity.empty = {
              SIGLACLI: null
            }
            return cadAtivo.update(entity).then(function (record) {
              entity = record
              entity.empty = {}
              return cadAtivo.update(entity).then(function (record) {
                entity = record
                entity.cliente = {
                  SIGLACLI: 'Sigla',
                  DATMAIA: '2015-02-02'
                }
                return cadAtivo
                  .update(entity)
                  .then(function (record) {
                    record.should.have.property('empty')
                    record.should.have.property('cliente')
                    expect(record.cliente.SIGLACLI).to.equal('Sigla')
                    record.should.have.property('ClassificaçãoCad')
                    expect(record.ClassificaçãoCad.length).to.equal(1)
                    expect(
                      record.ClassificaçãoCad[0].Classe
                    ).to.equal('Cliente')
                    expect(record.cliente.DATMAIA).to.be.a('string')
                    expect(record.cliente.DATMAIA).to.equal(
                      '2015-02-02'
                    )
                    expect(record.updatedAt).to.not.be.undefined
                    expect(record.updatedAt).to.be.a('date')
                    expect(record.updatedAt >= now).to.equal(true)
                    expect(
                      record.updatedAt > joao.updatedAt
                    ).to.equal(true)
                    expect(record.afterCreate).to.be.undefined
                    expect(record.afterUpdate).to.equal('true')
                    expect(record.afterPromise).to.equal('true')
                    return cadAtivo
                      .fetch({where: {id: joao.id}})
                      .then(function (recordset) {
                        expect(recordset).to.be.a('array')
                        expect(recordset.length).to.equal(1)
                        var record = recordset[0]
                        record.should.have.property('cliente')
                        expect(record.cliente.SIGLACLI).to.equal(
                          'Sigla'
                        )
                        record.should.have.property(
                          'ClassificaçãoCad'
                        )
                        expect(
                          record.ClassificaçãoCad.length
                        ).to.equal(1)
                        expect(
                          record.ClassificaçãoCad[0].Classe
                        ).to.equal('Cliente')
                        expect(record.cliente.DATMAIA).to.be.a(
                          'string'
                        )
                        expect(record.cliente.DATMAIA).to.equal(
                          '2015-02-02'
                        )
                        expect(record.updatedAt).to.not.be.undefined
                        expect(record.updatedAt).to.be.a('date')
                        expect(record.updatedAt >= now).to.equal(true)
                        expect(
                          record.updatedAt > joao.updatedAt
                        ).to.equal(true)
                        joao = record
                        done()
                      })
                  })
              })
            })
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('replace hasMany array', function (done) {
        cadAtivo
          .update(
            {
              ClassificaçãoCad: [
                {
                  Classe: 'Cliente'
                },
                {
                  Classe: 'Fornecedor'
                }
              ],
              updatedAt: joao.updatedAt
            },
            {where: {id: joao.id}}
          )
          .then(function (record) {
            joao = record
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(2)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should not remove a item from the array that cannot be removed', function (done) {
        cadAtivo
          .update(
            {
              ClassificaçãoCad: [
                {
                  Classe: 'Fornecedor'
                }
              ],
              updatedAt: joao.updatedAt
            },
            joao.id
          )
          .then(function () {
            done(new Error('Saved invalid record'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('Classes')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('add vctos array', function (done) {
        cadAtivo
          .update(
            {
              ClassificaçãoCad: [
                {
                  Classe: 'Cliente'
                }
              ],
              docpagvc: {
                VALOR: 700,
                DATAVENC: '2015-08-23',
                DATAVENCZ: '1999-12-31T00:00:00Z',
                DATAVENCNOZ: new Date('1999-12-31T19:00:00'),
                'Hora do próximo aviso': '1999-12-31T00:00:00Z'
              },
              VALORLCTO: 700,
              updatedAt: joao.updatedAt
            },
            joao.id
          )
          .then(function (record) {
            joao = record
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(1)
            record.should.have.property('docpagvc')
            expect(record.docpagvc.length).to.equal(1)
            expect(record.docpagvc[0].VALOR).to.equal(700)
            record.should.have.property('VALORLCTO')
            expect(record.VALORLCTO).to.equal(700)
            done()
          })
          .catch(logError(done))
      })
      it('check if the added vctos array generate an external table', function (done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('and check the vctos array', function (done) {
        cadAtivo
          .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = recordset[0]
            record.should.have.property('docpagvc')
            expect(record.docpagvc.length).to.equal(1)
            expect(record.docpagvc[0].VALOR).to.equal(700)
            record.should.have.property('VALORLCTO')
            expect(record.VALORLCTO).to.equal(700)
            record.docpagvc[0].should.have.property('DATAVENC')
            expect(record.docpagvc[0].DATAVENC).to.equal('2015-08-23')
            record.docpagvc[0].should.have.property('DATAVENCZ')
            expect(
              record.docpagvc[0].DATAVENCZ.toISOString()
            ).to.equal('1999-12-31T00:00:00.000Z')
            record.docpagvc[0].should.have.property('DATAVENCNOZ')
            expect(
              record.docpagvc[0].DATAVENCNOZ.toISOString()
            ).to.equal(new Date('1999-12-31T19:00:00').toISOString())
            expect(
              record.docpagvc[0][
                'Hora do próximo aviso'
              ].toISOString()
            ).to.equal('1999-12-31T00:00:00.000Z')
            done()
          })
          .catch(logError(done))
      })
      it('replace vctos array', function (done) {
        cadAtivo
          .update(
            {
              docpagvc: [
                {
                  VALOR: 350.01,
                  DATAVENC: '2015-08-23'
                },
                {
                  VALOR: 250.02,
                  DATAVENC: '2015-09-23'
                }
              ],
              updatedAt: joao.updatedAt
            },
            joao.id
          )
          .then(function (record) {
            joao = record
            record.should.have.property('docpagvc')
            expect(record.docpagvc.length).to.equal(2)
            expect(record.docpagvc[0].VALOR).to.equal(350.01)
            expect(record.docpagvc[1].VALOR).to.equal(250.02)
            done()
          })
          .catch(logError(done))
      })
      it('add more one vcto', function (done) {
        joao.docpagvc = joao.docpagvc.concat([
          {
            VALOR: 0,
            DATAVENC: '2019-09-24'
          }
        ])
        cadAtivo
          .update(joao, joao.id)
          .then(function (record) {
            joao = record
            record.should.have.property('docpagvc')
            expect(record.docpagvc.length).to.equal(3)
            expect(record.docpagvc[0].VALOR).to.equal(350.01)
            expect(record.docpagvc[1].VALOR).to.equal(250.02)
            expect(record.docpagvc[2].VALOR).to.equal(0)
            done()
          })
          .catch(logError(done))
      })
      it('should not accept a update joão without classe cliente and with Suframa', function (done) {
        cadAtivo
          .update(
            {
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
            },
            {where: {id: joao.id, updatedAt: joao.updatedAt}}
          )
          .then(function () {
            done(new Error('Saved invalid record'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(3)
            var classes
            var suframa = 0
            error.errors.forEach(function (detail) {
              if (detail.path === 'Classes') {
                classes = true
              } else if (
                detail.path === 'Teste de promise' ||
                detail.path === 'Teste de generator'
              ) {
                suframa++
              }
            })
            expect(classes).to.equal(true)
            expect(suframa).to.equal(2)
            done()
          })
          .catch(logError(done))
      })
      it('check if the joao vctos array generate is equivalent to the external table', function (done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(3)
            done()
          })
          .catch(logError(done))
      })
      it('finally lets try delete Joao without timestamp', function (done) {
        cadAtivo
          .destroy(joao.id)
          .then(function () {
            done(new Error('Invalid delete'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            error.should.have.property('message')
            expect(error.type).to.equal('RecordModifiedOrDeleted')
            done()
          })
          .catch(logError(done))
      })
      it('lets try again with timestamp to delete Joao', function (done) {
        cadAtivo
          .destroy({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function () {
            done(new Error('Invalid delete'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('COMPLEMENTO')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('so lets cleanup COMPLEMENTO and modify NOMECAD', function (done) {
        joao.NOMECAD = 'Outro João'
        joao.COMPLEMENTO = null
        cadAtivo
          .update(joao, {
            where: {id: joao.id, updatedAt: joao.updatedAt}
          })
          .then(function () {
            done(new Error('Invalid update'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('NOMECAD')
            done()
          })
          .catch(logError(done))
      })
      it('so lets cleanup only COMPLEMENTO', function (done) {
        joao.NOMECAD = 'João'
        joao.COMPLEMENTO = null
        cadAtivo
          .update(joao, {
            where: {id: joao.id, updatedAt: joao.updatedAt}
          })
          .then(function (record) {
            joao = record
            expect(joao.COMPLEMENTO).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('and check COMPLEMENTO', function (done) {
        cadAtivo
          .fetch({where: {id: joao.id, updatedAt: joao.updatedAt}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = recordset[0]
            expect(record.COMPLEMENTO).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('should not save a smaller valor in vctos', function (done) {
        const plain = JSON.parse(JSON.stringify(joao))
        plain.docpagvc[0].VALOR = 350
        cadAtivo
          .update(plain)
          .then(function () {
            done(new Error('Invalid update'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('ValidationError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal(
              'Only greater or equal'
            )
            done()
          })
          .catch(logError(done))
      })
      it('should delete joao vctos', function (done) {
        joao.docpagvc = null
        cadAtivo
          .update(joao)
          .then(function (record) {
            expect(record.docpagvc).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('lets check joao vctos', function (done) {
        cadAtivo
          .fetch({where: {id: joao.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (joao = recordset[0])
            expect(record.docpagvc).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('lets try a update without parameters', function (done) {
        cadAtivo
          .update({NOMECAD: 'joao'})
          .then(function () {
            done(new Error('Invalid destroy'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidArgument')
            expect(
              error.message.indexOf('need a primary key') !== -1
            ).to.equal(true)
            done()
          })
          .catch(logError(done))
      })
      it('lets try a update without where', function (done) {
        cadAtivo
          .update({NOMECAD: 'joao'}, {})
          .then(function () {
            done(new Error('Invalid destroy'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidArgument')
            expect(
              error.message.indexOf('Where clause not defined') !== -1
            ).to.equal(true)
            done()
          })
          .catch(logError(done))
      })
      it('lets try a delete without parameters', function (done) {
        cadAtivo
          .destroy()
          .then(function () {
            done(new Error('Invalid destroy'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidArgument')
            expect(
              error.message.indexOf('need a primary key') !== -1
            ).to.equal(true)
            done()
          })
          .catch(logError(done))
      })
      it('lets try a delete without where', function (done) {
        cadAtivo
          .destroy({})
          .then(function () {
            done(new Error('Invalid destroy'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidArgument')
            expect(
              error.message.indexOf('Where clause not defined') !== -1
            ).to.equal(true)
            done()
          })
          .catch(logError(done))
      })
      it('then lets delete Joao', function (done) {
        cadAtivo
          .destroy(
            {where: {id: joao.id, updatedAt: joao.updatedAt}},
            {schema: 'public'}
          )
          .then(function (record) {
            expect(record).to.equal(undefined)
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('check if the joao vctos array external table was deleted', function (done) {
        tableDocpagev
          .fetch({where: {NUMDOC: joao.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('confirm Joana data after create', function (done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (joana = recordset[0])
            record.should.have.property('destino')
            expect(record.destino.length).to.equal(2)
            record.should.have.property('outroDestino')
            record.outroDestino[0].NOMECAD.should.equal('Gilda')
            record.outroDestino[0].IDENT.should.equal('Jessica')
            record.should.have.property('updatedAt')
            done()
          })
          .catch(logError(done))
      })
      it('should update Joana to be a client, using plain object', function (done) {
        joana = JSON.parse(JSON.stringify(joana))
        joana.ClassificaçãoCad = [
          {
            Classe: 'Cliente'
          }
        ]
        joana.cliente = {
          SIGLACLI: 'Sigla'
        }
        joana.outroDestino[0].IDENT = null
        joana.BAIRRO = null
        cadAtivo
          .update(joana, joana.id)
          .then(function (record) {
            joana = record
            record.should.have.property('destino')
            expect(record.destino.length).to.equal(2)
            record.destino[0].NUMLANORI.should.equal(record.id)
            record.destino[1].NUMLANORI.should.equal(record.id)
            record.should.have.property('outroDestino')
            record.outroDestino[0].NOMECAD.should.equal('Gilda')
            expect(record.outroDestino[0].IDENT).equal(undefined)
            record.outroDestino[0].FKOUTRO.should.equal(record.id)
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(1)
            expect(record.ClassificaçãoCad[0].Classe).to.equal(
              'Cliente'
            )
            record.should.have.property('updatedAt')

            expect(record.cliente.DATMAIA).to.equal(undefined)
            expect(record.BAIRRO).to.equal(undefined)

            expect(record.afterCreate).to.be.undefined
            expect(record.afterUpdate).to.equal('true')
            expect(record.afterPromise).to.equal('true')
            done()
          })
          .catch(logError(done))
      })
      it('confirm Joana data after update', function (done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (joana = recordset[0])
            record.should.have.property('destino')
            expect(record.destino.length).to.equal(2)
            record.should.have.property('outroDestino')
            record.outroDestino[0].NOMECAD.should.equal('Gilda')
            expect(record.outroDestino[0].IDENT).equal(undefined)
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(1)
            expect(record.ClassificaçãoCad[0].Classe).to.equal(
              'Cliente'
            )
            record.should.have.property('updatedAt')
            expect(record.cliente.DATMAIA).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('should update Geralda to be a client', function (done) {
        geralda.ClassificaçãoCad = [
          {
            Classe: 'Cliente'
          },
          {
            Classe: 'Outra'
          }
        ]
        geralda.cliente = {
          SIGLACLI: 'Sigla',
          DATMAIA: '2015-02-02'
        }
        cadAtivo
          .update(geralda, geralda.id)
          .then(function (record) {
            geralda = record
            record.should.have.property('maisOutroDestino')
            record.maisOutroDestino.NOMECAD.should.equal('Gilda')
            record.maisOutroDestino.IDENT.should.equal('Jessica')
            record.maisOutroDestino.NUMLANORI2.should.equal(record.id)
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(2)
            expect(record.ClassificaçãoCad[0].Classe).to.equal(
              'Cliente'
            )
            record.should.have.property('updatedAt')
            expect(record.cliente.DATMAIA).to.be.a('string')
            expect(record.cliente.DATMAIA).to.equal('2015-02-02')
            expect(record.afterUpdate).to.equal('true')
            expect(record.afterPromise).to.equal('true')

            expect(record.DATNASC).to.equal(undefined)

            done()
          })
          .catch(logError(done))
      })
    })

    describe('preventing delete', function () {
      it('should create a new cadastro', function (done) {
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
          .then(function (record) {
            mariana = record
            done()
          })
          .catch(logError(done))
      })
      it('cannot be deleted', function (done) {
        cadAtivo
          .destroy({
            where: {id: mariana.id, updatedAt: mariana.updatedAt}
          })
          .catch(function (error) {
            expect(error.type).to.equal('beforeDeleteHookError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('Fax')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
    })

    describe('checking methods', function () {
      it('joana should have quitar after fetch', function (done) {
        cadAtivo
          .fetch({where: {id: joana.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            joana = recordset[0]
            expect(joana.quitar).to.be.a('function')
            joana.quitar()
            expect(joana.quitado).to.equal('S')
            expect(joana.ClassificaçãoCad[0].quitar).to.be.a(
              'function'
            )
            joana.ClassificaçãoCad[0].quitar()
            expect(joana.ClassificaçãoCad[0].quitado).to.equal('S')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('mariana should have quitar after create', function (done) {
        expect(mariana.quitar).to.be.a('function')
        mariana.quitar()
        expect(mariana.quitado).to.equal('S')
        expect(mariana.ClassificaçãoCad[0].quitar).to.be.a('function')
        mariana.ClassificaçãoCad[0].quitar()
        expect(mariana.ClassificaçãoCad[0].quitado).to.equal('S')
        done()
      })
      it('geralda should have quitar after update', function (done) {
        expect(geralda.quitar).to.be.a('function')
        geralda.quitar()
        expect(geralda.quitado).to.equal('S')
        expect(geralda.ClassificaçãoCad[0].quitar).to.be.a('function')
        expect(geralda.ClassificaçãoCad[0].quitado).to.equal(
          undefined
        )
        geralda.ClassificaçãoCad[0].quitar()
        expect(geralda.ClassificaçãoCad[0].quitado).to.equal('S')
        expect(geralda.ClassificaçãoCad[1].quitar).to.be.a('function')
        expect(geralda.ClassificaçãoCad[1].quitado).to.equal(
          undefined
        )
        expect(geralda.cliente.quitar).to.equal(undefined)
        expect(geralda.cliente.quitado).to.equal(undefined)
        expect(geralda.destino.quitar).to.equal(undefined)
        expect(geralda.destino.quitado).to.equal(undefined)
        expect(geralda.maisOutroDestino.quitar).to.equal(undefined)
        expect(geralda.maisOutroDestino.quitado).to.equal(undefined)
        done()
      })
    })

    describe('joana deletion', function () {
      it('then lets delete Joana', function (done) {
        cadAtivo
          .destroy({
            where: {id: joana.id, updatedAt: joana.updatedAt}
          })
          .then(function (record) {
            expect(record).to.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('so Joana does not exists', function (done) {
        tableCadastro
          .fetch({where: {id: joana.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('neither Maria...', function (done) {
        tableCadastro
          .fetch({where: {id: joana.destino[0].id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('...Maria 2...', function (done) {
        tableCadastro
          .fetch({where: {id: joana.destino[1].id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('...or Gilda', function (done) {
        tableCadastro
          .fetch({where: {id: joana.outroDestino[0].id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
    })

    describe('scope handling', function () {
      it('update Geralda to be out of scope', function (done) {
        cadAtivo
          .update(
            {Inativo: 'Sim', updatedAt: geralda.updatedAt},
            geralda.id
          )
          .then(function (record) {
            geralda = record
            record.should.have.property('maisOutroDestino')
            record.maisOutroDestino.NOMECAD.should.equal('Gilda')
            record.maisOutroDestino.IDENT.should.equal('Jessica')
            record.maisOutroDestino.NUMLANORI2.should.equal(record.id)
            record.should.have.property('cliente')
            expect(record.cliente.SIGLACLI).to.equal('Sigla')
            record.should.have.property('ClassificaçãoCad')
            expect(record.ClassificaçãoCad.length).to.equal(2)
            expect(record.ClassificaçãoCad[0].Classe).to.equal(
              'Cliente'
            )
            record.should.have.property('updatedAt')
            expect(record.cliente.DATMAIA).to.be.a('string')
            expect(record.cliente.DATMAIA).to.equal('2015-02-02')
            expect(record.afterUpdate).to.equal('true')
            expect(record.afterPromise).to.equal('true')
            done()
          })
          .catch(logError(done))
      })
      it('then geralda disappears, cant be found...', function (done) {
        cadAtivo
          .fetch({where: {id: geralda.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('geralda cant be updated', function (done) {
        cadAtivo
          .update(
            {Inativo: 'N', updatedAt: geralda.updatedAt},
            geralda.id
          )
          .then(function (record) {
            done(new Error('Invalid update'))
          })
          .catch(function (error) {
            expect(error.type).to.equal('RecordModifiedOrDeleted')
            expect(error.errors).to.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('and geralda cant be deleted', function (done) {
        cadAtivo
          .destroy({
            where: {id: geralda.id, updatedAt: geralda.updatedAt}
          })
          .then(function (record) {
            done(new Error('Invalid delete'))
          })
          .catch(function (error) {
            expect(error.type).to.equal('RecordModifiedOrDeleted')
            expect(error.errors).to.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('but geralda still exists', function (done) {
        tableCadastro
          .fetch({where: {id: geralda.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var geralda = recordset[0]
            expect(geralda.Inativo).to.equal('Sim')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
    })

    describe('inner level check', function () {
      it('should accept a new fornecedor with two vctos', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'mario with two vctos',
            NUMERO: '5555',
            fornecedor: {
              SIGLAFOR: 'Two vcts',
              NUMERO: '99',
              docpagvc: [
                {
                  VALOR: 350.01,
                  DATAVENC: '2015-08-23',
                  'Hora do próximo aviso': '1999-12-31T00:00:00Z'
                },
                {
                  VALOR: 250.02,
                  DATAVENC: '2015-09-23'
                }
              ]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function (record) {
            mario = record
            record.should.have.property('fornecedor')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            done()
          })
          .catch(logError(done))
      })
      it('lets check mario, the new fornecedor with two vctos', function (done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (mario = recordset[0])
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(
              record.fornecedor.docpagvc[0][
                'Hora do próximo aviso'
              ].toISOString()
            ).to.equal('1999-12-31T00:00:00.000Z')
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('add more one vcto to mario', function (done) {
        mario.fornecedor.docpagvc = mario.fornecedor.docpagvc.concat([
          {
            VALOR: 10.99,
            DATAVENC: '2015-09-24'
          }
        ])
        mario.fornecedor.NUMERO = '99' // NUMERO is only for tests purposes
        cadAtivo
          .update(mario, mario.id)
          .then(function (record) {
            mario = record
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(3)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(record.fornecedor.docpagvc[2].VALOR).to.equal(
              10.99
            )
            done()
          })
          .catch(done)
      })
      it('lets check mario, the new fornecedor with three vctos', function (done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (mario = recordset[0])
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(3)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(record.fornecedor.docpagvc[2].VALOR).to.equal(
              10.99
            )
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('remove the first vcto from mario', function (done) {
        mario.fornecedor.docpagvc.shift()
        mario.fornecedor.NUMERO = '99' // NUMERO is only for tests purposes
        cadAtivo
          .update(mario, mario.id)
          .then(function (record) {
            mario = record
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              250.02
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              10.99
            )
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('lets check mario, the new fornecedor with two vctos again', function (done) {
        cadAtivo
          .fetch({where: {id: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (mario = recordset[0])
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              250.02
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              10.99
            )
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('then lets delete mario', function (done) {
        cadAtivo
          .destroy({
            where: {id: mario.id, updatedAt: mario.updatedAt}
          })
          .then(function (record) {
            expect(record).to.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('so mario does not exists', function (done) {
        tableCadastro
          .fetch({where: {id: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('nor mario fornecedor record', function (done) {
        tableFornec
          .fetch({where: {id: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(logError(done))
      })
      it('nor any mario fornecedor docpgavc record', function (done) {
        tableDocpagvc
          .fetch({where: {FORNEC: mario.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
    })

    describe('mutation on the third level', function () {
      before(function () {
        entityCadAtivo.fornecedor.docpagvc.hasOne(
          'EVENTO as categoria',
          EVENTO
        )
        entityCadAtivo.fornecedor.docpagvc.categoria.validate(
          function () {
            assert(
              this.entity,
              'this should be a instance in validation'
            )
          }
        )
      })
      it('should reject a new method already existent', function () {
        try {
          entityCadAtivo.instanceMethod('quitar', function () {})
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid method created')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal(
            'Instance method quitar is already defined'
          )
        }
      })
      it('should reject a new method with a column with the same name', function () {
        try {
          entityCadAtivo.instanceMethod('NOMECAD', function () {})
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid method created')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.contains(
            'there is already a column with this name'
          )
        }
      })
      it('should accept a new fornecedor with two vctos with on event each', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Lidia with two vctos one event each',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [
                {
                  VALOR: 250.02,
                  DATAVENC: '2015-09-23',
                  categoria: {
                    id: '222',
                    DESCEVENTO: 'Category 222'
                  }
                },
                {
                  VALOR: 350.01,
                  DATAVENC: '2015-08-23',
                  categoria: {
                    id: '111',
                    DESCEVENTO: 'Category 111'
                  }
                }
              ]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function (record) {
            lidia = record
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            record.fornecedor.docpagvc[0].should.have.property(
              'categoria'
            )
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.equal('111')
            expect(
              record.fornecedor.docpagvc[1].categoria.id
            ).to.equal('222')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('lets check lidia, the new fornecedor with two vctos and events', function (done) {
        cadAtivo
          .fetch({where: {id: lidia.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = recordset[0]
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            record.fornecedor.docpagvc[0].should.have.property(
              'categoria'
            )
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.equal('111')
            expect(
              record.fornecedor.docpagvc[1].categoria.id
            ).to.equal('222')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('then lets delete lidia', function (done) {
        cadAtivo
          .destroy({
            where: {id: lidia.id, updatedAt: lidia.updatedAt}
          })
          .then(function (record) {
            expect(record).to.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('so lidia does not exists', function (done) {
        tableCadastro
          .fetch({where: {id: lidia.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('nor lidia fornecedor record', function (done) {
        tableFornec
          .fetch({where: {id: lidia.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('nor any lidia fornecedor docpgavc record', function (done) {
        tableDocpagvc
          .fetch({where: {FORNEC: lidia.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('nor any lidia fornecedor docpgavc event record', function (done) {
        tableEvento
          .fetch({where: {VCTO: lidia.fornecedor.docpagvc[0].id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            tableEvento
              .fetch({where: {VCTO: lidia.fornecedor.docpagvc[1].id}})
              .then(function (recordset) {
                expect(recordset).to.be.a('array')
                expect(recordset.length).to.equal(0)
                done()
              })
              .catch(function (err) {
                done(err)
              })
          })
          .catch(function (err) {
            done(err)
          })
      })
      it('should not accept a new fornecedor with one vcto with and two event each', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Invalid',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [
                {
                  VALOR: 350.01,
                  DATAVENC: '2015-08-23',
                  categoria: [
                    {
                      id: '111',
                      DESCEVENTO: 'Category 111'
                    },
                    {
                      id: '2222',
                      DESCEVENTO: 'Category 222'
                    }
                  ]
                }
              ]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function () {
            done(new Error('Invalid entity created'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidData')
            expect(error.errors).to.equal(undefined)
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('should report a server error', function (done) {
        var command
        if (cadAtivo.db.dialect === 'mssql') {
          command =
            'CREATE TRIGGER reminder ON CADASTRO ' +
            'AFTER INSERT ' +
            'AS ' +
            "IF (SELECT NUMERO FROM INSERTED)='INVLD' RAISERROR ('INVLD', 11, 1)"
        } else {
          command =
            'CREATE FUNCTION rec_insert() RETURNS trigger ' +
            'AS $rec_insert$ BEGIN ' +
            "IF new.\"NUMERO\" ='INVLD' THEN RAISE EXCEPTION 'INVLD'; END IF; " +
            'RETURN new; END; ' +
            '$rec_insert$ LANGUAGE plpgsql; ' +
            'CREATE TRIGGER reminder AFTER INSERT ON "CADASTRO" ' +
            'FOR EACH ROW ' +
            'EXECUTE PROCEDURE rec_insert();'
        }
        cadAtivo.db
          .execute(command)
          .then(function () {
            return cadAtivo
              .create({
                NOMECAD: 'Any',
                NUMERO: 'INVLD'
              })
              .then(function () {
                done(new Error('Invalid record saved'))
              })
              .catch(function (error) {
                expect(
                  error.name === 'RequestError' ||
                    error.name === 'error'
                ).to.equal(true)
                expect(error.message).to.equal('INVLD')
                done()
              })
          })
          .catch(logError(done))
      })
      it('then lets recreate lidia as the first time', function (done) {
        cadAtivo
          .create({
            NOMECAD: 'Lidia with two vctos one event each',
            NUMERO: '6666',
            fornecedor: {
              SIGLAFOR: 'Two vcts-event',
              NUMERO: '99',
              docpagvc: [
                {
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
                }
              ]
            },
            ClassificaçãoCad: [
              {
                Classe: 'Fornecedor'
              }
            ]
          })
          .then(function (record) {
            lidia = record
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            record.fornecedor.docpagvc[0].should.have.property(
              'categoria'
            )
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.equal('111')
            expect(
              record.fornecedor.docpagvc[1].categoria.id
            ).to.equal('222')
            done()
          })
          .catch(logError(done))
      })
      it('should not accept to update lidia with one vcto with and two event each', function (done) {
        lidia.fornecedor.NUMERO = '99'
        lidia.fornecedor.docpagvc[0].categoria = [
          {
            id: '333',
            DESCEVENTO: 'Category 333'
          },
          {
            id: '444',
            DESCEVENTO: 'Category 444'
          }
        ]
        cadAtivo
          .update(lidia, {
            where: {id: lidia.id, updatedAt: lidia.updatedAt}
          })
          .then(function () {
            done(new Error('Invalid entity update'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidData')
            expect(error.errors).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('should now accept to update lidia with one vcto with one event', function (done) {
        lidia.fornecedor.NUMERO = '99'
        lidia.fornecedor.docpagvc[0].categoria = [
          {
            id: '333',
            DESCEVENTO: 'Category 333'
          }
        ]
        cadAtivo
          .update(lidia, {
            where: {id: lidia.id, updatedAt: lidia.updatedAt}
          })
          .then(function (record) {
            lidia = record
            expect(record.fornecedor).to.be.a('object')
            expect(record.docpagvc).to.equal(undefined)
            expect(record.fornecedor.docpagvc).to.be.a('array')
            expect(record.fornecedor.docpagvc.length).to.equal(2)
            record.fornecedor.docpagvc[0].should.have.property(
              'categoria'
            )
            expect(record.fornecedor.docpagvc[0].VALOR).to.equal(
              350.01
            )
            expect(record.fornecedor.docpagvc[1].VALOR).to.equal(
              250.02
            )
            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.equal('333')
            expect(
              record.fornecedor.docpagvc[1].categoria.id
            ).to.equal('222')
            expect(
              record.fornecedor.docpagvc[0].categoria.validate
            ).to.be.a('function')
            done()
          })
          .catch(logError(done))
      })
      it('and then category 111 does not exists any longer', function (done) {
        tableEvento
          .fetch({where: {id: '111'}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(0)
            done()
          })
          .catch(logError(done))
      })
    })

    describe('using the instance', function () {
      before(function (done) {
        entityCadAtivo.fornecedor.docpagvc.categoria.validate(
          'do not alter id',
          function () {
            if (this.was && this.id !== this.was.id) {
              throw new Error('id cannot be modified')
            }
          }
        )
        entityCadAtivo.validate(
          'do not alter TSN',
          function () {
            if (this.was.TSN !== this.TSN) {
              throw new Error('TSN cannot be modified')
            }
          },
          {onCreate: false}
        )
        entityCadAtivo.fornecedor.docpagvc.categoria.validate(
          'do not alter doCaixa',
          function () {
            if (this.was.doCaixa !== this.doCaixa) {
              throw new Error('doCaixa cannot be modified')
            }
          },
          {onCreate: false}
        )
        done()
      })
      it('should not be valid due to missing FORNECEDOR=99', function (done) {
        lidia.fornecedor.NUMERO = null
        lidia
          .validate()
          .then(function () {
            done(new Error('Validated invalid instance'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal(
              'Only in fornecedor'
            )
            done()
          })
          .catch(logError(done))
      })
      it('should be valid due to property FORNECEDOR=99', function (done) {
        lidia.fornecedor.NUMERO = '99'
        lidia
          .validate()
          .then(function () {
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('should not be valid due to categoria cant have id changed', function (done) {
        lidia.fornecedor.docpagvc[0].categoria.id = 'X'
        lidia.fornecedor.docpagvc[0].categoria
          .validate()
          .then(function () {
            done(new Error('Validated invalid instance'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('do not alter id')
            done()
          })
          .catch(logError(done))
      })
      it('should not be valid too when validating the entity', function (done) {
        lidia
          .validate()
          .then(function () {
            done(new Error('Validated invalid instance'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.errors).to.be.a('array')
            expect(error.errors.length).to.equal(1)
            expect(error.errors[0].path).to.equal('do not alter id')
            done()
          })
          .catch(function (error) {
            done(error)
          })
      })
      it('should create a new instance', function () {
        jessica = cadAtivo.createInstance({
          NOMECAD: 'Jessica',
          NUMERO: '1'
        })
        jessica.should.have.property('save')
        jessica.should.have.property('destroy')
      })
      it('that cannot be destroyed due to not be saved', function (done) {
        jessica
          .destroy()
          .then(function () {
            done(new Error('Invalid operation'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidOperation')
            expect(error.message).to.equal('Instance is new')
            done()
          })
      })
      it('should save to disk', function (done) {
        jessica
          .save()
          .then(function () {
            jessica.should.have.property('id')
            jessica.should.have.property('updatedAt')
            jessica.should.have.property('NOMECAD')
            jessica.NOMECAD.should.equal('Jessica')
            done()
          })
          .catch(logError(done))
      })
      it('then be modified and saved again', function (done) {
        jessica.NUMERO = '123'
        var updatedAt = jessica.updatedAt
        jessica
          .save()
          .then(function () {
            jessica.should.have.property('NUMERO')
            jessica.NUMERO.should.equal('123')
            expect(jessica.updatedAt > updatedAt).to.equal(true)
            done()
          })
          .catch(logError(done))
      })
      it('then can be destroyed', function (done) {
        jessica
          .destroy()
          .then(function () {
            expect(jessica.id).to.not.equal(undefined)
            expect(jessica.updatedAt).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('then cannot be destroyed due to be new again', function (done) {
        jessica
          .destroy()
          .then(function () {
            done(new Error('Invalid operation'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidOperation')
            expect(error.message).to.equal('Instance is new')
            done()
          })
          .catch(logError(done))
      })

      describe('without knowing what level it is', function () {
        var lucia
        var vcto = []
        before(function (done) {
          var error
          try {
            lucia = cadAtivo.createInstance({
              NOMECAD: 'Lucia',
              NUMERO: '7',
              docpagvc: [
                {
                  VALOR: 100.01,
                  DATAVENC: '2015-08-23'
                },
                {
                  VALOR: 200.02,
                  DATAVENC: '2015-09-23'
                }
              ],
              fornecedor: {
                SIGLAFOR: 'Lucia as fornecedor',
                NUMERO: '99',
                docpagvc: [
                  {
                    VALOR: 300.01,
                    DATAVENC: '2015-08-23',
                    categoria: {
                      id: '111',
                      DESCEVENTO: 'Category 111'
                    }
                  },
                  {
                    VALOR: 400.02,
                    DATAVENC: '2015-09-23'
                  }
                ]
              },
              ClassificaçãoCad: [
                {
                  Classe: 'Fornecedor'
                }
              ]
            })
            vcto[0] = lucia.docpagvc[0]
            vcto[1] = lucia.docpagvc[1]
            lucia.fornecedor.docpagvc =
              lucia.fornecedor.docpagvc.concat([
                {
                  VALOR: 600.02,
                  DATAVENC: '2015-09-24'
                }
              ])
            vcto[2] = lucia.fornecedor.docpagvc[0]
            vcto[3] = lucia.fornecedor.docpagvc[1]
            vcto[4] = lucia.fornecedor.docpagvc[2]
            assert(
              vcto[3].entity,
              'Added array element should be an entity'
            )
            assert(
              vcto[4].entity === lucia.entity,
              'Added array element should be lucia'
            )
            expect(vcto[4].entity.id).to.equal('CADASTRO')
            expect(vcto[4].entity.alias).to.equal('cadAtivo')
          } catch (e) {
            error = e
          }
          done(error)
        })
        it('should be saved to disk using any component', function (done) {
          vcto[4]
            .save()
            .then(function () {
              expect(lucia.id).to.not.equal(undefined)
              expect(lucia.updatedAt).to.not.equal(undefined)
              expect(lucia.NOMECAD).to.not.equal(undefined)
              lucia.NOMECAD.should.equal('Lucia')
              expect(lucia.docpagvc).to.not.equal(undefined)
              expect(lucia.fornecedor).to.not.equal(undefined)
              expect(lucia.fornecedor.docpagvc).to.not.equal(
                undefined
              )
              expect(vcto[3].id).to.not.equal(undefined)
              var was = lucia.was
              was.should.have.property('id')
              was.should.have.property('updatedAt')
              was.should.have.property('NOMECAD')
              was.NOMECAD.should.equal('Lucia')
              was.should.have.property('docpagvc')
              was.should.have.property('fornecedor')
              was.fornecedor.should.have.property('docpagvc')
              vcto[3].was.should.have.property('id')
              done()
            })
            .catch(logError(done))
        })
        it('was cannot have new properties', function () {
          try {
            vcto[3].was.newColumn = 1
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Invalid property modification')
          } catch (error) {
            error.should.have.property('message')
            expect(error.message).to.contains(
              'object is not extensible'
            )
          }
        })
        it('was cannot be modified', function () {
          try {
            vcto[3].was.id = 1
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Invalid property modification')
          } catch (error) {
            error.should.have.property('message')
            expect(error.message).to.contains(
              'Cannot assign to read only property'
            )
          }
        })
        it('could be saved to disk using any component via entity create', function (done) {
          vcto[3].entity
            .create({NOMECAD: 'John Doe'})
            .then(function (record) {
              record.should.have.property('id')
              record.should.have.property('updatedAt')
              record.should.have.property('NOMECAD')
              record.NOMECAD.should.equal('John Doe')
              done()
            })
            .catch(logError(done))
        })
        it('could be saved to disk using entiy via entity create', function (done) {
          lucia.entity
            .create({NOMECAD: 'Mary Lou'})
            .then(function (record) {
              record.should.have.property('id')
              record.should.have.property('updatedAt')
              record.should.have.property('NOMECAD')
              record.NOMECAD.should.equal('Mary Lou')
              done()
            })
            .catch(logError(done))
        })
        it('if we push (to push you must set a new or existing array to the property) another vcto it should not be mutated to instance after save', function (done) {
          var newVcto = {
            VALOR: 500.03,
            DATAVENC: '2015-10-23',
            categoria: {
              id: '777',
              DESCEVENTO: 'Category 777'
            }
          }
          lucia.fornecedor.docpagvc =
            lucia.fornecedor.docpagvc.concat([newVcto])
          lucia
            .save()
            .then(function () {
              expect(newVcto.id).to.equal(undefined)
              expect(
                lucia.fornecedor.docpagvc[2] !== newVcto
              ).to.equal(true)
              newVcto.should.not.have.property('save')
              done()
            })
            .catch(logError(done))
        })
        it('will not mutate a plain object to a instance after create', function (done) {
          var jane = {
            NOMECAD: 'Jane'
          }
          cadAtivo
            .create(jane)
            .then(function (record) {
              expect(record.id).to.not.equal(undefined)
              expect(record.save).to.not.equal(undefined)
              expect(jane).to.not.equal(record)
              done()
            })
            .catch(logError(done))
        })
      })
    })

    describe('Plain object', function () {
      var marianne
      it('Will return a plain object after create', function (done) {
        marianne = {
          NOMECAD: 'Marianne',
          DATNASC: '1998-12-31',
          fornecedor: {
            SIGLAFOR: 'Marianne catering',
            NUMERO: '99',
            docpagvc: [
              {
                VALOR: 350.99,
                DATAVENC: '2015-08-23',
                categoria: {
                  id: '888',
                  DESCEVENTO: 'Category 888'
                }
              }
            ]
          },
          ClassificaçãoCad: [
            {
              Classe: 'Fornecedor',
              quitado: 'Z'
            }
          ]
        }
        cadAtivo
          .create(marianne, {toPlainObject: true, schema: 'public'})
          .then(function (record) {
            expect(record.id).to.exist
            expect(record).to.not.have.property('save')
            expect(record.IDENT).to.be.null
            expect(record.DATNASC).to.be.a(
              cadAtivo.db.dialect === 'mssql' ? 'date' : 'string'
            )

            expect(record.fornecedor.id).to.exist
            expect(record.fornecedor).to.not.have.property('save')
            expect(record.fornecedor.INSCEST).to.be.null
            expect(record.fornecedor.TIPOCONTA).to.equal('1')

            expect(record.fornecedor.docpagvc[0].id).to.exist
            expect(
              record.fornecedor.docpagvc[0]
            ).to.not.have.property('save')
            expect(record.fornecedor.docpagvc[0].DATAPGTO).to.be.null
            expect(record.fornecedor.docpagvc[0].DATAVENC).to.be.a(
              cadAtivo.db.dialect === 'mssql' ? 'date' : 'string'
            )
            expect(record.fornecedor.docpagvc[0].SITPGTO).to.equal(
              'P'
            )

            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.exist
            expect(
              record.fornecedor.docpagvc[0].categoria
            ).to.not.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].categoria.NATUREZA
            ).to.equal('D')

            expect(record.ClassificaçãoCad[0].NUMCAD).to.exist
            expect(record.ClassificaçãoCad[0]).to.not.have.property(
              'save'
            )
            expect(record.ClassificaçãoCad[0].quitado).to.equal('Z')

            marianne = record

            done()
          })
          .catch(logError(done))
      })
      it('Will return a plain object after update', function (done) {
        marianne.fornecedor.SIGLAFOR = 'Catering'
        cadAtivo
          .update(marianne, null, {
            toPlainObject: true,
            schema: 'public'
          })
          .then(function (record) {
            expect(record.id).to.exist
            expect(record).to.not.have.property('save')
            expect(record.IDENT).to.be.null
            expect(record.DATNASC).to.be.a(
              cadAtivo.db.dialect === 'mssql' ? 'date' : 'string'
            )

            expect(record.fornecedor.id).to.exist
            expect(record.fornecedor).to.not.have.property('save')
            expect(record.fornecedor.INSCEST).to.be.null
            expect(record.fornecedor.TIPOCONTA).to.equal('1')
            expect(record.fornecedor.SIGLAFOR).to.equal('Catering')

            expect(record.fornecedor.docpagvc[0].id).to.exist
            expect(
              record.fornecedor.docpagvc[0]
            ).to.not.have.property('save')
            expect(record.fornecedor.docpagvc[0].DATAPGTO).to.be.null
            expect(record.fornecedor.docpagvc[0].DATAVENC).to.be.a(
              cadAtivo.db.dialect === 'mssql' ? 'date' : 'string'
            )
            expect(record.fornecedor.docpagvc[0].SITPGTO).to.equal(
              'P'
            )

            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.exist
            expect(
              record.fornecedor.docpagvc[0].categoria
            ).to.not.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].categoria.NATUREZA
            ).to.equal('D')

            expect(record.ClassificaçãoCad[0].NUMCAD).to.exist
            expect(record.ClassificaçãoCad[0]).to.not.have.property(
              'save'
            )
            expect(record.ClassificaçãoCad[0].quitado).to.equal('Z')

            done()
          })
          .catch(logError(done))
      })
      it('Will return a plain object after fetch', function (done) {
        cadAtivo
          .fetch(
            {where: {id: marianne.id}},
            {toPlainObject: true, schema: 'public'}
          )
          .then(function (recordset) {
            var record = recordset[0]
            expect(record.id).to.exist
            expect(record).to.not.have.property('save')
            expect(record.IDENT).to.be.undefined
            expect(record.DATNASC).to.be.a('string')

            expect(record.fornecedor.id).to.exist
            expect(record.fornecedor).to.not.have.property('save')
            expect(record.fornecedor.INSCEST).to.be.undefined
            expect(record.fornecedor.TIPOCONTA).to.equal(
              '1-Conta_corrente'
            )
            expect(record.fornecedor.SIGLAFOR).to.equal('Catering')

            expect(record.fornecedor.docpagvc[0].id).to.exist
            expect(
              record.fornecedor.docpagvc[0]
            ).to.not.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].DATAPGTO
            ).to.be.undefined
            expect(record.fornecedor.docpagvc[0].DATAVENC).to.be.a(
              'string'
            )
            expect(record.fornecedor.docpagvc[0].SITPGTO).to.equal(
              'Pendente'
            )

            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.exist
            expect(
              record.fornecedor.docpagvc[0].categoria
            ).to.not.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].categoria.NATUREZA
            ).to.equal('Devedora')

            expect(record.ClassificaçãoCad[0].NUMCAD).to.exist
            expect(record.ClassificaçãoCad[0]).to.not.have.property(
              'save'
            )
            expect(record.ClassificaçãoCad[0].quitado).to.equal('Z')
            return cadAtivo.destroy(
              {
                where: {
                  id: record.id,
                  updatedAt: record.updatedAt
                }
              },
              {schema: 'public'}
            )
          })
          .then(() => done())
          .catch(logError(done))
      })
      var lorraine
      it('Will return a instance after create if you pass a instance, even with toPlainObject true', function (done) {
        lorraine = cadAtivo.createInstance({
          NOMECAD: 'Lorraine',
          DATNASC: '1998-12-31',
          fornecedor: {
            SIGLAFOR: 'Loarraine catering',
            NUMERO: '99',
            docpagvc: [
              {
                VALOR: 350.99,
                DATAVENC: '2015-08-23',
                categoria: {
                  id: '999',
                  DESCEVENTO: 'Category 999'
                }
              }
            ]
          },
          ClassificaçãoCad: [
            {
              Classe: 'Fornecedor'
            }
          ]
        })
        cadAtivo
          .create(lorraine, {toPlainObject: true})
          .then(function (record) {
            expect(record.id).to.exist
            expect(record).to.have.property('save')
            expect(record.IDENT).to.be.undefined
            expect(record.DATNASC).to.be.a('string')

            expect(record.fornecedor.id).to.exist
            expect(record.fornecedor).to.have.property('save')
            expect(record.fornecedor.INSCEST).to.be.undefined
            expect(record.fornecedor.TIPOCONTA).to.equal(
              '1-Conta_corrente'
            )

            expect(record.fornecedor.docpagvc[0].id).to.exist
            expect(record.fornecedor.docpagvc[0]).to.have.property(
              'save'
            )
            expect(
              record.fornecedor.docpagvc[0].DATAPGTO
            ).to.be.undefined
            expect(record.fornecedor.docpagvc[0].DATAVENC).to.be.a(
              'string'
            )
            expect(record.fornecedor.docpagvc[0].SITPGTO).to.equal(
              'Pendente'
            )

            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.exist
            expect(
              record.fornecedor.docpagvc[0].categoria
            ).to.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].categoria.NATUREZA
            ).to.equal('Devedora')

            expect(record.ClassificaçãoCad[0].NUMCAD).to.exist
            expect(record.ClassificaçãoCad[0]).to.have.property(
              'save'
            )
            expect(record.ClassificaçãoCad[0].quitado).to.be.undefined

            lorraine = record

            done()
          })
          .catch(logError(done))
      })
      it('Will return a instance after update if you pass a instance, even with toPlainObject true', function (done) {
        lorraine.fornecedor.SIGLAFOR = 'Catering'
        cadAtivo
          .update(lorraine, null, {toPlainObject: true})
          .then(function (record) {
            expect(record.id).to.exist
            expect(record).to.have.property('save')
            expect(record.IDENT).to.be.undefined
            expect(record.DATNASC).to.be.a('string')

            expect(record.fornecedor.id).to.exist
            expect(record.fornecedor).to.have.property('save')
            expect(record.fornecedor.INSCEST).to.be.undefined
            expect(record.fornecedor.TIPOCONTA).to.equal(
              '1-Conta_corrente'
            )
            expect(record.fornecedor.SIGLAFOR).to.equal('Catering')

            expect(record.fornecedor.docpagvc[0].id).to.exist
            expect(record.fornecedor.docpagvc[0]).to.have.property(
              'save'
            )
            expect(
              record.fornecedor.docpagvc[0].DATAPGTO
            ).to.be.undefined
            expect(record.fornecedor.docpagvc[0].DATAVENC).to.be.a(
              'string'
            )
            expect(record.fornecedor.docpagvc[0].SITPGTO).to.equal(
              'Pendente'
            )

            expect(
              record.fornecedor.docpagvc[0].categoria.id
            ).to.exist
            expect(
              record.fornecedor.docpagvc[0].categoria
            ).to.have.property('save')
            expect(
              record.fornecedor.docpagvc[0].categoria.NATUREZA
            ).to.equal('Devedora')

            expect(record.ClassificaçãoCad[0].NUMCAD).to.exist
            expect(record.ClassificaçãoCad[0]).to.have.property(
              'save'
            )
            expect(record.ClassificaçãoCad[0].quitado).to.be.undefined

            lorraine = record

            done()
          })
          .catch(logError(done))
      })
    })

    describe('querying', function () {
      var numberOfRecordsToGenerate = 10
      var minMiliSecsToGenerate = 2000
      it(
        'should create ' +
          numberOfRecordsToGenerate +
          ' records in an minimum time',
        function (done) {
          console.log(
            'Is generating ' +
              numberOfRecordsToGenerate +
              ' entities...'
          )
          var duration = process.hrtime()
          var promise = Promise.resolve()
          var i = 1
          _.times(numberOfRecordsToGenerate, function () {
            var order = i++
            promise = promise.then(function () {
              return cadAtivo.create(
                {
                  NOMECAD: _.padStart(String(order), 3, '00'),
                  NUMERO: 'QRYTST',
                  ESTADO: 'MG',
                  DATNASC: '1999-12-31',
                  DATNASCZ: '1999-12-31T00:00:00Z',
                  DATNASCNOZ: new Date('1999-12-31T19:00:00'),
                  fornecedor: {
                    SIGLAFOR: 'query test',
                    NUMERO: '99',
                    docpagvc: [
                      {
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
                      }
                    ]
                  },
                  ClassificaçãoCad: [
                    {
                      Classe: 'Fornecedor'
                    }
                  ]
                },
                {toPlainObject: true}
              )
            })
          })

          promise
            .then(function () {
              duration = process.hrtime(duration)
              duration = duration[0] * 1000 + duration[1] / 1000000
              expect(duration).to.below(minMiliSecsToGenerate)
              done()
            })
            .catch(done)
        }
      )

      it('should read the records', function (done) {
        cadAtivo
          .fetch({where: {NUMERO: 'QRYTST'}}, {toPlainObject: true})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(
              numberOfRecordsToGenerate
            )
            expect(recordset[0].IDENT).to.be.undefined
            expect(recordset[0]).to.not.have.property('save')
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })

      it('should read the records using like', function (done) {
        cadAtivo
          .fetch({where: {NUMERO: {like: '%YTST'}}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(
              numberOfRecordsToGenerate
            )
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })

      it('should read the records using or', function (done) {
        cadAtivo
          .fetch({
            where: {
              or: [{NUMERO: 'QRYTST'}, {NOMECAD: 'QUALQUER'}]
            }
          })
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(
              numberOfRecordsToGenerate
            )
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })

      it('should create a new related ESTADO', function (done) {
        tableEstados
          .create({
            ESTADO: 'MG',
            NOME: 'Minas'
          })
          .then(function (record) {
            done()
          })
          .catch(logError(done))
      })

      it('should read the 3 records in the expected page showing external description', function (done) {
        cadAtivo
          .fetch(
            {
              where: {
                NUMERO: 'QRYTST'
              },
              limit: 3,
              skip: 3,
              order: ['NOMECAD']
            },
            {
              fetchExternalDescription: true
            }
          )
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(3)
            expect(recordset[0].cadastroEstadoNome).to.equal('Minas')
            expect(recordset[0].Inativo).to.equal('Não')
            expect(recordset[0].fornecedor.RetemCSLL).to.equal('Sim')
            expect(recordset[0].DATNASC).to.equal('1999-12-31')
            expect(recordset[0].DATNASCZ.toISOString()).to.equal(
              '1999-12-31T00:00:00.000Z'
            )
            expect(recordset[0].DATNASCNOZ.toISOString()).to.equal(
              new Date('1999-12-31T19:00:00').toISOString()
            )
            var i = 4
            recordset.map(function (record) {
              expect(i++).to.equal(Number(record.NOMECAD))
            })
            done()
          })
          .catch(function (err) {
            done(err)
          })
      })

      it('should fetch all the records', function (done) {
        cadAtivo
          .fetch()
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.above(0)
            done()
          })
          .catch(logError(done))
      })
    })

    describe('using the entity', function () {
      before(function (done) {
        var sv = sqlView(cadAtivo.db.dialect)
        entityCadAtivo.entityMethod('getExternalData', function () {
          var view = sv.build('Classificação', {
            limit: 1,
            select: 'Nome'
          })
          return this.db.query(view.statement, view.params)
        })
        cadAtivo = entityCadAtivo.new(db)
        done()
      })
      it('should return one record with a column', function (done) {
        cadAtivo
          .getExternalData()
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            recordset[0].should.have.property('Nome')
            done()
          })
          .catch(logError(done))
      })
    })

    describe('null enum and timestamp handling', function () {
      var beth
      before(function (done) {
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
          .then(function (record) {
            beth = record
            entityCadAtivo.setProperties(function (properties) {
              properties.futureEnum.enum = ['Abc', 'Bcd', 'Cde']
            })
            done()
          })
          .catch(logError(done))
      })
      it('should fetch undefined from those later defined enum columns', function (done) {
        cadAtivo
          .fetch({where: {id: beth.id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = (beth = recordset[0])
            expect(record.futureEnum).to.equal(undefined)
            expect(record.destino).to.be.a('array')
            expect(record.destino.length).to.equal(1)
            expect(record.destino[0].futureEnum).to.equal(undefined)
            done()
          })
          .catch(logError(done))
      })
      it('should update destino all alone', function (done) {
        cadAtivo
          .fetch({where: {id: beth.destino[0].id}})
          .then(function (recordset) {
            expect(recordset).to.be.a('array')
            expect(recordset.length).to.equal(1)
            var record = recordset[0]
            record.NUMERO = '14'
            return record.save().then(function () {
              expect(record.updatedAt).to.be.a('date')
              return cadAtivo
                .fetch({where: {id: record.id}})
                .then(function (recordset) {
                  expect(recordset).to.be.a('array')
                  expect(recordset.length).to.equal(1)
                  expect(recordset[0].NUMERO).to.equal('14')
                  done()
                })
            })
          })
          .catch(logError(done))
      })
      it('should be saved as a new record if you hide the foreign key', function (done) {
        var destinoId = beth.destino[0].id
        beth.destino[0].NUMLANORI = undefined
        beth
          .save()
          .then(function () {
            expect(beth.destino[0].id).to.above(destinoId)
            done()
          })
          .catch(logError(done))
      })
      it('should not be saved if you change the the foreign key', function (done) {
        beth.destino[0].NUMLANORI = 0
        beth
          .save()
          .then(function () {
            done(new Error('Invalid record saved'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidData')
            expect(error.message).to.contains(
              'does not match primary key'
            )
            done()
          })
          .catch(logError(done))
      })
      it('should not be saved if you hide the id', function (done) {
        beth.destino[0].NUMLANORI = beth.id
        beth.destino[0].id = undefined
        beth
          .save()
          .then(function () {
            done(
              new Error(
                'Invalid record saved, you cannot use the primary key presence to verify if a record exists'
              )
            )
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('InvalidData')
            expect(error.message).to.contains('has no previous data')
            done()
          })
          .catch(logError(done))
      })
      it('cannot alter the timestamps, updatedAt', function () {
        try {
          beth.updatedAt = new Date()
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid column modified')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal(
            'Column updatedAt cannot be modified'
          )
        }
      })
      it('should not accept an incomplete value', function () {
        try {
          beth.futureEnum = 'A'
          beth.validate()
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid column modified')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal('Invalid value')
        }
      })
      it('should not accept an greater value', function () {
        try {
          beth.futureEnum = 'Abcd'
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid column modified')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal('Invalid value')
        }
      })
      it('should not accept a value not contained in the enum array', function () {
        try {
          beth.futureEnum = 'Abd'
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Invalid column modified')
        } catch (error) {
          error.should.have.property('message')
          expect(error.message).to.equal('Invalid value')
        }
      })
      it('should accept the exact value', function () {
        beth.futureEnum = 'Abc'
        expect(beth.futureEnum).to.equal('Abc')
      })
      it('should accept the exact value considering the max length', function () {
        beth.futureEnum = 'Ab'
        expect(beth.futureEnum).to.equal('Abc')
      })
      it('should delete destino all alone', function (done) {
        beth.destino[0].NUMLANORI = undefined
        beth
          .save()
          .then(function () {
            return cadAtivo
              .fetch({where: {id: beth.destino[0].id}})
              .then(function (recordset) {
                expect(recordset).to.be.a('array')
                expect(recordset.length).to.equal(1)
                var record = recordset[0]
                return record.destroy().then(function () {
                  record.should.have.property('id')
                  expect(record.updatedAt).to.equal(undefined)
                  done()
                })
              })
          })
          .catch(logError(done))
      })
      it('should throw an error when updating beth with destino already deleted', function (done) {
        beth
          .save()
          .then(function () {
            done(new Error('Invalid record updated'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('RecordModifiedOrDeleted')
            expect(error.message).to.contains('not found for update')
            done()
          })
          .catch(logError(done))
      })

      it('should throw an error when deleting beth with destino already deleted', function (done) {
        beth
          .destroy()
          .then(function () {
            done(new Error('Invalid record deletion'))
          })
          .catch(function (error) {
            expect(error.name).to.equal('EntityError')
            expect(error.type).to.equal('RecordModifiedOrDeleted')
            expect(error.message).to.contains('not found for delete')
            done()
          })
          .catch(logError(done))
      })
    })
  })

  describe('Usage example', function () {
    it('Should log the full database columns', function (done) {
      var jse = entity
      var invoiceClass = jse(
        'invoice',
        {
          properties: {
            id: {
              type: 'integer',
              autoIncrement: true,
              primaryKey: true
            },
            client: {
              type: 'string'
            }
          }
        },
        {dialect: db.dialect}
      )
      invoiceClass.hasMany('items', {
        properties: {
          id: {
            type: 'integer',
            autoIncrement: true,
            primaryKey: true
          },
          name: {
            type: 'string'
          },
          description: {
            type: 'string'
          },
          price: {
            type: 'number',
            maxLength: 10,
            decimals: 2
          },
          invoiceId: {
            type: 'integer',
            $ref: 'invoice'
          }
        }
      })
      var invoiceInstance
      var invoice = invoiceClass.new(db)
      invoice
        .createTables() // Will create tables invoice and items
        .then(function () {
          return invoice.syncTables() // Then the reference in items
        })
        .then(function () {
          invoiceInstance = invoice.createInstance({
            client: 'Jessica',
            items: [
              {
                name: 'diamond',
                description: 'a beautiful diamond',
                price: 9999.99
              }
            ]
          })
          return invoiceInstance.save()
        })
        .then(function () {
          // console.log(JSON.stringify(invoiceInstance, null, ' '));
          /* will log
           {
           "id": 1,
           "client": "Jessica",
           "items": [
           {
           "id": 1,
           "name": "diamond",
           "description": "a beautiful diamond",
           "price": 9999.99,
           "invoiceId": 1
           }
           ]
           }
           */
          done()
        })
        .catch(logError(done))
    })
  })
  describe('multiple primary key', function () {
    var plano
    var conta
    var db
    let planoEntity
    let updatedAt

    before(function () {
      db = options.db
      plano = entity('LCBA1', require('./schemas/LCBA1.json'), {
        dialect: db.dialect
      }).useTimestamps()
      planoEntity = plano.new(db)
    })

    it('plano should be created', function (done) {
      planoEntity.createTables().then(() =>
        planoEntity
          .create({
            A01_CODCTA: '1',
            NUMPLC: 0,
            A01_DESCTA: 'test',
            A01_TIPCTA: 'Analítica'
          })
          .then(function (record) {
            conta = record
            expect(conta.id).to.equal(undefined)
            expect(record.updatedAt).to.not.equal(undefined)
            done()
          })
          .catch(function (err) {
            done(err)
          })
      )
    })
    it('it can be fetched', function (done) {
      plano
        .new(db)
        .fetch({
          where: {
            A01_CODCTA: '1',
            NUMPLC: 0,
            updatedAt: conta.updatedAt
          }
        })
        .then(function (recordset) {
          expect(recordset).to.be.a('array')
          expect(recordset.length).to.equal(1)
          done()
        })
        .catch(logError(done))
    })
    it('then can have only one field updated', function (done) {
      plano
        .new(db)
        .update(
          {
            A01_DESCTA: 'test2'
          },
          {
            where: {
              A01_CODCTA: '1',
              NUMPLC: 0,
              updatedAt: conta.updatedAt
            }
          }
        )
        .then(function (record) {
          expect(record.A01_DESCTA).equal('test2')
          updatedAt = record.updatedAt
          done()
        })
        .catch(logError(done))
    })
    it('even when updated at is not informed you can update', function (done) {
      plano
        .new(db)
        .update(
          {
            A01_DESCTA: 'test222'
          },
          {
            where: {
              A01_CODCTA: '1',
              NUMPLC: 0
            }
          }
        )
        .then(function (record) {
          expect(record.A01_DESCTA).equal('test222')
          updatedAt = record.updatedAt
          done()
        })
        .catch(logError(done))
    })
    it('and finally deleted', function (done) {
      plano
        .new(db)
        .destroy({
          where: {
            A01_CODCTA: '1',
            NUMPLC: 0,
            updatedAt
          }
        })
        .then(function (record) {
          expect(record).to.equal(undefined)
          done()
        })
        .catch(logError(done))
    })
  })
}
