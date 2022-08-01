var _ = require('lodash')
var assert = require('assert')
var common = require('./common')

module.exports = function() {
  var adapter = {
    wrap: column => `"${column}"`
  }

  adapter.createTimestamps = function(data, options) {
    options = options || {}
    var table = this.wrap(data.identity.name)
    var schema = options.schema || 'public'
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    return this.db
      .query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE ' +
          "TABLE_NAME='" +
          data.identity.name +
          `' AND COLUMN_NAME='${updatedAtColumnName}' AND ` +
          "TABLE_CATALOG=current_database() AND TABLE_SCHEMA='" +
          schema +
          "'",
        null,
        options
      )
      .then(recordset => {
        if (recordset.length === 0) {
          return this.db.execute(
            `ALTER TABLE ${table} ADD ${this.wrap(
              updatedAtColumnName
            )} TIMESTAMP(3) WITHOUT TIME ZONE`,
            null,
            options
          )
        }
      })
  }

  adapter.buildInsertCommand = function(data) {
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    data.insertCommand = `INSERT INTO ${this.wrap(
      data.identity.name
    )} (<fields>${updatedAtColumnName ? `,"${updatedAtColumnName}"` : ''}) VALUES (<values>${
      updatedAtColumnName ? `,(now() at time zone 'utc')` : ''
    }) RETURNING *`
  }

  adapter.buildUpdateCommand = function(data) {
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    data.updateCommand = `UPDATE ${this.wrap(
      data.identity.name
    )} SET <fields-values>${
      updatedAtColumnName ? `,"${updatedAtColumnName}"=(now() at time zone 'utc')` : ''
    } WHERE <primary-keys> RETURNING *`
  }

  adapter.buildDeleteCommand = function(data) {
    data.deleteCommand =
      'DELETE FROM ' +
      this.wrap(data.identity.name) +
      ' WHERE <find-keys> RETURNING *'
  }
  adapter.create = common.create
  adapter.update = common.update
  adapter.destroy = common.destroy
  adapter.extractRecordset = function(jsonset, coerce) {
    assert(_.isArray(jsonset), 'jsonset is not an array')
    _.forEach(jsonset, function(record) {
      coerce.map(function(coercion) {
        const value = record[coercion.property]
        if (value === void 0) {
          record[coercion.property] = null
        } else if (value !== null) {
          record[coercion.property] = coercion.fn(record[coercion.property])
        }
      })
    })
    return jsonset
  }

  adapter.buildQuery = function buildQuery(data, options, isAssociation) {
    var fields = []
    _.forEach(
      data.properties,
      function(property, name) {
        var fieldName = property.field || name
        var alias = name
        fields.push(
          this.wrap(fieldName) +
            (alias !== fieldName ? ' AS ' + this.wrap(alias) : '')
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
            `(select "${display}" FROM "${property.schema.$ref}" where "${
              property.schema.key
            }"="${data.key}"."${fieldName}") as "${_.camelCase(
              `${data.identity.name} ${name} ${display}`
            )}"`
          )
        }
      }.bind(this)
    )
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    if (updatedAtColumnName) {
      fields.push(this.wrap(updatedAtColumnName))
    }
    _.forEach(
      data.associations,
      function(association) {
        if (!association.data.foreignKey) {
          return false
        }
        const query = this.buildQuery(association.data, options, true)
        var foreignKey =
          association.data.properties[association.data.foreignKey].field ||
          association.data.foreignKey
        fields.push(
          '(select array_to_json(array_agg(row_to_json(t))) from (' +
            query +
            ' WHERE ' +
            this.wrap(foreignKey) +
            '=' +
            this.wrap(data.key) +
            '.' +
            this.wrap(data.primaryKeyFields[0]) +
            ' ORDER BY ' +
            (
              association.data.primaryOrderFields ||
              association.data.primaryKeyFields
            )
              .map(this.wrap.bind(this))
              .join() +
            ') t) AS ' +
            this.wrap(association.data.key)
        )
      }.bind(this)
    )
    let fetchCommand =
      'SELECT ' +
      fields.join(',') +
      ' FROM ' +
      this.wrap(data.identity.name) +
      ' AS ' +
      this.wrap(data.key)
    if (options.schema && !isAssociation) {
      fetchCommand = fetchCommand.replace(
        /" FROM "/g,
        `" FROM ${options.schema}."`
      )
    }
    return fetchCommand
  }

  adapter.getCoercionFunction = function(type, timezone) {
    switch (type) {
      case 'datetime':
        return function(value) {
          if (timezone === 'ignore') {
            var d = new Date(value + 'Z')
            return new Date(d.getTime() + d.getTimezoneOffset() * 60000)
          } else {
            return new Date(value)
          }
        }
      default:
        return function(value) {
          return value
        }
    }
  }

  return adapter
}
