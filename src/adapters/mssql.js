var _ = require('lodash');
var assert = require('assert');
var common = require('./common');

module.exports = function() {

  var adapter = {
    wrap: (column) => `[${column}]`
  };

  adapter.createTimestamps = function(data, options) {
    options = options || {};
    var table = this.wrap(data.identity.name);
    var schema = options.schema || 'dbo';
    return this.db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
        'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'created_at\' AND ' +
        'TABLE_CATALOG=db_name() AND TABLE_SCHEMA=\'' + schema + '\'', null, options)
      .then((recordset) => {
        if (recordset.length === 0) {
          return this.db.execute('ALTER TABLE ' + table + ' ADD ' +
            this.wrap('created_at') + ' datetime2(3) default getUtcDate()', null, options);
        }
      })
      .then(() => {
        return this.db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          'TABLE_NAME=\'' + data.identity.name + '\' AND COLUMN_NAME=\'updated_at\' AND ' +
          'TABLE_CATALOG=db_name() AND TABLE_SCHEMA=\'' + schema + '\'', null, options);
      })
      .then((recordset) => {
        if (recordset.length === 0) {
          return this.db.execute('ALTER TABLE ' + table + ' ADD ' +
            this.wrap('updated_at') + ' datetime2(3)', null, options);
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
      fieldsWithType.push('created_at DATETIME2(3)');
      fields.push('created_at');
      fieldsWithType.push('updated_at DATETIME2(3)');
      fields.push('updated_at');
    }
  }

  adapter.buildInsertCommand = function(data) {
    var fieldsWithType = [];
    var fields = [];
    buildReturningFields(fields, fieldsWithType, data);
    var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
    commands.push('INSERT INTO [' + data.identity.name + '] (<fields>' + (data.timestamps ? ',updated_at' : '') + ') OUTPUT ' +
      fields.map(function(field) {
        return 'INSERTED.[' + field + ']';
      }).join(',') +
      ' INTO @tmp VALUES (<values>' + (data.timestamps ? ',getUtcDate()' : '') + ')');
    commands.push('SELECT * FROM @tmp');
    data.insertCommand = commands.join(';');
  };
  adapter.buildUpdateCommand = function(data) {
    var fieldsWithType = [];
    var fields = [];
    buildReturningFields(fields, fieldsWithType, data);
    var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
    commands.push('UPDATE [' + data.identity.name + '] SET <fields-values>' + (data.timestamps ? ',updated_at=getUtcDate()' : '') + ' OUTPUT ' +
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

  adapter.extractRecordset = function(jsonset, coerce) {
    jsonset = typeof jsonset === 'string' ? JSON.parse(jsonset) : jsonset;
    assert(_.isArray(jsonset), 'jsonset is not an array');
    _.forEach(jsonset, function(record) {
      coerce.map(function(coercion) {
        record[coercion.property] = record[coercion.property] && coercion.fn(record[coercion.property]) || null;
      });
    });
    return jsonset;
  };

  adapter.buildQuery = function buildQuery(data, options) {
    var fields = [];
    _.forEach(data.properties, function(property, name) {
      var fieldName = property.field || name;
      fields.push('[' + fieldName + ']' + (name !== fieldName ? ' AS [' + name + ']' : ''));
      if (options.fetchExternalDescription &&
        property.display &&
        property.schema &&
        property.schema.$ref &&
        property.schema.key) {
        let display = property.display;
        const point = display.indexOf('.');
        if (point > -1) {
          display = display.substr(point + 1);
        }
        fields.push(`(select [${display}] from [${property.schema.$ref}] where [${property.schema.key}]=[${data.key}].[${fieldName}]) as [${_.camelCase(`${data.identity.name} ${fieldName} ${display}`)}]`);
      }
    });
    if (data.timestamps) {
      fields.push('updated_at');
      fields.push('created_at');
    }
    _.forEach(data.associations, function(association) {
      if (!association.data.foreignKey) {
        return false;
      }
      const query = buildQuery(association.data, options);
      var foreignKey = association.data.properties[association.data.foreignKey].field ||
        association.data.foreignKey;
      fields.push(
        '(' + query +
        ' WHERE [' + foreignKey + ']=[' +
        data.key + '].[' +
        data.primaryKeyFields[0] +
        '] FOR JSON PATH) AS [' +
        association.data.key + ']'
      );
    });
    return 'SELECT ' + fields.join(',') +
      ' FROM [' + data.identity.name + '] AS [' + data.key + ']';
  };

  adapter.getCoercionFunction = function(type) {
    switch (type) {
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

