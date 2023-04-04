var _ = require('lodash')
var assert = require('assert')
var common = require('./common')

module.exports = function () {
  var adapter = {
    wrap: column => `[${column}]`
  }

  adapter.createTimestamps = function (data, options) {
    options = options || {}
    var table = this.wrap(data.identity.name)
    var schema = options.schema || 'dbo'
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    return this.db
      .query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          "TABLE_NAME='" +
          data.identity.name +
          `' AND COLUMN_NAME='${updatedAtColumnName}' AND ` +
          "TABLE_CATALOG=db_name() AND TABLE_SCHEMA='" +
          schema +
          "'",
        null,
        options
      )
      .then(recordset => {
        if (recordset.length === 0) {
          return this.db.execute(
            'ALTER TABLE ' +
              table +
              ' ADD ' +
              this.wrap(updatedAtColumnName) +
              ' datetime2(3)',
            null,
            options
          )
        }
      })
  }

  function toSqlType(property) {
    switch (property.type) {
      case 'integer':
        return 'INTEGER'
      case 'number':
        return property.decimals > 0
          ? 'DECIMAL(' +
              property.maxLength +
              ',' +
              property.decimals +
              ')'
          : 'INTEGER'
      case 'date':
        return 'DATE'
      case 'datetime':
        return property.timezone === 'ignore'
          ? 'DATETIME2'
          : 'DATETIMEOFFSET'
      default:
        return 'NVARCHAR(' + (property.maxLength || 'MAX') + ')'
    }
  }

  function buildReturningFields(fields, fieldsWithType, data) {
    _.forEach(data.properties, function (property, name) {
      fieldsWithType.push(
        '[' +
          (property.field || name) +
          ']' +
          ' ' +
          toSqlType(property)
      )
      fields.push(property.field || name)
    })
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    if (updatedAtColumnName) {
      fieldsWithType.push(updatedAtColumnName + ' DATETIME2(3)')
      fields.push(updatedAtColumnName)
    }
  }

  function buildReturningPrimaryKeyFields(
    fields,
    fieldsWithType,
    data
  ) {
    _.forEach(data.properties, function (property, name) {
      if (data.primaryKeyFields.includes(property.field || name)) {
        fieldsWithType.push(
          '[' +
            (property.field || name) +
            ']' +
            ' ' +
            toSqlType(property)
        )
        fields.push(property.field || name)
      }
    })
  }

  adapter.buildInsertCommand = function (data) {
    var primaryKeysFieldsWithType = []
    var primaryKeysFields = []
    var fieldsWithType = []
    var fields = []
    buildReturningFields(fields, fieldsWithType, data)
    buildReturningPrimaryKeyFields(
      primaryKeysFields,
      primaryKeysFieldsWithType,
      data
    )
    var commands = [
      'DECLARE @tmp TABLE (' +
        primaryKeysFieldsWithType.join(',') +
        ')'
    ]
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    commands.push(
      'INSERT INTO [' +
        data.identity.name +
        '] (<fields>' +
        (updatedAtColumnName ? `,${updatedAtColumnName}` : '') +
        ') OUTPUT ' +
        primaryKeysFields
          .map(function (field) {
            return 'INSERTED.[' + field + ']'
          })
          .join(',') +
        ' INTO @tmp VALUES (<values>' +
        (data.timestamps ? ',getUtcDate()' : '') +
        ')'
    )
    commands.push(
      'SELECT ' +
        fields.map(name => `c.[${name}]`).join(',') +
        ' FROM [' +
        data.identity.name +
        '] c INNER JOIN @tmp t ON ' +
        primaryKeysFields
          .map(name => `c.[${name}]=t.[${name}]`)
          .join(' AND ')
    )
    data.insertCommand = commands.join(';')
  }
  adapter.buildUpdateCommand = function (data) {
    var primaryKeysFieldsWithType = []
    var primaryKeysFields = []
    var fieldsWithType = []
    var fields = []
    buildReturningFields(fields, fieldsWithType, data)
    buildReturningPrimaryKeyFields(
      primaryKeysFields,
      primaryKeysFieldsWithType,
      data
    )
    var commands = [
      'DECLARE @tmp TABLE (' +
        primaryKeysFieldsWithType.join(',') +
        ')'
    ]
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    commands.push(
      'UPDATE [' +
        data.identity.name +
        '] SET <fields-values>' +
        (updatedAtColumnName
          ? `,${updatedAtColumnName}=getUtcDate()`
          : '') +
        ' OUTPUT ' +
        primaryKeysFields
          .map(function (field) {
            return 'INSERTED.[' + field + ']'
          })
          .join(',') +
        ' INTO @tmp WHERE <primary-keys>'
    )
    commands.push(
      'SELECT ' +
        fields.map(name => `c.[${name}]`).join(',') +
        ' FROM [' +
        data.identity.name +
        '] c INNER JOIN @tmp t ON ' +
        primaryKeysFields
          .map(name => `c.[${name}]=t.[${name}]`)
          .join(' AND ')
    )
    data.updateCommand = commands.join(';')
  }
  adapter.buildDeleteCommand = function (data) {
    var fieldsWithType = []
    var fields = []
    buildReturningFields(fields, fieldsWithType, data)
    var commands = [
      'DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'
    ]
    commands.push(
      'DELETE FROM [' +
        data.identity.name +
        '] OUTPUT ' +
        fields
          .map(function (field) {
            return 'DELETED.[' + field + ']'
          })
          .join(',') +
        ' INTO @tmp WHERE <find-keys>'
    )
    commands.push('SELECT * FROM @tmp')
    data.deleteCommand = commands.join(';')
  }
  adapter.create = common.create
  adapter.update = common.update
  adapter.destroy = common.destroy

  adapter.extractRecordset = function (jsonset, coerce) {
    jsonset =
      typeof jsonset === 'string' ? JSON.parse(jsonset) : jsonset
    assert(_.isArray(jsonset), 'jsonset is not an array')
    _.forEach(jsonset, function (record) {
      coerce.map(function (coercion) {
        const value = record[coercion.property]
        if (value === void 0) {
          record[coercion.property] = null
        } else if (value !== null) {
          record[coercion.property] = coercion.fn(
            record[coercion.property]
          )
        }
      })
    })
    return jsonset
  }

  adapter.buildQuery = function buildQuery(data, options) {
    var fields = []
    _.forEach(data.properties, function (property, name) {
      var fieldName = property.field || name
      fields.push(
        '[' +
          fieldName +
          ']' +
          (name !== fieldName ? ' AS [' + name + ']' : '')
      )
      if (
        options.fetchExternalDescription &&
        property.display &&
        property.schema &&
        property.schema.$ref &&
        property.schema.key
      ) {
        let display = property.display
        const point = display.indexOf('.')
        if (point > -1) {
          display = display.substr(point + 1)
        }
        fields.push(
          `(select [${display}] from [${
            property.schema.$ref
          }] where [${property.schema.key}]=[${
            data.key
          }].[${fieldName}]) as [${_.camelCase(
            `${data.identity.name} ${name} ${display}`
          )}]`
        )
      }
    })
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    if (updatedAtColumnName) {
      fields.push(updatedAtColumnName)
    }
    _.forEach(data.associations, function (association) {
      if (!association.data.foreignKey) {
        return false
      }
      const query = buildQuery(association.data, options)
      var foreignKey =
        association.data.properties[association.data.foreignKey]
          .field || association.data.foreignKey
      fields.push(
        '(' +
          query +
          ' WHERE [' +
          foreignKey +
          ']=[' +
          data.key +
          '].[' +
          data.primaryKeyFields[0] +
          '] ORDER BY ' +
          (association.data.primaryOrderFields ||
            association.data.primaryKeyFields) +
          ' FOR JSON PATH) AS [' +
          association.data.key +
          ']'
      )
    })
    return (
      'SELECT ' +
      fields.join(',') +
      ' FROM [' +
      data.identity.name +
      '] AS [' +
      data.key +
      ']'
    )
  }

  adapter.getCoercionFunction = function (type) {
    switch (type) {
      case 'datetime':
        return function (value) {
          return new Date(value)
        }
      case 'integer':
        return Number
      default:
        return function (value) {
          return value
        }
    }
  }

  return adapter
}
