'use strict'

/* eslint no-undef:0 */

const assert = require('assert')

const entity = require('../src')

// Round trip for the hasMany association search: a where criteria
// {<association>: {search: '<text>'}} becomes a correlated EXISTS over
// the child table, joining the lookup table of every searchable
// property that carries a display.
//
// The parent primary key is deliberately the property `id` stored in
// the column `numint`: the outer where is applied to the derived table
// built by buildQuery, where only the ALIAS exists, so correlating by
// the field would not even compile here.
//
// The search text arrives already normalized - lower case, no accents -
// which is what the postgres side folds the column to; mssql compares
// with a plain LIKE on a case insensitive database.
module.exports = function (options, dialect) {
  describe('search in a hasMany association', function () {
    let db
    let docpag
    let docpagNumeric

    before(function () {
      db = options.db
      const isPostgres = db.dialect === 'postgres'
      const createTables = [
        isPostgres
          ? 'CREATE TABLE assoc_parent (numint integer primary key,' +
            ' nome varchar(30))'
          : 'CREATE TABLE assoc_parent (numint int primary key,' +
            ' nome varchar(30))',
        isPostgres
          ? 'CREATE TABLE assoc_child (id integer primary key,' +
            ' numdoc integer, historico varchar(60),' +
            ' contacc varchar(20))'
          : 'CREATE TABLE assoc_child (id int primary key,' +
            ' numdoc int, historico varchar(60),' +
            ' contacc varchar(20))',
        'CREATE TABLE assoc_lookup (codigo varchar(20) primary key,' +
          ' descricao varchar(60))'
      ]
      let promise = Promise.resolve()
      createTables.forEach(function (command) {
        promise = promise.then(() => db.execute(command))
      })
      if (isPostgres) {
        // the accent folding the adapter emits: sql-view already
        // hardcodes public.f_unaccent for its :ai decoration
        promise = promise
          .then(() =>
            db.execute('CREATE EXTENSION IF NOT EXISTS unaccent')
          )
          .then(() =>
            db.execute(
              'CREATE OR REPLACE FUNCTION public.f_unaccent(txt text)' +
                ' RETURNS text AS $func$' +
                " SELECT public.unaccent('public.unaccent', txt)" +
                ' $func$ LANGUAGE sql IMMUTABLE'
            )
          )
      }
      // the fourth parent has NO child on purpose: it is the one an
      // empty search silently drops, as LIKE '%%' still requires a
      // child row with a non null searchable column
      const rows = [
        [1, 'first'],
        [2, 'second'],
        [3, 'third'],
        [4, 'fourth']
      ]
      rows.forEach(function (row) {
        promise = promise.then(() =>
          db.execute(
            'INSERT INTO assoc_parent (numint, nome) VALUES ($1, $2)',
            row
          )
        )
      })
      const lookups = [
        ['A', 'Escritorio Central'],
        ['B', 'Deposito'],
        ['C', 'Filial Norte']
      ]
      lookups.forEach(function (row) {
        promise = promise.then(() =>
          db.execute(
            'INSERT INTO assoc_lookup (codigo, descricao)' +
              ' VALUES ($1, $2)',
            row
          )
        )
      })
      const children = [
        [1, 1, 'Pagamento de energia', 'A'],
        [2, 2, 'Compra de material', 'B'],
        [3, 3, 'Serviço prestado', 'C'],
        [4, 3, 'Pagamento de água', 'A']
      ]
      children.forEach(function (row) {
        promise = promise.then(() =>
          db.execute(
            'INSERT INTO assoc_child (id, numdoc, historico,' +
              ' contacc) VALUES ($1, $2, $3, $4)',
            row
          )
        )
      })
      // a definition mutates the schema it is given, so each one is
      // built from its own
      const define = searchable => {
        const def = entity('assoc_parent', {
          properties: {
            id: {
              type: 'integer',
              primaryKey: true,
              field: 'numint'
            },
            nome: {type: 'string', maxLength: 30}
          }
        })
        def.setDialect(db.dialect)
        def
          .hasMany(
            'assoc_child as CLASSIFICACAO',
            {
              properties: {
                id: {type: 'integer', primaryKey: true},
                numdoc: {type: 'integer'},
                historico: {type: 'string', maxLength: 60},
                contacc: {
                  type: 'string',
                  maxLength: 20,
                  display: 'assoc_lookup.descricao',
                  schema: {$ref: 'assoc_lookup', key: 'codigo'}
                }
              }
            },
            {searchable: searchable}
          )
          .foreignKey('numdoc')
        return def.new(db)
      }
      return promise.then(function () {
        docpag = define(['historico', 'contacc'])
        // an integer column: postgres has no f_unaccent(integer), so
        // without the cast the query errors instead of matching
        docpagNumeric = define(['numdoc'])
      })
    })

    after(function () {
      return db
        .execute('DROP TABLE assoc_child')
        .then(() => db.execute('DROP TABLE assoc_lookup'))
        .then(() => db.execute('DROP TABLE assoc_parent'))
    })

    // sorted: the fetch has no order, only the row set is asserted
    const namesOf = criteria =>
      docpag
        .fetch({where: criteria})
        .then(recordset =>
          recordset.map(record => record.nome).sort()
        )

    it('should find the parent by a plain child column', function () {
      return namesOf({CLASSIFICACAO: {search: 'energia'}}).then(
        function (names) {
          assert.deepStrictEqual(names, ['first'])
        }
      )
    })

    it('should find the parent by the description of a lookup', function () {
      return namesOf({CLASSIFICACAO: {search: 'central'}}).then(
        function (names) {
          // lookup A is used by the children of 1 and 3
          assert.deepStrictEqual(names, ['first', 'third'])
        }
      )
    })

    it('should find the parent inside an or', function () {
      return namesOf({
        or: [{CLASSIFICACAO: {search: 'deposito'}}]
      }).then(function (names) {
        assert.deepStrictEqual(names, ['second'])
      })
    })

    // Only postgres folds: the adapter wraps the column in
    // lower(public.f_unaccent(...)) and the caller passes the text
    // already normalized. On mssql the match depends on the database
    // collation alone, so this is not a cross dialect expectation
    if (dialect === 'postgres') {
      it('should match an accented column with plain text', function () {
        return namesOf({CLASSIFICACAO: {search: 'agua'}}).then(
          function (names) {
            // the row is 'Pagamento de água', of the third parent
            assert.deepStrictEqual(names, ['third'])
          }
        )
      })

      it('should match a cedilla column with plain text', function () {
        return namesOf({CLASSIFICACAO: {search: 'servico'}}).then(
          function (names) {
            // the row is 'Serviço prestado', of the third parent
            assert.deepStrictEqual(names, ['third'])
          }
        )
      })
    }

    it('should return nothing when no child matches', function () {
      return namesOf({CLASSIFICACAO: {search: 'zzz'}}).then(
        function (names) {
          assert.deepStrictEqual(names, [])
        }
      )
    })

    it('should combine the search with another criterion', function () {
      return namesOf({
        nome: 'third',
        CLASSIFICACAO: {search: 'pagamento'}
      }).then(function (names) {
        assert.deepStrictEqual(names, ['third'])
      })
    })

    it('should still fetch the children of the matched parent', function () {
      return docpag
        .fetch({where: {CLASSIFICACAO: {search: 'energia'}}})
        .then(function (recordset) {
          assert.strictEqual(recordset.length, 1)
          assert.strictEqual(
            recordset[0].CLASSIFICACAO.length,
            1,
            'the children should still be fetched'
          )
        })
    })

    // the fourth parent has no child at all: it is in the row set
    // with no criteria and it is the one an empty search would drop
    it('should return every parent when there is no criteria', function () {
      return docpag.fetch().then(function (recordset) {
        assert.deepStrictEqual(
          recordset.map(record => record.nome).sort(),
          ['first', 'fourth', 'second', 'third']
        )
      })
    })

    it('should refuse an empty search instead of filtering', function () {
      return docpag
        .fetch({where: {CLASSIFICACAO: {search: ''}}})
        .then(function () {
          throw new Error('Should not have fetched')
        })
        .catch(function (error) {
          assert.strictEqual(
            error.message,
            'Invalid search value for: CLASSIFICACAO'
          )
        })
    })

    it('should refuse a blank search instead of filtering', function () {
      return docpag
        .fetch({where: {CLASSIFICACAO: {search: '  '}}})
        .then(function () {
          throw new Error('Should not have fetched')
        })
        .catch(function (error) {
          assert.strictEqual(
            error.message,
            'Invalid search value for: CLASSIFICACAO'
          )
        })
    })

    // an integer searchable column: postgres needs the cast to text
    // before folding, mssql converts it implicitly
    it('should search a non text column', function () {
      return docpagNumeric
        .fetch({where: {CLASSIFICACAO: {search: '2'}}})
        .then(function (recordset) {
          assert.deepStrictEqual(
            recordset.map(record => record.nome).sort(),
            ['second']
          )
        })
    })

    it('should refuse a search in an association not declared', function () {
      return docpag
        .fetch({where: {nome: {search: 'x'}}})
        .then(function () {
          throw new Error('Should not have fetched')
        })
        .catch(function (error) {
          assert.strictEqual(
            error.message,
            'Invalid search association: nome'
          )
        })
    })
  })
}
