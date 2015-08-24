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
  layer.execute = function(command, options, params) {
    log('execute', command);
    db = (options && options.transaction) || db;
    return db.any(command, params);
  };
  layer.query = function(command, options, params) {
    //log('query', command);
    db = (options && options.transaction) || db;
    return db.query(command, params);
  };
  layer.wrap = function(name) {
    return delimiters[0] + name + delimiters[1];
  }
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
  }
}

function whichDialect(db) {
  return isNodeMssql(db) ? 'mssql' : isPostgres(db) ? 'postgres' : void 0;
}

function isNodeMssql(db) {
  return db.DRIVERS !== void 0; //todo identify in a better way
}

function isPostgres(db) {
  return db.oneOrNone !== void 0; //todo identify in a better way
}

