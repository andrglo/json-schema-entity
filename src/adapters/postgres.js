var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('json-schema-entity');
var common = require('./common');

var log = console.log;

module.exports = function(db) {

  var adapter = {};

  adapter.createTimestamps = function(data) {
    var table = db.wrap(data.identity.name);
    return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
        'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'createdAt\'')
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('createdAt') + ' TIMESTAMP WITH TIME ZONE');
        }
      })
      .then(function() {
        return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'updatedAt\'');
      })
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('updatedAt') + ' TIMESTAMP WITH TIME ZONE');
        }
      });
  };

  adapter.buildInsertCommand = function(data) {
    data.insertCommand = 'INSERT INTO ' + db.wrap(data.identity.name) +
      ' (<fields>) VALUES (<values>) RETURNING *';
    debug('insert command', data.insertCommand);
  };

  adapter.buildUpdateCommand = function(data) {
    data.updateCommand = 'UPDATE ' + db.wrap(data.identity.name) +
      ' SET <fields-values> WHERE <primary-keys> RETURNING *';
    debug('update command', data.updateCommand);
  };

  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand = 'DELETE FROM ' + db.wrap(data.identity.name) +
      ' WHERE <find-keys> RETURNING *';
    debug('delete command', data.deleteCommand);
  };
  adapter.create = common.create;
  adapter.update = common.update;
  adapter.destroy = common.destroy;
  adapter.extractRecordset = function(jsonset, coerce) {
    assert(_.isArray(jsonset), 'jsonset is not an array');
    _.forEach(jsonset, function(record) {
      coerce.map(function(coercion) {
        debug('Coercion before', coercion.property, typeof record[coercion.property], record[coercion.property]);
        if (record[coercion.property]) record[coercion.property] = coercion.fn(record[coercion.property]);
        debug('Coercion after', coercion.property, typeof record[coercion.property], record[coercion.property]);
      });
    });
    return jsonset;
  };

  adapter.buildQuery = function buildQuery(data) {

    var fields = [];
    _.forEach(data.properties, function(property, name) {
      debug('Property', name);
      var fieldName = property.field || name;
      var alias = name;
      fields.push(db.wrap(fieldName) + (alias !== fieldName ? ' AS ' +
        db.wrap(alias) : ''));
    });
    if (data.timestamps) {
      fields.push(db.wrap('updatedAt'));
      fields.push(db.wrap('createdAt'));
    }
    _.forEach(data.associations, function(association) {
      if (!association.data.foreignKey) {
        debug('foreignKey yet not defined for', association.data.key);
        return false;
      }
      buildQuery(association.data);
      var foreignKey = association.data.properties[association.data.foreignKey].field ||
        association.data.foreignKey;
      fields.push(
        '(select array_to_json(array_agg(row_to_json(t))) from (' +
        association.data.query +
        ' WHERE ' + db.wrap(foreignKey) + '=' +
        db.wrap(data.key) + '.' + db.wrap(data.primaryKeyFields[0]) +
        ') t) AS ' +
        db.wrap(association.data.key)
      );
    });
    data.query = 'SELECT ' + fields.join(',') +
      ' FROM ' + db.wrap(data.identity.name) + ' AS ' + db.wrap(data.key);
    debug('Query:', data.query);
  };

  adapter.getCoercionFunction = function(type, timezone) {
    switch (type) {
      case 'date':
        return function(value) {
          return new Date(value + 'T00:00:00.000Z');
        };
      case 'datetime':
        return function(value) {
          if (timezone === 'ignore') {
            var d = new Date(value + 'Z');
            return new Date(d.getTime() + (d.getTimezoneOffset() * 60000));
          } else {
            return new Date(value);
          }
        };
      default:
        return function(value) {
          return value;
        };
    }
  };

  return adapter;
}
;


