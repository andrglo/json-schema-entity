var _ = require('lodash')
var assert = require('assert')
var common = require('./common')

module.exports = function () {
  var adapter = {
    // Identifiers are escaped by doubling the closing quote character -
    // the standard SQL escape, same as in sql-view - so any character
    // is safe inside them and a name carrying a quote cannot end the
    // identifier early
    wrap: column => `"${column.replace(/"/g, '""')}"`
  }

  adapter.createTimestamps = function (data, options) {
    options = options || {}
    var table = this.wrap(data.identity.name)
    var schema = options.schema
      ? common.checkSchema(options.schema)
      : 'public'
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
            )} TIMESTAMP(3) WITH TIME ZONE`,
            null,
            options
          )
        }
      })
  }

  adapter.buildInsertCommand = function (data) {
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    data.insertCommand = `INSERT INTO ${this.wrap(
      data.identity.name
    )} (<fields>${
      updatedAtColumnName
        ? `,${this.wrap(updatedAtColumnName)}`
        : ''
    }) VALUES (<values>${
      updatedAtColumnName ? `,now()` : ''
    }) RETURNING *`
  }

  adapter.buildUpdateCommand = function (data) {
    const updatedAtColumnName = common.getUpdatedAtColumnName(data)
    data.updateCommand = `UPDATE ${this.wrap(
      data.identity.name
    )} SET <fields-values>${
      updatedAtColumnName
        ? `,${this.wrap(updatedAtColumnName)}=now()`
        : ''
    } WHERE <primary-keys> RETURNING *`
  }

  adapter.buildDeleteCommand = function (data) {
    data.deleteCommand =
      'DELETE FROM ' +
      this.wrap(data.identity.name) +
      ' WHERE <find-keys> RETURNING *'
  }
  adapter.create = common.create
  adapter.update = common.update
  adapter.destroy = common.destroy
  adapter.extractRecordset = function (jsonset, coerce) {
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

  adapter.buildQuery = function buildQuery(
    data,
    options,
    isAssociation
  ) {
    var fields = []
    _.forEach(
      data.properties,
      function (property, name) {
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
            `(select ${this.wrap(display)} FROM ${this.wrap(
              property.schema.$ref
            )} where ${this.wrap(
              property.schema.key
            )}=${this.wrap(data.key)}.${this.wrap(
              fieldName
            )}) as ${this.wrap(
              _.camelCase(
                `${data.identity.name} ${name} ${display}`
              )
            )}`
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
      function (association) {
        if (!association.data.foreignKey) {
          return false
        }
        const query = this.buildQuery(association.data, options, true)
        var foreignKey =
          association.data.properties[association.data.foreignKey]
            .field || association.data.foreignKey
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
      const schema = common.checkSchema(options.schema)
      // a function replacement, not a string one: `$` is a legal schema
      // character and in a replacement string `$$` would collapse to a
      // single `$`, silently renaming the schema
      fetchCommand = fetchCommand.replace(
        /" FROM "/g,
        () => `" FROM ${schema}."`
      )
    }
    return fetchCommand
  }

  // Written once per adapter on purpose: the two dialects are copies
  // free to diverge, not a shared routine with a branch. Here the child
  // and every lookup are schema qualified - the pool is shared between
  // tenants and there is no per connection search_path - and the
  // comparison is folded to case and accent insensitive, as the value
  // arrives already normalized by the caller
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
    const schema =
      options && options.schema
        ? common.checkSchema(options.schema) + '.'
        : ''
    const childAlias = this.wrap(key)
    const foreignKey =
      child.properties[child.foreignKey].field || child.foreignKey
    const joins = []
    const terms = []
    _.forEach(
      child.searchable,
      function (name) {
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
          const lookupAlias = this.wrap(key + '_' + name)
          joins.push(
            ` LEFT JOIN ${schema}${this.wrap(
              property.schema.$ref
            )} AS ${lookupAlias} ON ${lookupAlias}.${this.wrap(
              property.schema.key
            )}=${childAlias}.${this.wrap(
              property.field || name
            )}`
          )
          expression = `${lookupAlias}.${this.wrap(display)}`
        } else {
          expression = `${childAlias}.${this.wrap(
            property.field || name
          )}`
          // f_unaccent takes text and postgres has no implicit cast
          // from a number or a date: without it the query errors
          // where mssql, with its plain like, matches. Only this
          // branch is cast - the type above is the type of the
          // foreign key, never of the column being displayed
          if (property.type !== 'string') {
            expression = `${expression}::text`
          }
        }
        // only the column is folded, never the parameter
        terms.push(
          `lower(public.f_unaccent(${expression})) LIKE ` +
            prepareValue('%' + value + '%')
        )
      }.bind(this)
    )
    // the parent is correlated by its primary key ATTRIBUTE: the outer
    // where sees the derived table, where only the aliases exist
    return (
      `EXISTS (SELECT 1 FROM ${schema}${this.wrap(
        child.identity.name
      )} AS ${childAlias}${joins.join('')}` +
      ` WHERE ${childAlias}.${this.wrap(
        foreignKey
      )}=${outerAlias}.${this.wrap(
        data.primaryKeyAttributes[0]
      )} AND (${terms.join(' OR ')}))`
    )
  }

  adapter.getCoercionFunction = function (type) {
    switch (type) {
      case 'datetime':
        return function (value) {
          return new Date(value)
        }
      default:
        return function (value) {
          return value
        }
    }
  }

  // node-pg parses `timestamp without time zone` values as
  // host-LOCAL Dates, so the lossless inverse for a date-semantics
  // value stored in a timestamp column is local-component
  // formatting. toISOString() here would re-express the wall-clock
  // in UTC and shift the date by one day on hosts east of UTC.
  adapter.plainDate = function (value) {
    const pad = n => String(n).padStart(2, '0')
    return (
      value.getFullYear() +
      '-' +
      pad(value.getMonth() + 1) +
      '-' +
      pad(value.getDate())
    )
  }

  return adapter
}
