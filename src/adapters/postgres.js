var _ = require('lodash');
var assert = require('assert');
var common = require('./common');

module.exports = function(db) {

  var adapter = {};

  adapter.createTimestamps = function(data, options) {
    options = options || {};
    var table = db.wrap(data.identity.name);
    var catalog = options.database || db.config.database;
    var schema = options.schema || db.config.schema || 'public';
    return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
        'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'createdAt\' AND ' +
        'TABLE_CATALOG=\'' + catalog + '\' AND TABLE_SCHEMA=\'' + schema + '\'', null, options)
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('createdAt') + ' TIMESTAMP WITH TIME ZONE', null, options);
        }
      })
      .then(function() {
        return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'updatedAt\' AND ' +
          'TABLE_CATALOG=\'' + catalog + '\' AND TABLE_SCHEMA=\'' + schema + '\'', null, options);
      })
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('updatedAt') + ' TIMESTAMP WITH TIME ZONE', null, options);
        }
      });
  };

  adapter.buildInsertCommand = function(data) {
    data.insertCommand = 'INSERT INTO ' + db.wrap(data.identity.name) +
      ' (<fields>) VALUES (<values>) RETURNING *';
  };

  adapter.buildUpdateCommand = function(data) {
    data.updateCommand = 'UPDATE ' + db.wrap(data.identity.name) +
      ' SET <fields-values> WHERE <primary-keys> RETURNING *';
  };

  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand = 'DELETE FROM ' + db.wrap(data.identity.name) +
      ' WHERE <find-keys> RETURNING *';
  };
  adapter.create = common.create;
  adapter.update = common.update;
  adapter.destroy = common.destroy;
  adapter.extractRecordset = function(jsonset, coerce) {
    assert(_.isArray(jsonset), 'jsonset is not an array');
    _.forEach(jsonset, function(record) {
      coerce.map(function(coercion) {
        record[coercion.property] = record[coercion.property] && coercion.fn(record[coercion.property]) || null;
      });
    });
    return jsonset;
  };

  adapter.buildQuery = function buildQuery(data) {

    var fields = [];
    _.forEach(data.properties, function(property, name) {
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
            return new Date(d.getTime() + d.getTimezoneOffset() * 60000);
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


