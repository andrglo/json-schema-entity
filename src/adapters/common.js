var _ = require('lodash')
var assert = require('assert')
const debug = require('debug')('entity:adapter:common')
var EntityError = require('../entity-error')

exports.create = function (record, data, options) {
  options = options || {}
  var fields = []
  var params = []
  _.forEach(data.properties, function (property, name) {
    if (!property.autoIncrement) {
      var value = record[name]
      if (
        (value === void 0 || value === null) &&
        property.defaultValue
      ) {
        value = property.defaultValue
      }
      if (value !== void 0) {
        var field = property.field || name
        fields.push(field)
        // `value !== null` — an explicit null is a caller asking to store SQL
        // NULL, and there is nothing to truncate. Without this guard it throws
        // "Cannot read properties of null (reading 'substr')".
        if (property.enum && value !== null) {
          value = value.substr(0, property.maxLength)
        }
        if (property.mapper?.write) {
          value = property.mapper.write(value, record)
        }
        params.push({
          value: value,
          type: property.type,
          maxLength: property.maxLength,
          decimals: property.decimals,
          timezone: property.timezone
        })
      }
    }
  })
  var index = 1
  var insertCommand = data.insertCommand
    .replace(
      '<fields>',
      fields.reduce((fields, field) => {
        return fields + (fields ? ',' : '') + this.wrap(field)
      }, '')
    )
    .replace(
      '<values>',
      fields.reduce(function (fields) {
        return fields + (fields ? ',' : '') + '$' + index++
      }, '')
    )
  if (options.schema && this.db.dialect === 'postgres') {
    insertCommand = `INSERT INTO ${checkSchema(
      options.schema
    )}.${insertCommand.substr(12)}`
  }
  debug(insertCommand, params)
  return this.db
    .execute(insertCommand, params, options)
    .then(function (recordset) {
      checkRecordsetLength(data, null, recordset.length, 'create')
      var inserted = recordset[0]
      _.forEach(data.properties, function (property, name) {
        var fieldName = property.field || name
        record[name] = inserted[fieldName]
        if (property.type === 'date') {
          if (_.isDate(record[name])) {
            record[name] = record[name].toISOString()
          }
          if (typeof record[name] === 'string') {
            record[name] = record[name].slice(0, 10)
          }
        }
        if (property.mapper?.read) {
          record[name] = property.mapper.read(record[name], record)
        }
      })
      const updatedAtColumnName = exports.getUpdatedAtColumnName(data)
      if (updatedAtColumnName) {
        record.updatedAt = inserted[updatedAtColumnName]
      }
      return record
    })
}

exports.update = function (record, data, options) {
  assert(options.where)
  var fields = []
  var params = []
  _.forEach(data.properties, function (property, name) {
    if (!property.autoIncrement && name !== data.foreignKey) {
      var value = record[name]
      if (value !== void 0) {
        var field = property.field || name
        fields.push(field)
        // See the same guard in `insert` above: an explicit null means SQL
        // NULL, not a string to truncate. Reachable from any client that sends
        // `{"someEnumColumn": null}` to clear a column.
        if (property.enum && value !== null) {
          value = value.substr(0, property.maxLength)
        }
        if (property.mapper?.write) {
          value = property.mapper.write(value, record)
        }
        params.push({
          value: value,
          type: property.type,
          maxLength: property.maxLength,
          decimals: property.decimals,
          timezone: property.timezone
        })
      }
    }
  })
  if (fields.length === 0) {
    return Promise.resolve(record)
  }

  var findKeys = data.primaryKeyFields.map(function (name, index) {
    const attribute = data.primaryKeyAttributes[index]
    params.push(options.where[attribute])
    return name
  })
  const updatedAtColumnName = exports.getUpdatedAtColumnName(data)
  if (updatedAtColumnName) {
    params.push(options.where.updatedAt || null)
    findKeys.push(updatedAtColumnName)
  }

  var index = 0
  var updateCommand = data.updateCommand
    .replace(
      '<fields-values>',
      fields.reduce((fields, field) => {
        return (
          fields +
          (fields ? ',' : '') +
          this.wrap(field) +
          '=$' +
          ++index
        )
      }, '')
    )
    .replace(
      '<primary-keys>',
      findKeys.reduce((fields, field) => {
        return (
          fields +
          (fields ? ' AND ' : '') +
          this.wrap(field) +
          (params[index] === null
            ? params.splice(index, 1) && ' IS NULL'
            : '=$' + ++index)
        )
      }, '')
    )
  if (options.schema && this.db.dialect === 'postgres') {
    updateCommand = `UPDATE ${checkSchema(
      options.schema
    )}.${updateCommand.substr(7)}`
  }
  debug(updateCommand, params)
  return this.db
    .execute(updateCommand, params, options)
    .then(function (recordset) {
      checkRecordsetLength(
        data,
        options.where,
        recordset.length,
        'update'
      )
      var updated = recordset[0]
      _.forEach(data.properties, function (property, name) {
        var fieldName = property.field || name
        record[name] = updated[fieldName]
        if (property.type === 'date') {
          if (_.isDate(record[name])) {
            record[name] = record[name].toISOString()
          }
          if (typeof record[name] === 'string') {
            record[name] = record[name].slice(0, 10)
          }
        }
        if (property.mapper?.read) {
          record[name] = property.mapper.read(record[name], record)
        }
      })
      const updatedAtColumnName = exports.getUpdatedAtColumnName(data)
      if (updatedAtColumnName) {
        record.updatedAt = updated[updatedAtColumnName]
      }
      return record
    })
}

