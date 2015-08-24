var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
var debug = require('debug')('json-schema-entity');

var utils = require('./utils');
var commonLayer = require('./commonLayer');

var xmlSpaceToken = '_-_';
var xmlSpaceTokenRegExp = new RegExp(xmlSpaceToken, 'g');

module.exports = function(db) {

  var cl = commonLayer(db);

  var adapter = {};

  adapter.query = function(command, criteria, options) {
    var sentence = utils.embedCriteria(command, criteria, cl);
    return cl.query(sentence, options.transaction);
  };

  adapter.createInstance = function(record, name, data) {
    _.forEach(data.properties, function(property, name) {
      if (property.enum) {
        _.forEach(property.enum, function(value) {
          if (value.startsWith(record[name])) {
            record[name] = value;
            return false;
          }
        });
      }
      if ((property.type === 'date' || property.type === 'datetime') &&
        record[name]) {
        record[name] = new Date(record[name])
      }
    });
    return record;
  };
  adapter.getAttributes = function(name) {
  };
  adapter.transaction = function(fn) {
    return db.tx(function() {
      return this.sequence(function (idx) {
        switch (idx) {
          case 0:
            return fn(this);
          case 1:
            return null;
        }
      });
    })
    //return Promise.all([fn(this).then(function(res) {
    //  record = res;
    //})]);
  //}
  .then(function(res) {
    return res[0];
  });
}
;
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
    ' WHERE <find-keys> RETURNING count(*) as rowsAffected';
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
      if (!value && property.defaultValue) {
        value = property.defaultValue;
        defaultValues[name] = value;
      }
      if (value && property.enum) {
        value = value.substr(0, property.maxLength);
      }
      if (value) {
        var field = property.field || name;
        fields.push(field);
        if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
          record[name] = new Date(value);
          params.push(record[name]);
        } else {
          params.push(value);
        }
      }
    }
  });
  if (data.timestamps) {
    var now = new Date();
    record.createdAt = now;
    record.updatedAt = now;
    params.push(record.createdAt.toISOString());
    params.push(record.updatedAt.toISOString().substring(0, 23) + '000');
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
        record[data.to] = recordset[0][data.from]
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
      if (value && property.enum) {
        value = value.substr(0, property.maxLength);
      }
      if (value !== void 0) {
        var field = property.field || name;
        fields.push(field);
        if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
          record[name] = new Date(value);
          params.push(record[name]);
        } else {
          params.push(value);
        }
      }
    }
  });

  var findKeys = data.primaryKeyFields.map(function(name, index) {
    const attribute = data.primaryKeyAttributes[index];
    params.push(options.where[attribute]);
    return name;
  });
  if (data.timestamps) {
    record.updatedAt = new Date();
    params.push(record.updatedAt.toISOString().substring(0, 23) + '000');
    fields.push('updatedAt');

    params.push(_.isDate(options.where.updatedAt) ?
      options.where.updatedAt.toISOString() : (options.where.updatedAt || null));
    findKeys.push('updatedAt')
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
  var params = {};
  var findKeys = data.primaryKeyFields.map(function(name, index) {
    const attribute = data.primaryKeyAttributes[index];
    params.push(options.where[attribute]);
    return name;
  });
  if (data.timestamps) {
    params.push(_.isDate(options.where.updatedAt) ?
      options.where.updatedAt.toISOString() : (options.where.updatedAt || null));
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
      if (!(recordset && recordset[0] && recordset[0].rowsAffected === 1)) {
        console.log('No or more than 1 record deleted:',
          recordset && recordset[0].rowsAffected, params, deleteCommand)
      }
      assert(recordset && recordset[0] && recordset[0].rowsAffected === 1,
        'No or more than 1 record deleted:', recordset && recordset[0].rowsAffected);
      return recordset[0];
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

return adapter;
}
;


