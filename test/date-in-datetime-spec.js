'use strict'

/* eslint no-undef:0 */

const assert = require('assert')

const entity = require('../src')

// A date-semantics property stored in a datetime/timestamp column —
// the shape left behind by migrations from engines (or engine
// versions) that had no `date` type. Normalization to 'YYYY-MM-DD'
// must not depend on the HOST timezone: node-pg parses `timestamp
// without time zone` as a host-local Date while tedious (useUTC)
// yields a UTC Date, so each adapter supplies the matching inverse
// (plainDate). The naive toISOString() inverse shifted the date one
// day back on PG for hosts east of UTC.
const HOST_TIMEZONES = [
  'America/Sao_Paulo',
  'UTC',
  'America/Manaus',
  'Etc/GMT-1' // fixed UTC+1 — the east-of-UTC case
]

module.exports = function (options) {
  describe('date property stored in a datetime column', function () {
    const originalTZ = process.env.TZ
    let db
    let table

    before(function () {
      db = options.db
      const createTable =
        db.dialect === 'postgres'
          ? 'CREATE TABLE date_in_datetime ' +
            '(id integer primary key, dataemi timestamp)'
          : 'CREATE TABLE date_in_datetime ' +
            '(id int primary key, dataemi datetime)'
      return db
        .execute(createTable)
        .then(function () {
          return db.execute(
            'INSERT INTO date_in_datetime (id, dataemi) ' +
              "VALUES (1, '2026-03-10T00:00:00')"
          )
        })
        .then(function () {
          const def = entity('date_in_datetime', {
            properties: {
              id: {type: 'integer', primaryKey: true},
              dataemi: {type: 'date'}
            }
          })
          def.setDialect(db.dialect)
          table = def.new(db)
        })
    })

    after(function () {
      if (originalTZ === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTZ
      }
      return db.execute('DROP TABLE date_in_datetime')
    })

    HOST_TIMEZONES.forEach(function (timezone) {
      describe('host timezone ' + timezone, function () {
        before(function () {
          process.env.TZ = timezone
        })

        it('fetch returns the stored date', function () {
          return table
            .fetch({where: {id: 1}})
            .then(function (recordset) {
              assert.strictEqual(recordset[0].dataemi, '2026-03-10')
            })
        })

        it('fetch toPlainObject returns the stored date', function () {
          return table
            .fetch({where: {id: 1}}, {toPlainObject: true})
            .then(function (recordset) {
              assert.strictEqual(recordset[0].dataemi, '2026-03-10')
            })
        })

        it('assigning a local Date keeps the local date', function () {
          if (db.dialect !== 'postgres') {
            // mssql keeps the historical UTC inverse — its driver
            // delivers UTC-constructed Dates (tedious useUTC)
            return this.skip()
          }
          const instance = table.createInstance()
          instance.dataemi = new Date(2026, 2, 10)
          assert.strictEqual(instance.dataemi, '2026-03-10')
        })
      })
    })
  })
}
