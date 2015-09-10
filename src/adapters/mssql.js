var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
var debug = require('debug')('json-schema-entity');
var common = require('./common');

var xmlSpaceToken = '_-_';
var xmlSpaceTokenRegExp = new RegExp(xmlSpaceToken, 'g');

module.exports = function(db) {

  var adapter = {};

  adapter.createTimestamps = function(data) {
    var table = db.wrap(data.identity.name);
    return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
        'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'createdAt\'')
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('createdAt') + ' datetime2');
        }
      })
      .then(function() {
        return db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'updatedAt\'');
      })
      .then(function(recordset) {
        if (recordset.length === 0) {
          return db.execute('ALTER TABLE ' + table + ' ADD ' +
            db.wrap('updatedAt') + ' datetime2');
        }
      });
  };

  function toSqlType(property) {
    switch (property.type) {
      case 'integer':
        return 'INTEGER';
      case 'number':
        return property.decimals > 0 ? 'DECIMAL(' + property.maxLength + ',' + property.decimals + ')' : 'INTEGER';
      case 'date':
        return 'DATE';
      case 'datetime':
        return property.timezone === 'ignore' ? 'DATETIME2' : 'DATETIMEOFFSET';
      default:
        return 'NVARCHAR(' + (property.maxLength || 'MAX') + ')';
    }
  }

  function buildReturningFields(fields, fieldsWithType, data) {
    _.forEach(data.properties, function(property, name) {
      fieldsWithType.push('[' + (property.field || name) + ']' + ' ' +
        toSqlType(property));
      fields.push(property.field || name);
    });
    if (data.timestamps) {
      fieldsWithType.push('createdAt DATETIME2');
      fields.push('createdAt');
      fieldsWithType.push('updatedAt DATETIME2');
      fields.push('updatedAt');
    }
  }

  adapter.buildInsertCommand = function(data) {
    var fieldsWithType = [];
    var fields = [];
    buildReturningFields(fields, fieldsWithType, data);
    var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
    commands.push('INSERT INTO [' + data.identity.name + '] (<fields>) OUTPUT ' +
      fields.map(function(field) {
        return 'INSERTED.[' + field + ']';
      }).join(',') +
      ' INTO @tmp VALUES (<values>)');
    commands.push('SELECT * FROM @tmp');
    data.insertCommand = commands.join(';');
    debug('insert command', data.insertCommand);
  };
  adapter.buildUpdateCommand = function(data) {
    var fieldsWithType = [];
    var fields = [];
    buildReturningFields(fields, fieldsWithType, data);
    var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
    commands.push('UPDATE [' + data.identity.name + '] SET <fields-values> OUTPUT ' +
      fields.map(function(field) {
        return 'INSERTED.[' + field + ']';
      }).join(',') +
      ' INTO @tmp WHERE <primary-keys>');
    commands.push('SELECT * FROM @tmp');
    data.updateCommand = commands.join(';');
    debug('update command', data.updateCommand);
  };
  adapter.buildDeleteCommand = function(data) {
    var fieldsWithType = [];
    var fields = [];
    buildReturningFields(fields, fieldsWithType, data);
    var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
    commands.push('DELETE FROM [' + data.identity.name + '] OUTPUT ' +
      fields.map(function(field) {
        return 'DELETED.[' + field + ']';
      }).join(',') +
      ' INTO @tmp WHERE <find-keys>');
    commands.push('SELECT * FROM @tmp');
    data.deleteCommand = commands.join(';');
    debug('delete command', data.deleteCommand);
  };
  adapter.create = common.create;
  adapter.update = common.update;
  adapter.destroy = common.destroy;

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

