var _ = require('lodash')
var assert = require('assert')
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
        if (property.enum) {
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
    insertCommand = `INSERT INTO ${
      options.schema
    }.${insertCommand.substr(12)}`
  }
  return this.db
    .execute(insertCommand, params, options)
    .then(function (recordset) {
      checkRecordsetLength(data, null, recordset.length, 'create')
      var inserted = recordset[0]
      _.forEach(data.properties, function (property, name) {
        var fieldName = property.field || name
        record[name] = inserted[fieldName]
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
        if (property.enum) {
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
    updateCommand = `UPDATE ${options.schema}.${updateCommand.substr(
      7
    )}`
  }
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
    deleteCommand = `DELETE FROM ${
      options.schema
    }.${deleteCommand.substr(12)}`
  }
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
