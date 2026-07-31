'use strict'

/* eslint no-undef:0 */

const assert = require('assert')

const entity = require('../src')
const postgresAdapter = require('../src/adapters/postgres')
const mssqlAdapter = require('../src/adapters/mssql')

// `options.schema` is the only identifier the library takes from the caller
// at request time instead of reading it from the entity definition, and it
// used to be interpolated bare - no quoting, no validation - at six sites:
// the fetch FROM clause (adapters/postgres buildQuery), the INSERT, UPDATE
// and DELETE commands (adapters/common, postgres only) and the
// createTimestamps lookup of both dialects, where it lands inside a
// single-quoted literal. All six were driven to a real breach against live
// engines: a fetch returning attacker-authored rows, an INSERT/UPDATE/DELETE
// retargeted at another table, and DDL executed through the lookup query.
//
// It cannot be parameterized (it is an identifier) and it cannot be quoted
// either: it is emitted bare today, so postgres case-folds it, and quoting
// would make every schema name that works today case sensitive. So it is
// validated and rejected instead, exactly as sql-view does for a cast type
// and for the paging values.
module.exports = function (options) {
  describe('schema option', function () {
    const table = 'schema_opt'
    const timestampsTable = 'schema_opt_ts'
    const plainSchema = 'schema_opt_plain'
    // `$` is a legal identifier character in both dialects and real
    // databases in the field carry it (multi instance MSSQL addressing is
    // `instance$name`), so it must round trip. Lower case on purpose: the
    // value is emitted bare and postgres folds it
    const dollarSchema = 'a$b'
    // A DOUBLE `$`, and it must exist at the same time as `a$b`: in a
    // `String.replace` replacement string `$$` is the escape for a literal
    // `$`, so the fetch interpolation done that way turns a schema named
    // `a$$b` into `a$b` - a tenant silently reading another tenant's rows.
    // A single `$` is not a special pattern, so `a$b` alone cannot catch it
    const doubleDollarSchema = 'a$$b'
    let db
    let isPg
    let adapter
    let entityTable
    let data // a hand built definition, to drive the adapter directly

    const rows = res =>
      res.length !== undefined ? res : res.recordset
    const read = sql => db.query(sql).then(rows)
    const run = statements =>
      statements.reduce(
        (promise, sql) => promise.then(() => db.execute(sql)),
        Promise.resolve()
      )

    // the schema qualification a raw fixture query needs, per dialect
    const qualify = schema => (isPg ? `"${schema}".` : `[${schema}].`)
    const defaultSchema = () => (isPg ? 'public' : 'dbo')

    const hostile = {
      // proven breaches on the unfixed code, not merely odd strings
      fetch:
        "(SELECT 999 AS id, 'pwned' AS name) AS x WHERE 1=1" +
        ' UNION ALL SELECT "id","name" FROM "public"',
      create:
        '"public"."schema_opt" ("id","name") VALUES ($1,$2)' +
        ' RETURNING * --',
      update:
        '"public"."schema_opt" SET "name"=$2 WHERE "id"=$3 AND "id"=$1' +
        ' RETURNING * --',
      destroy: '"public"."schema_opt" WHERE "id"=$1 RETURNING * --',
      timestamps: "public'; CREATE TABLE schema_opt_pwned (x int); --"
    }

    const drops = () =>
      isPg
        ? [
            'DROP TABLE IF EXISTS "schema_opt_pwned"',
            'DROP TABLE IF EXISTS "schema_opt"',
            'DROP TABLE IF EXISTS "schema_opt_ts"',
            'DROP SCHEMA IF EXISTS "schema_opt_plain" CASCADE',
            'DROP SCHEMA IF EXISTS "a$b" CASCADE',
            'DROP SCHEMA IF EXISTS "a$$b" CASCADE'
          ]
        : [
            'DROP TABLE IF EXISTS [schema_opt_pwned]',
            'DROP TABLE IF EXISTS [schema_opt_ts]',
            'DROP TABLE IF EXISTS [a$b].[schema_opt_ts]',
            'DROP SCHEMA IF EXISTS [a$b]'
          ]

    before(function () {
      db = options.db
      isPg = db.dialect === 'postgres'
      adapter = isPg ? postgresAdapter() : mssqlAdapter()
      adapter.db = db
      // dropped first so a dirty server - or a previous red run that let a
      // breach through - cannot poison this one
      return run(drops())
        .then(function () {
          return run(
            isPg
              ? [
                  'CREATE SCHEMA "schema_opt_plain"',
                  'CREATE SCHEMA "a$b"',
                  'CREATE SCHEMA "a$$b"',
                  'CREATE TABLE "schema_opt" ("id" integer primary key,' +
                    ' "name" text)',
                  'CREATE TABLE "schema_opt_plain"."schema_opt"' +
                    ' ("id" integer primary key, "name" text)',
                  'CREATE TABLE "a$b"."schema_opt"' +
                    ' ("id" integer primary key, "name" text)',
                  'CREATE TABLE "a$$b"."schema_opt"' +
                    ' ("id" integer primary key, "name" text)',
                  'CREATE TABLE "schema_opt_ts" ("id" integer)',
                  'CREATE TABLE "a$b"."schema_opt_ts" ("id" integer,' +
                    ' "updated_at" timestamp(3) with time zone)'
                ]
              : [
                  'CREATE SCHEMA [a$b]',
                  'CREATE TABLE [schema_opt_ts] ([id] int)',
                  'CREATE TABLE [a$b].[schema_opt_ts] ([id] int,' +
                    ' [updated_at] datetime2(3))'
                ]
          )
        })
        .then(function () {
          if (!isPg) {
            return
          }
          // seeded positionally, so the fixture does not depend on the
          // code under test. One row per schema, all different: a fetch
          // that ignored the schema would bring back the wrong one
          return run([
            'INSERT INTO "schema_opt" VALUES (1,\'public-row\')',
            'INSERT INTO "schema_opt_plain"."schema_opt"' +
              " VALUES (2,'plain-row')",
            'INSERT INTO "a$b"."schema_opt"' +
              " VALUES (3,'dollar-row')",
            'INSERT INTO "a$$b"."schema_opt"' +
              " VALUES (4,'double-dollar-row')"
          ])
        })
        .then(function () {
          if (!isPg) {
            return
          }
          entityTable = entity(
            table,
            {
              properties: {
                id: {type: 'integer', primaryKey: true},
                name: {type: 'string', maxLength: 50}
              }
            },
            {dialect: db.dialect}
          ).new(db)
          // The entity api fetches the record before updating or
          // destroying it, and that fetch carries the same options.schema,
          // so the fetch guard would fire first and the update/destroy
          // guards would be proven by nothing. They are driven through the
          // adapter directly - the same surface adapter-wrap-spec uses for
          // createTimestamps - so each guard is individually load bearing
          data = {
            key: table,
            identity: {name: table},
            properties: {
              id: {type: 'integer', primaryKey: true},
              name: {type: 'string', maxLength: 50}
            },
            primaryKeyFields: ['id'],
            primaryKeyAttributes: ['id']
          }
          adapter.buildInsertCommand(data)
          adapter.buildUpdateCommand(data)
          adapter.buildDeleteCommand(data)
        })
    })

    after(function () {
      return run(drops())
    })

    // a thunk, not a promise: the guard throws where the value is used, so
    // the adapter functions called directly throw synchronously while the
    // entity api - which wraps everything in a promise - rejects
    const rejects = call =>
      Promise.resolve()
        .then(call)
        .then(
          function (result) {
            throw new Error(
              'The hostile schema was accepted: ' +
                JSON.stringify(result)
            )
          },
          function (error) {
            assert.ok(
              /Invalid schema/.test(error.message),
              'Rejected with an unexpected error: ' + error.message
            )
          }
        )

    it('should reject a hostile schema on fetch', function () {
      // mssql does not interpolate options.schema in its query builder,
      // so there is nothing to guard on that dialect
      if (!isPg) {
        return this.skip()
      }
      return rejects(() =>
        entityTable.fetch({}, {schema: hostile.fetch})
      )
    })

    it('should reject a hostile schema on create', function () {
      // the INSERT interpolation is gated on the postgres dialect
      if (!isPg) {
        return this.skip()
      }
      return rejects(() =>
        adapter.create({id: 77, name: 'pwned'}, data, {
          schema: hostile.create
        })
      )
    })

    it('should reject a hostile schema on update', function () {
      // the UPDATE interpolation is gated on the postgres dialect
      if (!isPg) {
        return this.skip()
      }
      return rejects(() =>
        adapter.update({id: 1, name: 'pwned'}, data, {
          where: {id: 1},
          schema: hostile.update
        })
      )
    })

    it('should reject a hostile schema on destroy', function () {
      // the DELETE interpolation is gated on the postgres dialect
      if (!isPg) {
        return this.skip()
      }
      return rejects(() =>
        adapter.destroy(data, {
          where: {id: 1},
          schema: hostile.destroy
        })
      )
    })

    it('should reject a hostile schema on createTimestamps', function () {
      return rejects(() =>
        adapter.createTimestamps(
          {identity: {name: timestampsTable}, timestamps: true},
          {schema: hostile.timestamps}
        )
      )
        .then(function () {
          // the payload closes the literal and appends a CREATE TABLE
          return read(
            'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS' +
              " WHERE TABLE_NAME='schema_opt_pwned'"
          )
        })
        .then(function (recordset) {
          assert.strictEqual(recordset.length, 0)
        })
    })

    // Positive controls. Every one of them passes a schema through the
    // guard on the way to a real engine, so if the accepted class lost `$`
    // the `a$b` ones would throw 'Invalid schema' before reaching their
    // assertion and fail - that is how this spec pins `$` as allowed
    describe('accepts a legitimate schema', function () {
      it('should fetch from a plain schema', function () {
        if (!isPg) {
          return this.skip()
        }
        return entityTable
          .fetch({}, {schema: plainSchema})
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 1)
            // the row of the plain schema, not the one of the default
            // schema: the option really binds
            assert.strictEqual(recordset[0].name, 'plain-row')
          })
      })

      it('should fetch from a schema named with a dollar sign', function () {
        if (!isPg) {
          return this.skip()
        }
        return entityTable
          .fetch({}, {schema: dollarSchema})
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 1)
            assert.strictEqual(recordset[0].name, 'dollar-row')
          })
      })

      // `a$b` exists too, holding a different row, so this is not just a
      // "does it run" test: interpolating the schema through a replacement
      // STRING collapses the `$$` and this fetch quietly reads `a$b`
      it('should fetch from a schema named with two dollar signs', function () {
        if (!isPg) {
          return this.skip()
        }
        return entityTable
          .fetch({}, {schema: doubleDollarSchema})
          .then(function (recordset) {
            assert.strictEqual(recordset.length, 1)
            assert.strictEqual(recordset[0].name, 'double-dollar-row')
          })
      })

      it('should create, update and destroy in a schema named with a dollar sign', function () {
        if (!isPg) {
          return this.skip()
        }
        return entityTable
          .create(
            {id: 4, name: 'dollar-created'},
            {schema: dollarSchema}
          )
          .then(function () {
            return read(
              'SELECT "id","name" FROM ' +
                qualify(dollarSchema) +
                '"schema_opt" ORDER BY "id"'
            )
          })
          .then(function (recordset) {
            assert.deepStrictEqual(
              recordset.map(record => record.name),
              ['dollar-row', 'dollar-created']
            )
            return entityTable.update(
              {id: 4, name: 'dollar-updated'},
              {where: {id: 4}},
              {schema: dollarSchema}
            )
          })
          .then(function () {
            return read(
              'SELECT "name" FROM ' +
                qualify(dollarSchema) +
                '"schema_opt" WHERE "id"=4'
            )
          })
          .then(function (recordset) {
            assert.strictEqual(recordset[0].name, 'dollar-updated')
            return entityTable.destroy(
              {where: {id: 4}},
              {schema: dollarSchema}
            )
          })
          .then(function () {
            return read(
              'SELECT "id" FROM ' +
                qualify(dollarSchema) +
                '"schema_opt" ORDER BY "id"'
            )
          })
          .then(function (recordset) {
            assert.deepStrictEqual(
              recordset.map(record => Number(record.id)),
              [3]
            )
            // and the table of the same name in the default schema was
            // never touched
            return read(
              'SELECT "id","name" FROM "schema_opt" ORDER BY "id"'
            )
          })
          .then(function (recordset) {
            assert.deepStrictEqual(
              recordset.map(record => record.name),
              ['public-row']
            )
          })
      })

      const hasUpdatedAt = schema =>
        read(
          'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
            `TABLE_NAME='${timestampsTable}' AND TABLE_SCHEMA='${schema}'` +
            " AND COLUMN_NAME='updated_at'"
        ).then(recordset => recordset.length === 1)

      it('should look up the timestamps column in a schema named with a dollar sign', function () {
        // the table exists in both schemas, but only the one in `a$b`
        // already has the column: finding it there is what proves the
        // value reached the lookup, and not altering the other one is
        // what proves it was not read from the default schema
        return adapter
          .createTimestamps(
            {identity: {name: timestampsTable}, timestamps: true},
            {schema: dollarSchema}
          )
          .then(function () {
            return hasUpdatedAt(defaultSchema())
          })
          .then(function (found) {
            assert.strictEqual(found, false)
          })
      })

      it('should add the timestamps column through a plain schema', function () {
        return adapter
          .createTimestamps(
            {identity: {name: timestampsTable}, timestamps: true},
            {schema: defaultSchema()}
          )
          .then(function () {
            return hasUpdatedAt(defaultSchema())
          })
          .then(function (found) {
            assert.strictEqual(found, true)
          })
      })
    })
  })
}
