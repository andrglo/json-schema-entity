var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
var debug = require('debug')('json-schema-entity');

var xmlSpaceToken = '_-_';
var xmlSpaceTokenRegExp = new RegExp(xmlSpaceToken, 'g');

module.exports = function(db) {

  var adapter = {};

  adapter.buildInsertCommand = function(data) {

    var fieldsWithType = [];
    var fields = [];
    _.forEach(data.properties, function(property, name) {
      if (property.autoIncrement) {
        fieldsWithType.push('[' + (property.field || name) + ']' + ' INTEGER');
        fields.push(property.field || name);
      }
    });
    if (data.timestamps) {
      fieldsWithType.push('createdAt DATETIME2');
      fields.push('createdAt');
      fieldsWithType.push('updatedAt DATETIME2');
      fields.push('updatedAt');
    }
    if (fieldsWithType.length === 0) {
      data.insertCommand = 'INSERT INTO [' + data.identity.name + '] (<fields>) VALUES (<values>)';
    } else {
      var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
      commands.push('INSERT INTO [' + data.identity.name + '] (<fields>) OUTPUT ' +
        fields.map(function(field) {
          return 'INSERTED.[' + field + ']'
        }).join(',') +
        ' INTO @tmp VALUES (<values>)');
      commands.push('SELECT * FROM @tmp');
      data.insertCommand = commands.join(';');
    }
    debug('insert command', data.insertCommand);
  };
  adapter.buildUpdateCommand = function(data) {

    if (data.timestamps) {
      data.updateCommand = 'declare @tmp table (updatedAt DATETIME2);' +
        '' +
        'UPDATE [' + data.identity.name + '] SET <fields-values> ' +
        'OUTPUT INSERTED.updatedAt into @tmp WHERE <primary-keys>;SELECT * from @tmp';
    } else {
      data.updateCommand = 'UPDATE [' + data.identity.name +
        '] SET <fields-values> WHERE <primary-keys>';
    }
    debug('update command', data.updateCommand);

  };
  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand = 'DELETE FROM [' + data.identity.name +
      '] WHERE <find-keys>;SELECT @@ROWCOUNT AS rowsAffected';
    debug('delete command', data.deleteCommand);
  };
  adapter.create = function(record, data, options) {
    options = options || {};
    var fields = [];
    var fieldsToRead = [];
    var defaultValues = {};
    var params = {};
    _.forEach(data.properties, function(property, name) {
      if (property.autoIncrement) {
        fieldsToRead.push({from: property.field || name, to: name});
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
          const key = _.camelCase(field);
          if (value !== null && (property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
            value = new Date(value);
          }
          params[key] = {
            value: value,
            type: property.type,
            maxLength: property.maxLength,
            decimals: property.decimals,
            timezone: property.timezone
          };
        }
      }
    });
    if (data.timestamps) {
      var now = new Date();
      record.createdAt = now;
      record.updatedAt = now;
      now = now.toISOString().substring(0, 23) + '000';
      params.createdAt = now;
      params.updatedAt = now;
      fields.push('createdAt');
      fields.push('updatedAt');
    }
    var insertCommand = data.insertCommand.replace('<fields>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '[' + field + ']';
      }, '')).replace('<values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '@' + _.camelCase(field);
      }, ''));
    debug(insertCommand, params);
    return db.execute(insertCommand, params, {transaction: options.transaction})
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
    var params = {};
    _.forEach(data.properties, function(property, name) {
      if (!property.autoIncrement) {
        var value = record[name];
        if (value !== void 0) {
          var field = property.field || name;
          fields.push(field);
          if (property.enum) {
            value = value.substr(0, property.maxLength);
          }
          const key = _.camelCase(field);
          if (value !== null && (property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
            value = new Date(value);
          }
          params[key] = {
            value: value,
            type: property.type,
            maxLength: property.maxLength,
            decimals: property.decimals,
            timezone: property.timezone
          };
        }
      }
    });

    if (data.timestamps) {
      record.updatedAt = new Date();
      params.updatedAt = record.updatedAt.toISOString().substring(0, 23) + '000';
      fields.push('updatedAt');
    }
    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      var key = _.camelCase('pk' + name);
      params[key] = options.where[attribute];
      return name;
    });
    if (data.timestamps) {
      params.pkupdatedAt = _.isDate(options.where.updatedAt) ?
        options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
      findKeys.push('updatedAt');
    }

    var updateCommand = data.updateCommand.replace('<fields-values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '[' + field + ']=@' + _.camelCase(field);
      }, '')).replace('<primary-keys>',
      findKeys.reduce(function(fields, field) {
        return fields + (fields ? ' AND ' : '') + '[' + field + ']=@' + _.camelCase('pk' + field);
      }, ''));
    debug(updateCommand);
    return db.execute(updateCommand, params, {transaction: options.transaction})
      .then(function() {
        return record;
      });
  };
  adapter.destroy = function(data, options) {
    assert(options.where);
    var params = {};
    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      var key = _.camelCase('pk' + name);
      params[key] = options.where[attribute];
      return name;
    });
    if (data.timestamps) {
      params.pkupdatedAt = _.isDate(options.where.updatedAt) ?
        options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
      findKeys.push('updatedAt');
    }

    var deleteCommand = data.deleteCommand.replace('<find-keys>',
      findKeys.reduce(function(fields, field) {
        return fields + (fields ? ' AND ' : '') + '[' + field + ']=@' + _.camelCase('pk' + field);
      }, ''));
    debug(deleteCommand, params)
    return db.execute(deleteCommand, params, {transaction: options.transaction})
      .then(function(recordset) {
        assert(recordset.length === 1, 'No or more than 1 record deleted:', recordset);
        return recordset.length;
      });
  };

  adapter.extractRecordset = function(xmlField, coerce) {
    var json = xml2json.toJson('<recordset>' + xmlField + '</recordset>', {
      object: false,
      reversible: false,
      coerce: false,
      sanitize: false,
      trim: true,
      arrayNotation: false
    });
    json = json.replace(xmlSpaceTokenRegExp, ' ');
    json = JSON.parse(json);
    json = json.recordset.row;
    assert(json, 'Error converting xml to json: ' + xmlField);

    const isArray = _.isArray(json);
    _.forEach(isArray ? json : [json], function(record) {
      coerce.map(function(coercion) {
        debug('Coercion before', coercion.property, typeof record[coercion.property], record[coercion.property]);
        if (record[coercion.property]) record[coercion.property] = coercion.fn(record[coercion.property]);
        debug('Coercion after', coercion.property, typeof record[coercion.property], record[coercion.property]);
      });
    });

    return isArray ? json : [json];
  };

  adapter.buildQuery = function buildQuery(data) {
    var fields = [];
    _.forEach(data.properties, function(property, name) {
      debug('Property', name);
      var fieldName = property.field || name;
      var alias = name.replace(/ /g, xmlSpaceToken);
      fields.push('[' + fieldName + ']' + (alias !== fieldName ? ' AS [' + alias + ']' : ''));
    });
    if (data.timestamps) {
      fields.push('updatedAt');
      fields.push('createdAt');
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
        '(' + association.data.query +
        ' WHERE [' + foreignKey + ']=[' +
        data.key + '].[' +
        data.primaryKeyFields[0] +
        '] FOR XML PATH) AS [' +
        association.data.key + ']'
      );
    });
    data.query = 'SELECT ' + fields.join(',') +
      ' FROM [' + data.identity.name + '] AS [' + data.key + ']';
    debug('Query:', data.query);
  };

  adapter.getCoercionFunction = function(type) {
    switch (type) {
      case 'date':
      case 'datetime':
        return function(value) {
          return new Date(value);
        };
      default:
        return function(value) {
          return value;
        };
    }
  };

  return adapter;
};

