var gutil = require('gulp-util');
var pretty = require('pretty-hrtime');
var PgCrLayer = require('pg-cr-layer');
var MssqlCrLayer = require('mssql-cr-layer');

var tasks = require('./tasks');
var spec = require('./spec');

var pgConfig = {
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: 'postgres',
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  pool: {
    max: 10,
    idleTimeout: 30000
  }
};
var pg = new PgCrLayer(pgConfig);

var mssqlConfig = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: 'master',
  host: process.env.MSSQL_HOST || 'mssql',
  port: process.env.MSSQL_PORT || 1433,
  pool: {
    max: 10,
    idleTimeout: 30000
  }
};
var mssql = new MssqlCrLayer(mssqlConfig);

var databaseName = 'test-json-schema-entity';
var pgDatabaseName = process.env.POSTGRES_DATABASE || databaseName;
var mssqlDatabaseName = process.env.MSSQL_DATABASE || databaseName;

function createPostgresDb(dbName) {
  return pg.execute(
    'DROP DATABASE IF EXISTS "' + dbName + '";')
    .then(function() {
      return pg.execute('CREATE DATABASE "' + dbName + '"');
    });
}

function createMssqlDb(dbName) {
  return mssql.execute(
    'IF EXISTS(select * from sys.databases where name=\'' +
    dbName + '\') DROP DATABASE [' + dbName + '];' +
    'CREATE DATABASE [' + dbName + '];'
  );
}

var pgOptions = {};
var mssqlOptions = {};

before(function(done) {
  pg.connect()
    .then(function() {
      return createPostgresDb(pgDatabaseName)
        .then(function() {
          return createPostgresDb(pgDatabaseName + '2');
        })
        .then(function() {
          gutil.log('Postgres dbs created');
          return pg.close();
        })
        .then(function() {
          gutil.log('Postgres db creation connection closed');
          pgConfig.database = pgDatabaseName;
          gutil.log('Postgres will connect to', pgConfig.database);
          pgOptions.db = new PgCrLayer(pgConfig);
          pgConfig.database = pgDatabaseName + '2';
          pgOptions.db2 = new PgCrLayer(pgConfig);
          return pgOptions.db.connect();
        });
    })
    .then(function() {
      if (!process.env.CI) {
        return mssql.connect()
          .then(function() {
            return createMssqlDb(mssqlDatabaseName)
              .then(function() {
                return createMssqlDb(mssqlDatabaseName + '2');
              })
              .then(function() {
                gutil.log('Mssql dbs created');
                return mssql.close();
              })
              .then(function() {
                gutil.log('Mssql db creation connection closed');
                mssqlConfig.database = mssqlDatabaseName;
                gutil.log('Mssql will connect to', mssqlConfig.database);
                mssqlOptions.db = new MssqlCrLayer(mssqlConfig);
                mssqlConfig.database = mssqlDatabaseName + '2';
                mssqlOptions.db2 = new MssqlCrLayer(mssqlConfig);
                return mssqlOptions.db.connect();
              });
          });
      }
    })
    .then(function() {
      done();
    })
    .catch(function(error) {
      done(error);
    });
});

describe('postgres', function() {
  var duration;
  before(function() {
    duration = process.hrtime();
  });
  spec(pgOptions);
  after(function() {
    duration = process.hrtime(duration);
    gutil.log('Postgres finished after', gutil.colors.magenta(pretty(duration)));
  });
});

describe('mssql', function() {
  if (process.env.CI) {
    return;
  }
  var duration;
  before(function() {
    duration = process.hrtime();
  });
  spec(mssqlOptions);
  after(function() {
    duration = process.hrtime(duration);
    gutil.log('Mssql finished after', gutil.colors.magenta(pretty(duration)));
  });
});

after(function() {
  if (!process.env.CI) {
    mssqlOptions.db.close();
    mssqlOptions.db2.close();
  }
  pgOptions.db.close();
  pgOptions.db2.close();
});

