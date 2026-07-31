'use strict'

/* eslint no-undef:0 */

const assert = require('assert')

const entity = require('../src')
const postgresAdapter = require('../src/adapters/postgres')
const mssqlAdapter = require('../src/adapters/mssql')

// Every identifier the adapters emit goes through `wrap`, and `wrap` sits on
// the hot request path: the fetch column list (postgres buildQuery) and the
// INSERT/UPDATE/DELETE column and key lists both dialects share
// (adapters/common). It used to interpolate the identifier into "..." /
// [...] with no escaping at all, so a name carrying the closing delimiter
// ended the identifier early and whatever followed ran as SQL - the same
// hole sql-view had before 7.2.6, and the same fix: double the closing
// delimiter.
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

    // The full round trip through the public entity api. Postgres only: on
    // mssql the adapter still concatenates raw brackets when it builds the
    // fetch column list and the returning SELECT of its insert/update
    // commands (mssql.js buildQuery/buildInsertCommand/buildUpdateCommand),
    // so `SELECT [we]ird] AS [weird]` breaks before wrap is reached. Those
    // concatenations are a separate change; once they escape too, drop the
    // guard below and this suite covers both dialects.
    describe('through the entity api', function () {
      let entityTable

      before(function () {
        if (!isPg) {
          return this.skip()
        }
        return db
          .execute(
            'CREATE TABLE "wrap_entity" ("id" integer primary key,' +
              ' "we""ird" text, "decoy" text)'
          )
          .then(function () {
            const def = entity('wrap_entity', {
              properties: {
                id: {type: 'integer', primaryKey: true},
                weird: {type: 'string', maxLength: 50, field: 'we"ird'},
                decoy: {type: 'string', maxLength: 50}
              }
            })
            def.setDialect(db.dialect)
            entityTable = def.new(db)
          })
      })

      after(function () {
        if (!isPg) {
          return
        }
        return db.execute('DROP TABLE "wrap_entity"')
      })

      it('should create a record in a column named with a quote', function () {
        return entityTable
          .create({id: 1, weird: 'target-A', decoy: 'decoy-A'})
          .then(function (created) {
            assert.strictEqual(created.weird, 'target-A')
            assert.strictEqual(created.decoy, 'decoy-A')
          })
      })

      it('should fetch the column named with a quote', function () {
        return entityTable
          .fetch({where: {id: 1}})
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 1)
            assert.strictEqual(recordset[0].weird, 'target-A')
            // the decoy column must not have been resolved in its place
            assert.strictEqual(recordset[0].decoy, 'decoy-A')
          })
      })

      it('should update the column named with a quote', function () {
        return entityTable
          .update(
            {id: 1, weird: 'target-B', decoy: 'decoy-A'},
            {where: {id: 1}}
          )
          .then(function () {
            return entityTable.fetch({where: {id: 1}})
          })
          .then(function (recordset) {
            assert.strictEqual(recordset[0].weird, 'target-B')
            assert.strictEqual(recordset[0].decoy, 'decoy-A')
          })
      })

      it('should destroy the record', function () {
        return entityTable
          .destroy(1)
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
