var assert = require('assert');
var debug = require('debug')('tiny-interface-layer');

var log = console.log;

module.exports = function(db) {
  var layer = {
    dialect: whichDialect(db)
  };
  assert(layer.dialect, 'SQL connector not supported');
  addCommands(layer, db);
  return layer;
};

function addCommands(layer, db) {
  return layer.dialect === 'mssql' ? mssqlDbCommands(layer, db) :
    postgresDbCommands(layer, db);
}

function postgresDbCommands(layer, db) {
  var delimiters = '""';

  layer.transaction = function(fn) {
    return new Promise(function(resolve, reject) {
      db.connect(function(err, client, done) {
        if (err) return reject(err);
        client.query('BEGIN', function(err) {
          debug('BEGIN RESULT:', err);
          if (err) {
            client.query('ROLLBACK', function(err) {
              debug('ROLLBACK RESULT:', err);
              done(err);
              reject(err);
            });
            return;
          }
          fn(client)
            .then(function(res) {
              client.query('COMMIT', function(err) {
                debug('COMMIT RESULT:', err);
                done(err);
                resolve(res);
              });
            })
            .catch(function(fnError) {
              client.query('ROLLBACK', function(err) {
                debug('ROLLBACK RESULT:', err);
                done(err);
                reject(fnError);
              });
            });
        });
      });
    });
  };

  layer.execute = function(command, options, params) {
    return layer.query(command, options, params);
  };
  layer.query = function(command, options, params) {
    debug('QUERY:', command, params);
    if (options && options.transaction) {
      return new Promise(function(resolve, reject) {
        options.transaction.query(command, params, function(err, result) {
          if (err) return reject(err);
          debug('ROWS:', result.rows);
          resolve(result.rows);
        });
      });
    } else {
      return new Promise(function(resolve, reject) {
        db.connect(function(err, client, done) {
          if (err) return reject(err);
          client.query(command, params, function(err, result) {
            if (err) {
              done();
              reject(err);
              return;
            }
            done();
            debug('ROWS:', result.rows);
            resolve(result.rows);
          });
        });
      });
    }
  };
  layer.wrap = function(name) {
    return delimiters[0] + name + delimiters[1];
  };
}

function mssqlDbCommands(layer, db) {
  var delimiters = '[]';
  layer.transaction = function(fn) {
    var transaction = new db.Transaction();
    var rolledBack = false;
    transaction.on('rollback', function() {
      rolledBack = true;
    });
    return transaction.begin()
      .then(function() {
        return fn(transaction);
      })
      .then(function(res) {
        return transaction.commit()
          .then(function() {
            return res;
          });
      })
      .catch(function(err) {
        if (!rolledBack) {
          return transaction.rollback()
            .then(function() {
              throw err;
            });
        }
        throw err;
      });
  };
  layer.execute = function(command, options) {
    debug('EXECUTE:', command);
    return (new db.Request(options && options.transaction)).batch(command);
  };
  layer.query = function(command, options) {
    debug('QUERY:', command);
    return (new db.Request(options && options.transaction)).query(command);
  };
  layer.wrap = function(name) {
    return delimiters[0] + name + delimiters[1];
  };
}

function whichDialect(db) {
  return isNodeMssql(db) ? 'mssql' : isPostgres(db) ? 'postgres' : void 0;
}

function isNodeMssql(db) {
  return db.DRIVERS !== void 0; //todo identify in a better way
}

function isPostgres(db) {
  return typeof db.defaults === 'object'; //todo identify in a better way
}

