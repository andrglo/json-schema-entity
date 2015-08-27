var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('json-schema-entity');

var utils = require('./utils');
var commonLayer = require('./commonLayer');

var log = console.log;

module.exports = function(db) {

  var cl = commonLayer(db);

  var adapter = {};

  adapter.query = function(command, criteria, options) {
    var sentence = utils.embedCriteria(command, criteria, cl);
    return cl.query(sentence, options.transaction);
  };

  adapter.createInstance = function(record, name, data) {
    var instance = {};
    _.forEach(data.properties, function(property, name) {
      if (property.enum) {
        _.forEach(property.enum, function(value) {
          if (value.substr(0, record[name].length) === record[name]) {
            instance[name] = value;
            return false;
          }
        });
      } else if (record[name] && record[name] !== null) {
        instance[name] = record[name];
      }
    });
    if (data.timestamps) {
      instance.createdAt = record.createdAt;
      instance.updatedAt = record.updatedAt;
    }
    return instance;
  };
  adapter.getAttributes = function(name) {
  };

  adapter.transaction = cl.transaction;

  adapter.buildInsertCommand = function(data) {
    var fieldsToReturn = [];
    _.forEach(data.properties, function(property, name) {
      if (property.autoIncrement) {
        fieldsToReturn.push(cl.wrap(property.field || name));
      }
    });
    data.insertCommand = 'INSERT INTO ' + cl.wrap(data.identity.name) + ' (<fields>) VALUES (<values>)';
    if (fieldsToReturn.length > 0) {
      data.insertCommand += ' RETURNING ' + fieldsToReturn.join(',');
    }
    //console.log('insert command', data.insertCommand);
  };
  adapter.buildUpdateCommand = function(data) {
    data.updateCommand = 'UPDATE ' + cl.wrap(data.identity.name) +
      ' SET <fields-values> WHERE <primary-keys>';
  };
  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand = 'DELETE FROM ' + cl.wrap(data.identity.name) +
      ' WHERE <find-keys> RETURNING *';
  };
  adapter.create = function(record, data, options) {
    options = options || {};
    var fields = [];
    var fieldsToRead = [];
    var defaultValues = {};
    var params = [];
    _.forEach(data.properties, function(property, name) {
      if (property.autoIncrement) {
        fieldsToRead.push({from: property.field || name, to: name})
      } else {
        var value = record[name];
        if ((value === void 0 || value === null) && property.defaultValue) {
          value = property.defaultValue;
          defaultValues[name] = value;
        }
        if (value !== void 0) {
          var field = property.field || name;
          fields.push(field);
          if (property.enum) {
            value = value.substr(0, property.maxLength);
          }
          params.push(value);
        }
      }
    });
    if (data.timestamps) {
      var now = new Date();
      record.createdAt = now;
      record.updatedAt = now;
      params.push(record.createdAt);
      params.push(record.updatedAt);
      fields.push('createdAt');
      fields.push('updatedAt');
    }
    var index = 1;
    var insertCommand = data.insertCommand.replace('<fields>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + cl.wrap(field);
      }, '')).replace('<values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '$' + index++;
      }, ''));
    debug(insertCommand, params);
    return cl.execute(insertCommand, {transaction: options.transaction}, params)
      .then(function(recordset) {
        fieldsToRead.map(function(data) {
          record[data.to] = recordset[0][data.from];
        });
        _.forEach(defaultValues, function(value, key) {
          record[key] = value;
        });
        return record;
      });
  };
  adapter.update = function(record, data, options) {
    assert(options.where);
    var fields = [];
    var params = [];
    _.forEach(data.properties, function(property, name) {
      if (!property.autoIncrement) {
        var value = record[name];
        if (value !== void 0) {
          var field = property.field || name;
          fields.push(field);
          if (property.enum) {
            value = value.substr(0, property.maxLength);
          }
          params.push(value);
        }
      }
    });

    if (data.timestamps) {
      record.updatedAt = new Date();
      params.push(record.updatedAt);
      fields.push('updatedAt');
    }
    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      params.push(options.where[attribute]);
      return name;
    });
    if (data.timestamps) {
      params.push(options.where.updatedAt || null);
      findKeys.push('updatedAt');
    }

    var index = 1;
    var updateCommand = data.updateCommand.replace('<fields-values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + cl.wrap(field) + '=$' + index++;
      }, '')).replace('<primary-keys>',
      findKeys.reduce(function(fields, field) {
        return fields + (fields ? ' AND ' : '') + cl.wrap(field) + '=$' + index++;
      }, ''));
    //console.log(updateCommand)
    return cl.execute(updateCommand, {transaction: options.transaction}, params)
      .then(function() {
        return record;
      });
  };
  adapter.destroy = function(data, options) {
    assert(options.where);
    var params = [];
    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      params.push(options.where[attribute]);
      return name;
    });
    if (data.timestamps) {
      params.push(options.where.updatedAt || null);
      findKeys.push('updatedAt')
    }

    var index = 1;
    var deleteCommand = data.deleteCommand.replace('<find-keys>',
      findKeys.reduce(function(fields, field) {
        return fields + (fields ? ' AND ' : '') + cl.wrap(field) + '=$' + index++;
      }, ''));
    //console.log(deleteCommand, params)
    return cl.execute(deleteCommand, {transaction: options.transaction}, params)
      .then(function(recordset) {
        assert(recordset.length === 1, 'No or more than 1 record deleted:', recordset);
        return recordset.length;
      });
  };

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
      fields.push(cl.wrap(fieldName) + (alias !== fieldName ? ' AS ' +
        cl.wrap(alias) : ''));
    });
    if (data.timestamps) {
      fields.push(cl.wrap('updatedAt'));
      fields.push(cl.wrap('createdAt'));
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
        ' WHERE ' + cl.wrap(foreignKey) + '=' +
        cl.wrap(data.key) + '.' + cl.wrap(data.primaryKeyFields[0]) +
        ') t) AS ' +
        cl.wrap(association.data.key)
      );
    });
    data.query = 'SELECT ' + fields.join(',') +
      ' FROM ' + cl.wrap(data.identity.name) + ' AS ' + cl.wrap(data.key);
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


