const PgCrLayer = require('pg-cr-layer')
const MssqlCrLayer = require('mssql-cr-layer')

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

const mssqlConfig = {
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD,
  database: 'master',
  host: process.env.MSSQL_HOST || 'localhost',
  port: process.env.MSSQL_PORT || 1433,
  pool: {
    max: 10,
    idleTimeout: 30000
  }
}
const mssql = new MssqlCrLayer(mssqlConfig)

const databaseName = 'test-json-schema-entity'
const pgDatabaseName = process.env.POSTGRES_DATABASE || databaseName
const mssqlDatabaseName = process.env.MSSQL_DATABASE || databaseName

function createPostgresDb(dbName) {
  return pg
      .execute('DROP DATABASE IF EXISTS "' + dbName + '";')
      .then(function() {
        return pg.execute('CREATE DATABASE "' + dbName + '"')
      })
}

function createMssqlDb(dbName) {
  return mssql.execute(
      'IF EXISTS(select * from sys.databases where name=\'' +
      dbName +
      '\') DROP DATABASE [' +
      dbName +
      '];' +
      'CREATE DATABASE [' +
      dbName +
      '];'
  )
}

const pgOptions = {}
const mssqlOptions = {}

before(function(done) {
  pg.connect()
      .then(function() {
        return createPostgresDb(pgDatabaseName)
            .then(function() {
              return createPostgresDb(pgDatabaseName + '2')
            })
            .then(function() {
              console.log('Postgres dbs created')
              return pg.close()
            })
            .then(function() {
              console.log('Postgres db creation connection closed')
              pgConfig.database = pgDatabaseName
              console.log('Postgres will connect to', pgConfig.database)
              pgOptions.db = new PgCrLayer(pgConfig)
              pgConfig.database = pgDatabaseName + '2'
              pgOptions.db2 = new PgCrLayer(pgConfig)
              return pgOptions.db.connect()
            })
      })
      .then(function() {
        return mssql.connect().then(function() {
          return createMssqlDb(mssqlDatabaseName)
              .then(function() {
                return createMssqlDb(mssqlDatabaseName + '2')
              })
              .then(function() {
                console.log('Mssql dbs created')
                return mssql.close()
              })
              .then(function() {
                console.log('Mssql db creation connection closed')
                mssqlConfig.database = mssqlDatabaseName
                console.log('Mssql will connect to', mssqlConfig.database)
                mssqlOptions.db = new MssqlCrLayer(mssqlConfig)
                mssqlConfig.database = mssqlDatabaseName + '2'
                mssqlOptions.db2 = new MssqlCrLayer(mssqlConfig)
                return mssqlOptions.db.connect()
              })
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

describe('mssql', function() {
  let duration
  before(function() {
    duration = process.hrtime()
  })
  spec(mssqlOptions)
  after(function() {
    duration = process.hrtime(duration)
    console.info(
        'mssql finished after: %ds %dms',
        duration[0],
        duration[1] / 1000000
    )
  })
})

after(function() {
  if (mssqlOptions.db) {
    mssqlOptions.db.close()
    mssqlOptions.db2.close()
  }
  if (pgOptions.db) {
    pgOptions.db.close()
    pgOptions.db2.close()
  }
})