exports.destroy = function (data, options) {
  assert(options.where)
  var params = []
  var findKeys = data.primaryKeyFields.map(function (name, index) {
    const attribute = data.primaryKeyAttributes[index]
    params.push(options.where[attribute])
    return name
  })
  const updatedAtColumnName = exports.getUpdatedAtColumnName(data)
  if (updatedAtColumnName) {
    params.push(options.where.updatedAt || null)
    findKeys.push(updatedAtColumnName)
  }

  var index = 0
  var deleteCommand = data.deleteCommand.replace(
    '<find-keys>',
    findKeys.reduce((fields, field) => {
      return (
        fields +
        (fields ? ' AND ' : '') +
        this.wrap(field) +
        (params[index] === null
          ? params.splice(index, 1) && ' IS NULL'
          : '=$' + ++index)
      )
    }, '')
  )
  if (options.schema && this.db.dialect === 'postgres') {
    deleteCommand = `DELETE FROM ${checkSchema(
      options.schema
    )}.${deleteCommand.substr(12)}`
  }
  debug(deleteCommand, params)
  return this.db
    .execute(deleteCommand, params, options)
    .then(function (recordset) {
      checkRecordsetLength(
        data,
        options.where,
        recordset.length,
        'delete'
      )
      return recordset.length
    })
}

// `options.schema` is the only identifier the caller chooses at request time
// - every other one is read from the entity definition - and it is always
// interpolated in the statement, never parameterized: it qualifies the table
// in the fetch, insert, update and delete commands, and it is compared as a
// literal in the createTimestamps lookup of both dialects. It cannot be
// quoted either: it is emitted bare, so postgres case folds it, and quoting
// it would make every schema name that works today case sensitive. So it is
// proven to be a plain identifier instead, the way sql-view proves a cast
// type and the paging values.
//
// This guards the schema, and ONLY the schema. It does not make the
// createTimestamps lookup a safe statement: the entity name and the
// timestamps suffix are interpolated into that same single-quoted literal
// with no validation at all, so a definition built from a hostile name still
// executes whatever it carries. Those are definition-time values, chosen by
// the developer rather than arriving with the request, which is why they are
// out of scope here - not because they are proven.
//
// `$` IS accepted and that is load bearing, not sloppiness: it is a legal
// identifier character in both dialects, and a multi instance MSSQL database
// is addressed as `instance$name` - one such database, `rigelSql2019$Elba`,
// exists in the field. A class without `$` would break exactly those
// deployments and nowhere else, i.e. it would look green everywhere it is
// tested. A leading digit is NOT rejected either: it is illegal in an
// unquoted postgres identifier, but legal as a bracket quoted MSSQL name.
// This rejects metacharacters, not naming taste.
//
// The class is pinned byte for byte to ONE class in the calling application:
// habilis `app/lib/db/sql-identifier.js`. Not to habilis as a whole - that
// codebase carries a second, narrower class in `app/lib/nfsNacional.js`
// (no `$`) which it also applies to a schema, so the two are already a
// parser differential and this one deliberately follows the looser, correct
// one. That is the failure mode to watch: when two guards over the same
// value disagree, the stricter layer rejects what the looser one admitted,
// and a tenant accepted at one layer starts failing at the next
const SCHEMA_IDENTIFIER = /^[A-Za-z0-9_$]+$/
function checkSchema(value) {
  if (typeof value !== 'string' || !SCHEMA_IDENTIFIER.test(value)) {
    throw new Error('Invalid schema: ' + value)
  }
  return value
}
exports.checkSchema = checkSchema

function checkRecordsetLength(data, key, n, type) {
  if (n === 0 && key) {
    throw new EntityError({
      type: 'RecordModifiedOrDeleted',
      message: `Entity '${data.key}' key ${JSON.stringify(
        key
      )} not found for ${type}`
    })
  }
  assert(n === 1, `${n} records have been ${type}d, expected one`)
}

exports.getUpdatedAtColumnName = function (data) {
  if (data.timestamps) {
    let updatedAtColumnName = 'updated_at'
    if (typeof data.timestamps === 'string') {
      updatedAtColumnName += data.timestamps
    }
    return updatedAtColumnName
  }
}

exports.convertToUpdatedAt = function (record, data, target) {
  const updatedAtColumnName = exports.getUpdatedAtColumnName(data)
  if (record[updatedAtColumnName]) {
    if (target) {
      target.updatedAt = record[updatedAtColumnName]
    } else {
      record.updatedAt = record[updatedAtColumnName]
      delete record[updatedAtColumnName]
    }
  }
}
