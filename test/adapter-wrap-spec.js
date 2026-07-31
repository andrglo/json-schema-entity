'use strict'

/* eslint no-undef:0 */

const assert = require('assert')
const _ = require('lodash')

const entity = require('../src')
const postgresAdapter = require('../src/adapters/postgres')
const mssqlAdapter = require('../src/adapters/mssql')

// Every identifier the adapters emit goes through `wrap`, and `wrap` sits on
// the hot request path: the fetch column list, and the INSERT/UPDATE/DELETE
// column and key lists both dialects share (adapters/common). It used to
// interpolate the identifier into "..." / [...] with no escaping at all, so
// a name carrying the closing delimiter ended the identifier early and
// whatever followed ran as SQL - the same hole sql-view had before 7.2.6,
// and the same fix: double the closing delimiter.
//
// Asserted against the real engines, because an identifier that legitimately
// contains the delimiter must WORK, not merely be neutralised.
module.exports = function (options) {
  describe('adapter identifier escaping', function () {
    const table = 'wrap_escaping'
    let db
    let adapter
    let isPg
    let weird // a column name carrying the closing delimiter
    let hostile // a column name trying to break out of the identifier
    let weirdTable

    const rows = res => (res.length !== undefined ? res : res.recordset)
    const read = sql => db.query(sql).then(rows)

    before(function () {
      db = options.db
      isPg = db.dialect === 'postgres'
      adapter = isPg ? postgresAdapter() : mssqlAdapter()
      adapter.db = db
      weird = isPg ? 'we"ird' : 'we]ird'
      hostile = isPg
        ? 'id" IS NOT NULL OR 1=1 OR "id'
        : 'id] IS NOT NULL OR 1=1 OR [id'
      weirdTable = isPg ? 'we"ird_table' : 'we]ird_table'
      return db
        .execute(
          isPg
            ? 'CREATE TABLE "wrap_escaping" ("id" integer primary key,' +
                ' "we""ird" text, "decoy" text)'
            : 'CREATE TABLE [wrap_escaping] ([id] int primary key,' +
                ' [we]]ird] nvarchar(50), [decoy] nvarchar(50))'
        )
        .then(function () {
          // seeded positionally, so the fixture does not depend on the
          // code under test
          return db.execute(
            'INSERT INTO wrap_escaping VALUES' +
              " (1,'target-A','decoy-A'),(2,'target-B','decoy-B')," +
              "(3,'target-A','decoy-C')"
          )
        })
        .then(function () {
          return db.execute(
            isPg
              ? 'CREATE TABLE "we""ird_table" ("id" integer)'
              : 'CREATE TABLE [we]]ird_table] ([id] int)'
          )
        })
    })

    after(function () {
      return db
        .execute(
          isPg ? 'DROP TABLE "wrap_escaping"' : 'DROP TABLE [wrap_escaping]'
        )
        .then(function () {
          return db.execute(
            isPg
              ? 'DROP TABLE "we""ird_table"'
              : 'DROP TABLE [we]]ird_table]'
          )
        })
    })

    it('should keep a plain identifier unchanged', function () {
      return read(
        'SELECT ' +
          adapter.wrap('id') +
          ' FROM ' +
          adapter.wrap(table) +
          ' WHERE ' +
          adapter.wrap('id') +
          '=2'
      ).then(function (recordset) {
        assert.strictEqual(recordset.length, 1)
        assert.strictEqual(Number(recordset[0].id), 2)
      })
    })

    it('should read the rows of a column named with the delimiter', function () {
      return read(
        'SELECT ' +
          adapter.wrap('id') +
          ' FROM ' +
          adapter.wrap(table) +
          ' WHERE ' +
          adapter.wrap(weird) +
          "='target-A' ORDER BY " +
          adapter.wrap('id')
      ).then(function (recordset) {
        assert.deepStrictEqual(
          recordset.map(record => Number(record.id)),
          [1, 3]
        )
      })
    })

    it('should not resolve to the decoy column', function () {
      return read(
        'SELECT ' +
          adapter.wrap('id') +
          ' FROM ' +
          adapter.wrap(table) +
          ' WHERE ' +
          adapter.wrap(weird) +
          "='decoy-A'"
      ).then(function (recordset) {
        assert.strictEqual(recordset.length, 0)
      })
    })

    // the column list common.create builds for its INSERT
    it('should insert through a wrapped column list', function () {
      const fields = ['id', weird, 'decoy']
        .map(field => adapter.wrap(field))
        .join(',')
      return db
        .execute(
          'INSERT INTO ' +
            adapter.wrap(table) +
            ' (' +
            fields +
            ") VALUES (4,'target-D','decoy-D')"
        )
        .then(function () {
          return read(
            'SELECT ' +
              adapter.wrap(weird) +
              ' AS w,' +
              adapter.wrap('decoy') +
              ' AS d FROM ' +
              adapter.wrap(table) +
              ' WHERE ' +
              adapter.wrap('id') +
              '=4'
          )
        })
        .then(function (recordset) {
          assert.strictEqual(recordset.length, 1)
          assert.strictEqual(recordset[0].w, 'target-D')
          assert.strictEqual(recordset[0].d, 'decoy-D')
        })
    })

    // the assignment and key lists common.update builds
    it('should update through a wrapped assignment and key', function () {
      return db
        .execute(
          'UPDATE ' +
            adapter.wrap(table) +
            ' SET ' +
            adapter.wrap(weird) +
            "='target-E' WHERE " +
            adapter.wrap('id') +
            '=4'
        )
        .then(function () {
          return read(
            'SELECT ' +
              adapter.wrap(weird) +
              ' AS w,' +
              adapter.wrap('decoy') +
              ' AS d FROM ' +
              adapter.wrap(table) +
              ' WHERE ' +
              adapter.wrap('id') +
              '=4'
          )
        })
        .then(function (recordset) {
          assert.strictEqual(recordset[0].w, 'target-E')
          // the decoy column must not have been written in its place
          assert.strictEqual(recordset[0].d, 'decoy-D')
        })
    })

    // the key list common.destroy builds
    it('should delete through a wrapped where clause', function () {
      return db
        .execute(
          'DELETE FROM ' +
            adapter.wrap(table) +
            ' WHERE ' +
            adapter.wrap(weird) +
            "='target-E'"
        )
        .then(function () {
          return read(
            'SELECT ' +
              adapter.wrap('id') +
              ' FROM ' +
              adapter.wrap(table)
          )
        })
        .then(function (recordset) {
          assert.strictEqual(recordset.length, 3)
        })
    })

    it('should not break out of the identifier', function () {
      return db
        .query(
          'SELECT ' +
            adapter.wrap('id') +
            ' FROM ' +
            adapter.wrap(table) +
            ' WHERE ' +
            adapter.wrap(hostile) +
            '=1'
        )
        .then(
          function (recordset) {
            throw new Error(
              'Broke out of the identifier: ' +
                JSON.stringify(rows(recordset))
            )
          },
          function () {}
        )
    })

    it('should alter a table named with the delimiter', function () {
      return adapter
        .createTimestamps(
          {identity: {name: weirdTable}, timestamps: true},
          {}
        )
        .then(function () {
          return read(
            'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
              "TABLE_NAME='" +
              weirdTable +
              "' AND COLUMN_NAME='updated_at'"
          )
        })
        .then(function (recordset) {
          assert.strictEqual(recordset.length, 1)
        })
    })

    // The full round trip through the public entity api, with EVERY
    // identifier on the fetch/create/update/destroy path carrying the
    // closing delimiter: the table name, the primary key column, a data
    // column, the timestamps column, and a child association - its table,
    // primary key, foreign key, ordered column and association alias. That
    // is what makes the whole adapter conversion non-vacuous: an adapter
    // that still concatenates a raw delimiter anywhere on this path emits
    // SQL the engine rejects.
    describe('through the entity api', function () {
      let entityTable
      let childTable
      let refTable
      let created
      let d

      before(function () {
        d = isPg ? '"' : ']'
        childTable = 'wrap' + d + 'child'
        refTable = 'ref' + d + 'table'
        return db
          .execute(
            isPg
              ? 'CREATE TABLE "wrap""entity" ("id""pk" integer' +
                  ' primary key, "we""ird" text, "decoy" text,' +
                  ' "re""f" integer,' +
                  ' "updated_at""x" timestamp(3) with time zone)'
              : 'CREATE TABLE [wrap]]entity] ([id]]pk] int' +
                  ' primary key, [we]]ird] nvarchar(50),' +
                  ' [decoy] nvarchar(50), [re]]f] int,' +
                  ' [updated_at]]x] datetime2(3))'
          )
          .then(function () {
            return db.execute(
              isPg
                ? 'CREATE TABLE "wrap""child" ("ch""id" integer' +
                    ' primary key, "pa""rent" integer, "tx""t" text)'
                : 'CREATE TABLE [wrap]]child] ([ch]]id] int' +
                    ' primary key, [pa]]rent] int, [tx]]t] nvarchar(50))'
            )
          })
          .then(function () {
            return db.execute(
              isPg
                ? 'CREATE TABLE "ref""table" ("re""key" integer' +
                    ' primary key, "na""me" text)'
                : 'CREATE TABLE [ref]]table] ([re]]key] int' +
                    ' primary key, [na]]me] nvarchar(50))'
            )
          })
          .then(function () {
            // seeded positionally, so the fixture does not depend on
            // the code under test
            return db.execute(
              'INSERT INTO ' +
                (isPg ? '"ref""table"' : '[ref]]table]') +
                " VALUES (7,'referenced-name')"
            )
          })
          .then(function () {
            // the dialect goes in the config, not setDialect: an
            // association built after setDialect keeps the adapter the
            // entity was constructed with
            const def = entity(
              'wrap' + d + 'entity',
              {
                properties: {
                  id: {
                    type: 'integer',
                    primaryKey: true,
                    field: 'id' + d + 'pk'
                  },
                  weird: {type: 'string', maxLength: 50, field: weird},
                  decoy: {type: 'string', maxLength: 50},
                  refId: {
                    type: 'integer',
                    field: 're' + d + 'f',
                    display: refTable + '.na' + d + 'me',
                    schema: {$ref: refTable, key: 're' + d + 'key'}
                  }
                }
              },
              {dialect: db.dialect}
            )
            def.useTimestamps(d + 'x')
            const children = def.hasMany(
              childTable,
              {
                properties: {
                  childId: {
                    type: 'integer',
                    primaryKey: true,
                    field: 'ch' + d + 'id'
                  },
                  parentId: {type: 'integer', field: 'pa' + d + 'rent'},
                  text: {
                    type: 'string',
                    maxLength: 50,
                    field: 'tx' + d + 't'
                  }
                }
              },
              {orderBy: 'text'}
            )
            children.foreignKey('parentId')
            entityTable = def.new(db)
          })
      })

      after(function () {
        return db
          .execute(
            isPg
              ? 'DROP TABLE "wrap""entity"'
              : 'DROP TABLE [wrap]]entity]'
          )
          .then(function () {
            return db.execute(
              isPg
                ? 'DROP TABLE "wrap""child"'
                : 'DROP TABLE [wrap]]child]'
            )
          })
          .then(function () {
            return db.execute(
              isPg
                ? 'DROP TABLE "ref""table"'
                : 'DROP TABLE [ref]]table]'
            )
          })
      })

      it('should create a record and its children', function () {
        return entityTable
          .create({
            id: 1,
            weird: 'target-A',
            decoy: 'decoy-A',
            refId: 7,
            [childTable]: [
              {childId: 10, text: 'kid-b'},
              {childId: 11, text: 'kid-a'}
            ]
          })
          .then(function (record) {
            created = record
            assert.strictEqual(record.weird, 'target-A')
            assert.strictEqual(record.decoy, 'decoy-A')
            assert.notStrictEqual(record.updatedAt, undefined)
            assert.strictEqual(record[childTable].length, 2)
          })
      })

      it('should fetch the record with its ordered children', function () {
        return entityTable
          .fetch({where: {id: 1}})
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 1)
            assert.strictEqual(recordset[0].weird, 'target-A')
            // the decoy column must not have been resolved in its place
            assert.strictEqual(recordset[0].decoy, 'decoy-A')
            assert.notStrictEqual(recordset[0].updatedAt, undefined)
            // ordered by the child column, not by insertion order
            assert.deepStrictEqual(
              recordset[0][childTable].map(child => child.text),
              ['kid-a', 'kid-b']
            )
            assert.strictEqual(
              recordset[0][childTable][0].parentId,
              1
            )
          })
      })

      // the correlated subselect the adapters build for a property that
      // displays a column of a referenced table - every identifier in it
      // (the displayed column, the referenced table and key, the entity
      // alias and the local column) carries the delimiter
      it('should fetch the external description of a reference', function () {
        return entityTable
          .fetch({where: {id: 1}}, {fetchExternalDescription: true})
          .then(function (recordset) {
            const alias = _.camelCase(
              'wrap' + d + 'entity refId na' + d + 'me'
            )
            assert.strictEqual(recordset.length, 1)
            assert.strictEqual(
              recordset[0][alias],
              'referenced-name'
            )
          })
      })

      it('should update the record', function () {
        return entityTable
          .update(
            {
              id: 1,
              weird: 'target-B',
              decoy: 'decoy-A',
              updatedAt: created.updatedAt
            },
            {where: {id: 1, updatedAt: created.updatedAt}}
          )
          .then(function () {
            return entityTable.fetch({where: {id: 1}})
          })
          .then(function (recordset) {
            created = recordset[0]
            assert.strictEqual(recordset[0].weird, 'target-B')
            assert.strictEqual(recordset[0].decoy, 'decoy-A')
          })
      })

      it('should destroy the record', function () {
        return entityTable
          .destroy({where: {id: 1, updatedAt: created.updatedAt}})
          .then(function () {
            return entityTable.fetch({})
          })
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 0)
          })
      })
    })
  })
}
