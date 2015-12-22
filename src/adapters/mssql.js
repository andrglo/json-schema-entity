var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
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

    json = JSON.parse(json);
    json = json.recordset.row;
    assert(json, 'Error converting xml to json: ' + xmlField);

    json = _.isArray(json) ? json : [json];
    _.forEach(json, function(record) {
      Object.keys(record).forEach(function(key) {
        var newKey = key.replace(xmlSpaceTokenRegExp, ' ');
        if (newKey !== key) {
          record[newKey] = record[key];
          delete record[key];
        }
      });
      coerce.map(function(coercion) {
        record[coercion.property] = record[coercion.property] && coercion.fn(record[coercion.property]) || null;
      });
    });

    return json;
  };

  adapter.buildQuery = function buildQuery(data) {
    var fields = [];
    _.forEach(data.properties, function(property, name) {
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
  };

  adapter.getCoercionFunction = function(type) {
    switch (type) {
      case 'date':
      case 'datetime':
        return function(value) {
          return new Date(value);
        };
      case 'integer':
        return Number;
      default:
        return function(value) {
          return value;
        };
    }
  };

  return adapter;
};

