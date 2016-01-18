var _ = require('lodash');
var assert = require('assert');
var EntityError = require('../entity-error');

exports.create = function(record, data, options) {
  options = options || {};
  var fields = [];
  var params = [];
  _.forEach(data.properties, function(property, name) {
    if (!property.autoIncrement) {
      var value = record[name];
      if ((value === void 0 || value === null) && property.defaultValue) {
        value = property.defaultValue;
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
    fields.reduce(function(fields) {
      return fields + (fields ? ',' : '') + '$' + index++;
    }, ''));
  return data.public.db.execute(insertCommand, params, options)
    .then(function(recordset) {
      checkRecordsetLength(data, null, recordset.length, 'create');
      var inserted = recordset[0];
      _.forEach(data.properties, function(property, name) {
        var fieldName = property.field || name;
        record[name] = inserted[fieldName];
      });
      if (data.timestamps) {
        record.createdAt = inserted.createdAt;
        record.updatedAt = inserted.updatedAt;
      }
      return record;
    });
};

exports.update = function(record, data, options) {
  assert(options.where);
  var fields = [];
  var params = [];
  _.forEach(data.properties, function(property, name) {
    if (!property.autoIncrement && name !== data.foreignKey) {
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

  var index = 0;
  var updateCommand = data.updateCommand.replace('<fields-values>',
    fields.reduce(function(fields, field) {
      return fields + (fields ? ',' : '') + data.public.db.wrap(field) + '=$' + ++index;
    }, '')).replace('<primary-keys>',
    findKeys.reduce(function(fields, field) {
      return fields + (fields ? ' AND ' : '') +
        data.public.db.wrap(field) +
        (params[index] === null ? params.splice(index, 1) && ' IS NULL' : '=$' + ++index);
    }, ''));
  return data.public.db.execute(updateCommand, params, options)
    .then(function(recordset) {
      checkRecordsetLength(data, options.where, recordset.length, 'update');
      var updated = recordset[0];
      _.forEach(data.properties, function(property, name) {
        var fieldName = property.field || name;
        record[name] = updated[fieldName];
      });
      if (data.timestamps) {
        record.createdAt = updated.createdAt;
        record.updatedAt = updated.updatedAt;
      }
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

  var index = 0;
  var deleteCommand = data.deleteCommand.replace('<find-keys>',
    findKeys.reduce(function(fields, field) {
      return fields + (fields ? ' AND ' : '') +
        data.public.db.wrap(field) +
        (params[index] === null ? params.splice(index, 1) && ' IS NULL' : '=$' + ++index);
    }, ''));
  return data.public.db.execute(deleteCommand, params, options)
    .then(function(recordset) {
      checkRecordsetLength(data, options.where, recordset.length, 'delete');
      return recordset.length;
    });
};

function checkRecordsetLength(data, key, n, type) {
  if (n === 0 && key) {
    throw new EntityError({
      type: 'RecordModifiedOrDeleted',
      message: `Entity '${data.key}' key ${JSON.stringify(key)} not found for ${type}`
    });
  }
  assert(n === 1, `${n} records have been ${type}d, expected one`);
}

