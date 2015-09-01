var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('json-schema-entity');

exports.create = function(record, data, options) {
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
        params.push({
          value: value,
          type: property.type,
          maxLength: property.maxLength,
          decimals: property.decimals,
          timezone: property.timezone
        });
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
      return fields + (fields ? ',' : '') + data.public.db.wrap(field);
    }, '')).replace('<values>',
    fields.reduce(function(fields, field) {
      return fields + (fields ? ',' : '') + '$' + index++;
    }, ''));
  debug(insertCommand, params);
  return data.public.db.execute(insertCommand, params, {transaction: options.transaction})
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

exports.update = function(record, data, options) {
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
        params.push({
          value: value,
          type: property.type,
          maxLength: property.maxLength,
          decimals: property.decimals,
          timezone: property.timezone
        });
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
      return fields + (fields ? ',' : '') + data.public.db.wrap(field) + '=$' + index++;
    }, '')).replace('<primary-keys>',
    findKeys.reduce(function(fields, field) {
      return fields + (fields ? ' AND ' : '') + data.public.db.wrap(field) + '=$' + index++;
    }, ''));
  debug(updateCommand);
  return data.public.db.execute(updateCommand, params, {transaction: options.transaction})
    .then(function() {
      return record;
    });
};

exports.destroy = function(data, options) {
  assert(options.where);
  var params = [];
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
  var deleteCommand = data.deleteCommand.replace('<find-keys>',
    findKeys.reduce(function(fields, field) {
      return fields + (fields ? ' AND ' : '') + data.public.db.wrap(field) + '=$' + index++;
    }, ''));
  debug(deleteCommand, params);
  return data.public.db.execute(deleteCommand, params, {transaction: options.transaction})
    .then(function(recordset) {
      assert(recordset.length === 1, 'No or more than 1 record deleted:', recordset);
      return recordset.length;
    });
};
