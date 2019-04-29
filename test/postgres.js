const PgCrLayer = require('pg-cr-layer')

const spec = require('./spec')

const pgConfig = {
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  pool: {
    max: 10,
    idleTimeout: 30000
  }
}
const pg = new PgCrLayer(pgConfig)

const databaseName = 'test-json-schema-entity'

function createPostgresDb() {
  const dbName = process.env.POSTGRES_DATABASE || databaseName
  return pg
      .execute('DROP DATABASE IF EXISTS "' + dbName + '";')
      .then(function() {
        return pg.execute('CREATE DATABASE "' + dbName + '"')
      })
}

const pgOptions = {}

before(function(done) {
  return pg
      .connect()
      .then(function() {
        return createPostgresDb()
            .then(function() {
              console.log('Postgres db created')
              return pg.close()
            })
            .then(function() {
              console.log('Postgres db creation connection closed')
              pgConfig.database = process.env.POSTGRES_DATABASE || databaseName
              console.log('Postgres will connect to', pgConfig.database)
              pgOptions.db = new PgCrLayer(pgConfig)
              return pgOptions.db.connect()
            })
      })
      .then(function() {
        done()
      })
      .catch(function(error) {
        done(error)
      })
})

describe('postgres', function() {
  let duration
  before(function() {
    duration = process.hrtime()
  })
  spec(pgOptions)
  after(function() {
    duration = process.hrtime(duration)
    console.info(
        'postgres finished after: %ds %dms',
        duration[0],
        duration[1] / 1000000
    )
  })
})

after(function() {
  pgOptions.db.close()
})
