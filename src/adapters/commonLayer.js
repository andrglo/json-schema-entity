var assert = require('assert');

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
          if (err) {
            client.query('ROLLBACK', function(err) {
              done(err);
              reject(err);
            });
            return;
          }
          fn(client)
            .then(function(res) {
              client.query('COMMIT', function(err) {
                done(err);
                resolve(res);
              });
            })
            .catch(function(fnError) {
              client.query('ROLLBACK', function(err) {
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
    //log('query', command);
    if (options && options.transaction) {
      return new Promise(function(resolve, reject) {
        options.transaction.query(command, params, function(err, result) {
          if (err) return reject(err);
          resolve(result.rows);
        });
      });
    } else {
      return new Promise(function(resolve, reject) {
        db.connect(function(err, client, done) {
          if (err) reject(err);
          client.query(command, params, function(err, result) {
            if (err) {
              done();
              reject(err);
              return;
            }
            done();
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
  layer.execute = function(command, options) {
    //log('execute', command);
    return (new db.Request(options && options.transaction)).batch(command);
  };
  layer.query = function(command, options) {
    //log('query', command);
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

