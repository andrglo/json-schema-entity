var _ = require('lodash')
var assert = require('assert')
var common = require('./common')

module.exports = function () {
  var adapter = {
    // Identifiers are escaped by doubling the closing bracket - the
    // standard SQL escape, same as in sql-view - so any character is
    // safe inside them and a name carrying a bracket cannot end the
    // identifier early
    wrap: column => `[${column.replace(/]/g, ']]')}]`
  }

  adapter.createTimestamps = function (data, options) {
    options = options || {}
    var table = this.wrap(data.identity.name)
    var schema = options.schema
      ? common.checkSchema(options.schema)
      : 'dbo'
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
        return property.timezone === true
          ? 'DATETIMEOFFSET'
          : 'DATETIME2'
      default:
        return 'NVARCHAR(' + (property.maxLength || 'MAX') + ')'
    }
  }

  function buildReturningFields(fields, fieldsWithType, data) {
    _.forEach(data.properties, function (property, name) {
      fieldsWithType.push(
        adapter.wrap(property.field || name) +
          ' ' +
          toSqlType(property)
      )
      fields.push(property.field || name)
    })
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    if (updatedAtColumnName) {
      fieldsWithType.push(
        adapter.wrap(updatedAtColumnName) + ' DATETIME2(3)'
      )
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
          adapter.wrap(property.field || name) +
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
      'INSERT INTO ' +
        adapter.wrap(data.identity.name) +
        ' (<fields>' +
        (updatedAtColumnName
          ? `,${adapter.wrap(updatedAtColumnName)}`
          : '') +
        ') OUTPUT ' +
        primaryKeysFields
          .map(function (field) {
            return 'INSERTED.' + adapter.wrap(field)
          })
          .join(',') +
        ' INTO @tmp VALUES (<values>' +
        (data.timestamps ? ',getUtcDate()' : '') +
        ')'
    )
    commands.push(
      'SELECT ' +
        fields.map(name => `c.${adapter.wrap(name)}`).join(',') +
        ' FROM ' +
        adapter.wrap(data.identity.name) +
        ' c INNER JOIN @tmp t ON ' +
        primaryKeysFields
          .map(
            name =>
              `c.${adapter.wrap(name)}=t.${adapter.wrap(name)}`
          )
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
      'UPDATE ' +
        adapter.wrap(data.identity.name) +
        ' SET <fields-values>' +
        (updatedAtColumnName
          ? `,${adapter.wrap(updatedAtColumnName)}=getUtcDate()`
          : '') +
        ' OUTPUT ' +
        primaryKeysFields
          .map(function (field) {
            return 'INSERTED.' + adapter.wrap(field)
          })
          .join(',') +
        ' INTO @tmp WHERE <primary-keys>'
    )
    commands.push(
      'SELECT ' +
        fields.map(name => `c.${adapter.wrap(name)}`).join(',') +
        ' FROM ' +
        adapter.wrap(data.identity.name) +
        ' c INNER JOIN @tmp t ON ' +
        primaryKeysFields
          .map(
            name =>
              `c.${adapter.wrap(name)}=t.${adapter.wrap(name)}`
          )
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
      'DELETE FROM ' +
        adapter.wrap(data.identity.name) +
        ' OUTPUT ' +
        fields
          .map(function (field) {
            return 'DELETED.' + adapter.wrap(field)
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
        adapter.wrap(fieldName) +
          (name !== fieldName ? ' AS ' + adapter.wrap(name) : '')
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
          `(select ${adapter.wrap(display)} from ${adapter.wrap(
            property.schema.$ref
          )} where ${adapter.wrap(
            property.schema.key
          )}=${adapter.wrap(data.key)}.${adapter.wrap(
            fieldName
          )}) as ${adapter.wrap(
            _.camelCase(
              `${data.identity.name} ${name} ${display}`
            )
          )}`
        )
      }
    })
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    if (updatedAtColumnName) {
      fields.push(adapter.wrap(updatedAtColumnName))
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
          ' WHERE ' +
          adapter.wrap(foreignKey) +
          '=' +
          adapter.wrap(data.key) +
          '.' +
          adapter.wrap(data.primaryKeyFields[0]) +
          ' ORDER BY ' +
          (
            association.data.primaryOrderFields ||
            association.data.primaryKeyFields
          )
            .map(field => adapter.wrap(field))
            .join(',') +
          ' FOR JSON PATH) AS ' +
          adapter.wrap(association.data.key)
      )
    })
    return (
      'SELECT ' +
      fields.join(',') +
      ' FROM ' +
      adapter.wrap(data.identity.name) +
      ' AS ' +
      adapter.wrap(data.key)
    )
  }

  // Written once per adapter on purpose: the two dialects are copies
  // free to diverge, not a shared routine with a branch. Here there is
  // no schema qualification - as in buildQuery, tenancy is per database
  // - and the comparison is a plain LIKE: the client databases are
  // case and accent insensitive and there is no f_unaccent here
  adapter.buildAssociationSearch = function (
    data,
    key,
    value,
    prepareValue,
    options,
    outerAlias
  ) {
    const association = _.find(data.associations, function (item) {
      return item.type === 'hasMany' && item.data.key === key
    })
    if (!association) {
      throw new Error('Invalid search association: ' + key)
    }
    const child = association.data
    if (!child.searchable || !child.searchable.length) {
      throw new Error('Association is not searchable: ' + key)
    }
    if (!child.foreignKey) {
      throw new Error(
        'Association has no foreign key: ' + key
      )
    }
    // only the first attribute would be correlated, so a composite
    // key leaves the exists under constrained and OVER matches: it
    // refuses to answer instead, as buildQuery is single key too
    if (data.primaryKeyAttributes.length !== 1) {
      throw new Error(
        'Search needs a single column primary key: ' + key
      )
    }
    const childAlias = adapter.wrap(key)
    const foreignKey =
      child.properties[child.foreignKey].field || child.foreignKey
    const joins = []
    const terms = []
    _.forEach(child.searchable, function (name) {
      const property = child.properties[name]
      if (!property) {
        throw new Error(
          'Invalid searchable property ' +
            name +
            ' in association ' +
            key
        )
      }
      let expression
      if (
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
        const lookupAlias = adapter.wrap(key + '_' + name)
        joins.push(
          ` LEFT JOIN ${adapter.wrap(
            property.schema.$ref
          )} AS ${lookupAlias} ON ${lookupAlias}.${adapter.wrap(
            property.schema.key
          )}=${childAlias}.${adapter.wrap(
            property.field || name
          )}`
        )
        expression = `${lookupAlias}.${adapter.wrap(display)}`
      } else {
        expression = `${childAlias}.${adapter.wrap(
          property.field || name
        )}`
      }
      // a new placeholder per occurrence: reusing one is fatal here
      terms.push(
        `${expression} LIKE ` + prepareValue('%' + value + '%')
      )
    })
    // the parent is correlated by its primary key ATTRIBUTE: the outer
    // where sees the derived table, where only the aliases exist
    return (
      `EXISTS (SELECT 1 FROM ${adapter.wrap(
        child.identity.name
      )} AS ${childAlias}${joins.join('')}` +
      ` WHERE ${childAlias}.${adapter.wrap(
        foreignKey
      )}=${outerAlias}.${adapter.wrap(
        data.primaryKeyAttributes[0]
      )} AND (${terms.join(' OR ')}))`
    )
  }

  adapter.getCoercionFunction = function (type) {
    switch (type) {
      case 'datetime':
        return function (value) {
          if (typeof value === 'string' && !value.endsWith('Z') && !value.match(/[-|+]\d\d:\d\d$/)) {
            value = value + 'Z'
          }
          return new Date(value)
        }
      case 'date':
        return function (value) {
          return value.slice(0, 10)
        }
      case 'integer':
        return Number
      default:
        return function (value) {
          return value
        }
    }
  }

  // The mssql driver runs tedious with useUTC (its default), so
  // datetime values arrive as UTC-constructed Dates and
  // toISOString() is the lossless inverse. Do NOT switch this to
  // local-component formatting: on hosts west of UTC it would
  // shift every date read one day back.
  adapter.plainDate = function (value) {
    return value.toISOString().substr(0, 10)
  }

  return adapter
}
