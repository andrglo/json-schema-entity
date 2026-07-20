'use strict'

/* eslint no-undef:0 */

const assert = require('assert')

const entity = require('../src')

// An `enum` property is truncated to maxLength before binding: the enum lists
// human-readable labels ('Não'/'Sim') while the column stores just the leading
// character ('N'/'S'). That truncation used to run unconditionally, so an
// explicit null — a caller asking to store SQL NULL — threw
// "Cannot read properties of null (reading 'substr')" and aborted the whole
// statement.
//
// The path was long unreachable from the habilis web client (its cleared
// selects sent `undefined`, which JSON.stringify drops, so the key never
// arrived), which is why it survived. Any client that sends
// `{"someEnumColumn": null}` to clear a column hits it — on INSERT and UPDATE
// alike, since both adapters share this code.
module.exports = function (options) {
  describe('explicit null for an enum property', function () {
    let db
    let table

    // Asserted with raw SQL throughout, not fetch(): jse's clearNulls()
    // DELETES null-valued keys from a fetched record, so fetch() reports
    // `undefined` for a NULL column and cannot tell NULL apart from ''.
    const situacaoOf = id =>
      db
        .query('SELECT situacao FROM enum_null WHERE id = ' + id)
        .then(res => (res.length !== undefined ? res : res.recordset)[0].situacao)

    before(function () {
      db = options.db
      const createTable =
        db.dialect === 'postgres'
          ? 'CREATE TABLE enum_null ' +
            '(id integer primary key, situacao varchar(1), nome varchar(30))'
          : 'CREATE TABLE enum_null ' +
            '(id int primary key, situacao varchar(1), nome varchar(30))'
      return db.execute(createTable).then(function () {
        const def = entity('enum_null', {
          properties: {
            id: {type: 'integer', primaryKey: true},
            situacao: {
              type: 'string',
              maxLength: 1,
              enum: ['Não', 'Sim']
            },
            nome: {type: 'string', maxLength: 30}
          }
        })
        def.setDialect(db.dialect)
        table = def.new(db)
      })
    })

    after(function () {
      return db.execute('DROP TABLE enum_null')
    })

    it('should truncate an enum label to maxLength on insert', function () {
      return table
        .create({id: 1, situacao: 'Sim', nome: 'first'})
        .then(() => situacaoOf(1))
        .then(function (situacao) {
          assert.strictEqual(situacao, 'S')
        })
    })

    it('should update an enum property to null instead of throwing', function () {
      return table
        .update({id: 1, situacao: null, nome: 'first'}, {where: {id: 1}})
        .then(() => situacaoOf(1))
        .then(function (situacao) {
          assert.strictEqual(
            situacao,
            null,
            'the enum column should be SQL NULL, not an empty string'
          )
        })
    })

    it('should insert a record with a null enum property', function () {
      return table
        .create({id: 2, situacao: null, nome: 'second'})
        .then(() => situacaoOf(2))
        .then(function (situacao) {
          assert.strictEqual(situacao, null)
        })
    })

    it('should still truncate on a later update', function () {
      return table
        .update({id: 1, situacao: 'Não', nome: 'first'}, {where: {id: 1}})
        .then(() => situacaoOf(1))
        .then(function (situacao) {
          assert.strictEqual(situacao, 'N')
        })
    })
  })
}
