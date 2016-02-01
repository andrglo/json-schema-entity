var _ = require('lodash');
var assert = require('assert');
var common = require('./common');

module.exports = function() {

  var adapter = {
    wrap: (column) => `"${column}"`
  };

  adapter.createTimestamps = function(data, options) {
    options = options || {};
    var table = this.wrap(data.identity.name);
    var schema = options.schema || 'public';
    return this.db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
        'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'createdAt\' AND ' +
        'TABLE_CATALOG=current_database() AND TABLE_SCHEMA=\'' + schema + '\'', null, options)
      .then((recordset) => {
        if (recordset.length === 0) {
          return this.db.execute('ALTER TABLE ' + table + ' ADD ' +
            this.wrap('createdAt') + ' TIMESTAMP WITH TIME ZONE', null, options);
        }
      })
      .then(() => {
        return this.db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'updatedAt\' AND ' +
          'TABLE_CATALOG=current_database() AND TABLE_SCHEMA=\'' + schema + '\'', null, options);
      })
      .then((recordset) => {
        if (recordset.length === 0) {
          return this.db.execute('ALTER TABLE ' + table + ' ADD ' +
            this.wrap('updatedAt') + ' TIMESTAMP WITH TIME ZONE', null, options);
        }
      });
  };

  adapter.buildInsertCommand = function(data) {
    data.insertCommand = 'INSERT INTO ' + this.wrap(data.identity.name) +
      ' (<fields>) VALUES (<values>) RETURNING *';
  };

  adapter.buildUpdateCommand = function(data) {
    data.updateCommand = 'UPDATE ' + this.wrap(data.identity.name) +
      ' SET <fields-values> WHERE <primary-keys> RETURNING *';
  };

  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand = 'DELETE FROM ' + this.wrap(data.identity.name) +
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
      fields.push(this.wrap(fieldName) + (alias !== fieldName ? ' AS ' +
        this.wrap(alias) : ''));
    }, this);
    if (data.timestamps) {
      fields.push(this.wrap('updatedAt'));
      fields.push(this.wrap('createdAt'));
    }
    _.forEach(data.associations, function(association) {
      if (!association.data.foreignKey) {
        return false;
      }
      this.buildQuery(association.data);
      var foreignKey = association.data.properties[association.data.foreignKey].field ||
        association.data.foreignKey;
      fields.push(
        '(select array_to_json(array_agg(row_to_json(t))) from (' +
        association.data.query +
        ' WHERE ' + this.wrap(foreignKey) + '=' +
        this.wrap(data.key) + '.' + this.wrap(data.primaryKeyFields[0]) +
        ') t) AS ' +
        this.wrap(association.data.key)
      );
    }, this);
    data.query = 'SELECT ' + fields.join(',') +
      ' FROM ' + this.wrap(data.identity.name) + ' AS ' + this.wrap(data.key);
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


