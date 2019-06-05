'use strict'

var _ = require('lodash')
var co = require('@ayk/co')
var assert = require('assert')
var sqlView = require('sql-view')
var jst = require('json-schema-table')
var EntityError = require('./entity-error')

const isGenerator = obj =>
  typeof obj.next === 'function' && typeof obj.throw === 'function'

function toArray(obj) {
  return Array.isArray(obj) ? obj : (obj && [obj]) || []
}

const orderAssociations = (record, data) => {
  _.forEach(data.associations, function(association) {
    const key = association.data.key
    const isArray = Array.isArray(record[key])
    if (isArray) {
      if (association.data.primarySortFields) {
        record[key] = _.sortBy(record[key], association.data.primarySortFields)
      }
    }
    if (association.data.associations.length && record[key]) {
      const recordset = isArray ? record[key] : [record[key]]
      for (let i = 0; i < recordset.length; i++) {
        recordset[i] = orderAssociations(recordset[i], association.data)
      }
    }
  })
  return record
}

const hasEqualPrimaryKey = function(a, b, data) {
  let same = false
  _.forEach(data.primaryKeyAttributes, function(name) {
    same = a[name] === b[name] || Number(a[name]) === Number(b[name])
    return same
  })
  return same
}

function validateModel(is, was, data) {
  var errors = []

  function validate(is, was, data) {
    return runModelValidations(is, was, data, errors).then(function() {
      return _.reduce(
          data.associations,
          function(chain, association) {
            return chain.then(function() {
              var associationKey = association.data.key
              var from = is && is[associationKey]
              var to = was && was[associationKey]
              if (_.isArray(from) || _.isArray(to)) {
                from = _.isArray(from) ? from.slice(0) : from ? [from] : []
                to = _.isArray(to) ? to.slice(0) : to ? [to] : []
                var pairs = []

                var findAndRemove = function(arr, obj) {
                  var res = _.remove(arr, function(e) {
                    if (hasEqualPrimaryKey(e, obj, association.data)) {
                      return true
                    }
                  })
                  assert(
                      res.length < 2,
                      'Pair this was for validation should be 1 but found ' +
                    res.length
                  )
                  return res.length === 0 ? void 0 : res[0]
                }

                from.map(function(record) {
                  pairs.push({
                    from: record,
                    to: findAndRemove(to, record)
                  })
                })
                to.map(function(record) {
                  pairs.push({
                    to: record
                  })
                })

                return _.reduce(
                    pairs,
                    function(chain, pair) {
                      return validate(pair.from, pair.to, association.data)
                    },
                    Promise.resolve()
                )
              } else {
                return validate(from, to, association.data)
              }
            })
          },
          Promise.resolve()
      )
    })
  }

  return validate(is, was, data).then(function() {
    if (errors.length > 0) {
      throw new EntityError({
        message: 'Validation error',
        type: 'ValidationError',
        errors: errors
      })
    }
  })
}

function decimalPlaces(num) {
  var match = ('' + num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)
  return (
    (match &&
      Math.max(
          0,
          // Number of digits right of decimal point.
          (match[1] ? match[1].length : 0) -
          // Adjust for scientific notation.
          (match[2] ? +match[2] : 0)
      )) ||
    0
  )
}

function validateFields(is, data) {
  const errors = []

  function validate(is, data) {
    return runFieldValidations(is, data, errors).then(() =>
      data.associations.reduce(
          (chain, association) =>
            chain.then(() =>
              toArray(is && is[association.data.key]).reduce(
                  (chain, is) => chain.then(() => validate(is, association.data)),
                  Promise.resolve()
              )
            ),
          Promise.resolve()
      )
    )
  }

  return validate(is, data).then(() => {
    if (errors.length > 0) {
      throw new EntityError({
        message: 'Validation error',
        type: 'ValidationError',
        errors: errors
      })
    }
  })
}

function runFieldValidations(is, data, errors) {
  var validator = data.validator
  return Promise.resolve()
      .then(function() {
        _.forEach(is && data.properties, function(property, key) {
          if (is[key] && is[key] !== null) {
            var value = is[key]
            if (
              property.enum &&
            property.enum.indexOf(value) === -1 &&
            (property.maxLength &&
              property.enum
                  .map(value => value.substr(0, property.maxLength))
                  .indexOf(value) === -1)
            ) {
              errors.push({
                path: key,
                message:
                'Value \'' +
                value +
                '\' not valid. Options are: ' +
                property.enum.join()
              })
            }
            if (
              !property.enum &&
            property.maxLength &&
            String(value).length > property.maxLength
            ) {
              errors.push({
                path: key,
                message:
                'Value \'' +
                value +
                '\' exceeds maximum length: ' +
                property.maxLength
              })
            }
            if (property.decimals && decimalPlaces(value) > property.decimals) {
              errors.push({
                path: key,
                message:
                'Value \'' +
                value +
                '\' exceeds maximum decimals length: ' +
                property.decimals
              })
            }
          }
        })
      })
      .then(function() {
        return _.reduce(
            is && validator && data.properties,
            function(chain, property, key) {
              var validations = {}
              if (is[key]) {
                _.forEach(property.validate, function(validate, name) {
                  var args = _.map(validate.args, function(arg) {
                    if (typeof arg === 'string' && arg.substr(0, 5) === 'this.') {
                      return is[arg.substring(5)]
                    } else {
                      return arg
                    }
                  })
                  validations[name] = {
                    id: key,
                    message: validate.message,
                    fn: validator[name],
                    args: [is[key]].concat(args)
                  }
                })
                if (
                  property.format &&
              !validations[property.format] &&
              validator[property.format]
                ) {
                  validations[property.format] = {
                    id: key,
                    fn: validator[property.format],
                    args: [is[key]]
                  }
                }
              }
              return _.reduce(
                  validations,
                  function(chain, validation) {
                    return chain.then(function() {
                      var res
                      try {
                        res = validation.fn.apply(validator, validation.args)
                      } catch (err) {
                        errors.push({path: validation.id, message: err.message})
                      }
                      if (res === false) {
                        errors.push({
                          path: validation.id,
                          message: validation.message || 'Invalid ' + validation.id
                        })
                      }
                    })
                  },
                  chain
              )
            },
            Promise.resolve()
        )
      })
}

function runModelValidations(is, was, data, errors) {
  return _.reduce(
      data.validate,
      function(chain, validation) {
        return chain.then(function() {
          if (
            !(
              (is && !was && validation.options.onCreate) ||
            (is && was && validation.options.onUpdate) ||
            (!is && was && validation.options.onDestroy)
            )
          ) {
            return
          }
          var res
          try {
            res = validation.fn.call(is || was)
            if (res && isGenerator(res)) {
              res = co(res)
            }
          } catch (err) {
            errors.push({path: validation.id, message: err.message})
          }
          if (res && res.then) {
            return res.catch(function(err) {
              errors.push({path: validation.id, message: err.message})
            })
          } else {
            if (res === false) {
              errors.push({
                path: validation.id,
                message: 'Invalid ' + validation.id
              })
            }
          }
        })
      },
      Promise.resolve()
  )
}

const tableRecordInfo = new WeakMap()
const tableRecordData = new WeakMap()
const timeStampsColumns = ['createdAt', 'updatedAt']

class TableRecord {
  constructor(trs, record, isNew, parent) {
    const it = {
      isNew,
      parent,
      info: tableRecordInfo.get(trs),
      values: {}
    }
    tableRecordData.set(this, it)
    it.info.data.instanceMethods.map(method =>
      Object.defineProperty(this, method.id, {
        value: method.fn
      })
    )
    setIs(this, record, it, isNew)
    Object.freeze(this)
  }

  get entity() {
    return tableRecordData.get(this).parent.self
  }

  validate() {
    const it = tableRecordData.get(this)
    return validateModel(this, this.was, it.info.data)
  }

  save(options) {
    let entityData = tableRecordData.get(this)
    const entity = entityData.parent.tableRecord
    entityData = entity === this ? entityData : tableRecordData.get(entity)
    if (entityData.isNew) {
      return entityData.parent.self.create(entity, options).then(function() {
        entityData.isNew = false
      })
    }
    return entityData.parent.self.update(entity, null, options)
  }

  destroy(options) {
    let entityData = tableRecordData.get(this)
    const entity = entityData.parent.tableRecord
    entityData = entity === this ? entityData : tableRecordData.get(entity)
    if (entityData.isNew) {
      return new Promise(function(resolve, reject) {
        reject(
            new EntityError({
              type: 'InvalidOperation',
              message: 'Instance is new'
            })
        )
      })
    }
    var primaryKey = entityData.info.data.entity.primaryKeyAttributes[0]
    var key = {where: {}}
    key.where[primaryKey] = entity[primaryKey]
    if (entityData.info.data.entity.timestamps) {
      key.where.updatedAt = entity.updatedAt || null
    }
    return entityData.parent.self
        .destroy(key, options, entity)
        .then(function() {
          entityData.isNew = true
          var is = entityData.values
          is.createdAt = void 0
          is.updatedAt = void 0
          entityData.was = Object.freeze({})
        })
  }

  get was() {
    return tableRecordData.get(this).was
  }

  get db() {
    return tableRecordData.get(this).parent.self.db
  }
}

function instanceParent(value) {
  return tableRecordData.get(value).parent
}

function isSameEntityInstance(value, parent) {
  return (
    value instanceof TableRecord &&
    parent &&
    instanceParent(value).tableRecord === parent.tableRecord
  )
}

class TableRecordSchema {
  constructor(data) {
    const columns = new Map()
    const methods = {}
    const keys = []
    tableRecordInfo.set(this, {columns, methods, data, keys})

    _.forEach(data.properties, function(property, name) {
      columns.set(name, function(value) {
        if (value && value !== null) {
          if (property.enum) {
            let found
            _.forEach(property.enum, function(item) {
              if (
                item === value ||
                item.substring(0, property.maxLength) === value
              ) {
                value = item
                found = true
                return false
              }
            })
            if (!found) {
              throw new EntityError({
                type: 'InvalidColumnData',
                message: 'Invalid value',
                errors: [
                  {
                    path: name,
                    message:
                      'Value \'' +
                      value +
                      '\' not valid. Options are: ' +
                      property.enum.join()
                  }
                ]
              })
            }
          } else {
            switch (property.type) {
              case 'date':
                value =
                  value instanceof Date
                    ? value.toISOString().substr(0, 10)
                    : value
                break
            }
          }

          var validator = data.validator
          if (validator) {
            var values = this.values
            var validations = []
            var format = property.format
            _.forEach(property.validate, function(validate, key) {
              var args = _.map(validate.args, function(arg) {
                if (typeof arg === 'string' && arg.substr(0, 5) === 'this.') {
                  return values[arg.substring(5)]
                } else {
                  return arg
                }
              })
              validations.push({
                message: validate.message || key,
                fn: validator[key],
                args: [value].concat(args)
              })
              if (key === format) {
                format = null
              }
            })
            if (format && validator[format]) {
              validations.push({
                message: 'Invalid format',
                fn: validator[format],
                args: [value]
              })
            }
            _.forEach(validations, function(validation) {
              if (validation.fn.apply(validator, validation.args) === false) {
                throw new EntityError({
                  message: `Validation for '${name}' failed: ${
                    validation.message
                  }`,
                  type: 'ValidationError',
                  errors: [{path: name, message: validation.message}]
                })
              }
            })
          }
        }
        this.values[name] = value
      })
    })

    _.forEach(data.associations, function(association) {
      var name = association.data.key
      columns.set(name, function(value) {
        var build = value =>
          isSameEntityInstance(value, this.parent)
            ? value
            : buildEntity(
                Object.assign({}, value),
                association.data,
                this.isNew,
                false,
                void 0,
                void 0,
                this.parent
            )
        this.values[name] = Array.isArray(value)
          ? value.map(value => build(value))
          : value
          ? build(value)
          : value
      })
    })

    if (data.timestamps) {
      columns.set('createdAt', function() {
        throw new Error('Column createdAt cannot be modified')
      })
      columns.set('updatedAt', function() {
        throw new Error('Column updatedAt cannot be modified')
      })
    }

    for (var key of columns.keys()) {
      keys.push(key)
    }
  }
}

function setIs(instance, record, it, isNew) {
  const alreadyBuilt = it === void 0
  it = it || tableRecordData.get(instance)
  const was = {}
  it.info.columns.forEach(function(value, key) {
    if (!alreadyBuilt) {
      Object.defineProperty(instance, key, {
        get: function() {
          return it.values[key]
        },
        set: it.info.columns.get(key).bind(it),
        enumerable: true
      })
    }

    const newValue = record[key]
    if (newValue !== void 0) {
      if (timeStampsColumns.indexOf(key) !== -1) {
        it.values[key] = newValue
        was[key] = newValue
      } else {
        try {
          instance[key] = newValue
        } catch (e) {
          it.values[key] = newValue // force
        }
        if (_.isArray(newValue)) {
          was[key] =
            'was' in newValue
              ? newValue.was
              : newValue.map(newValue =>
                  'was' in newValue ? newValue.was : _.cloneDeep(instance[key])
              )
        } else if (_.isObject(newValue)) {
          was[key] =
            'was' in newValue ? newValue.was : _.cloneDeep(instance[key])
        } else {
          was[key] = instance[key]
        }
      }
    } else {
      it.values[key] = void 0
    }
  })

  function exists(record) {
    return isNew !== true || record[it.info.data.foreignKey] !== void 0
  }

  if (exists(record)) {
    Object.freeze(was)
    it.was = was
  }
}

function clearNulls(obj) {
  Object.keys(obj).forEach(function(key) {
    if (obj[key] === null) {
      delete obj[key]
    }
  })
}

const isEmpty = v => v === void 0 || v === null

function buildPlainObject(record, data) {
  clearNulls(record)
  const props = data.schema.properties
  Object.keys(record).forEach(key => {
    const prop = props[key]
    if (!prop) {
      return
    }
    const value = record[key]
    switch (prop.type) {
      case 'date':
        record[key] =
          value instanceof Date ? value.toISOString().substr(0, 10) : value
        break
    }
    if (prop.enum) {
      _.forEach(prop.enum, item => {
        if (item === value || item.substring(0, prop.maxLength) === value) {
          record[key] = item
          return false
        }
      })
    }
  })
  _.forEach(data.associations, function(association) {
    var key = association.data.key
    if (!isEmpty(record[key])) {
      var recordset = data.adapter.extractRecordset(
          record[key],
          association.data.coerce
      )
      for (var i = 0; i < recordset.length; i++) {
        recordset[i] = buildPlainObject(recordset[i], association.data)
      }
      record[key] =
        recordset.length === 1 && association.type === 'hasOne'
          ? recordset[0]
          : recordset
    }
  })
  if (record.created_at) {
    record.createdAt = record.created_at
    delete record.created_at
  }
  if (record.updated_at) {
    record.updatedAt = record.updated_at
    delete record.updated_at
  }
  return record
}

function updateEntity(entity, values, data) {
  data.propertiesList
      .filter(key => key !== 'updatedAt' && key !== 'createdAt')
      .forEach(key => {
        if (values[key] !== undefined) {
          entity[key] = values[key]
        }
      })
  _.forEach(data.associations, function(association) {
    const extract = function(set, record) {
      set = _.isArray(set) ? set : [set].filter(Boolean)
      for (const item of set) {
        if (hasEqualPrimaryKey(item, record, association.data)) {
          return item
        }
      }
    }

    const key = association.data.key
    if (values[key] === null) {
      entity[key] = null
    } else if (values[key] !== undefined) {
      if (association.type === 'hasMany') {
        const valueSet = _.isArray(values[key])
          ? values[key]
          : [values[key]].filter(Boolean)
        entity[key] = valueSet.map(value => {
          return updateEntity(
              extract(entity[key], value) || {},
              value,
              association.data
          )
        })
      } else {
        entity[key] = updateEntity(
            entity[key] || {},
            values[key],
            association.data
        )
      }
    }
  })
  return entity
}

function buildEntity(record, data, isNew, fromFetch, instance, self, parent) {
  clearNulls(record)
  const isParent = !parent
  parent = parent || (instance && instanceParent(instance)) || {self}
  const associations = isSameEntityInstance(instance, parent) ? record : {}
  _.forEach(data.associations, function(association) {
    var key = association.data.key
    if (!isEmpty(record[key])) {
      var recordset = fromFetch
        ? data.adapter.extractRecordset(record[key], association.data.coerce)
        : _.isArray(record[key])
        ? record[key]
        : [record[key]]
      var instanceSet = instance
        ? _.isArray(instance[key])
          ? instance[key]
          : [instance[key]]
        : void 0
      for (var i = 0; i < recordset.length; i++) {
        recordset[i] = buildEntity(
            recordset[i],
            association.data,
            isNew,
            fromFetch,
            instanceSet && instanceSet[i],
            void 0,
            parent
        )
      }
      associations[key] =
        recordset.length === 1 && association.type === 'hasOne'
          ? recordset[0]
          : recordset
    }
  })
  if (isSameEntityInstance(instance, parent)) {
    setIs(instance, record)
    return instance
  } else {
    const r = _.extend(_.pick(record, data.propertiesList), associations)
    if (record.created_at) {
      r.createdAt = record.created_at
    }
    if (record.updated_at) {
      r.updatedAt = record.updated_at
    }
    const tableRecord = new TableRecord(data.trs, r, isNew, parent)
    if (isParent) {
      parent.tableRecord = tableRecord
    }
    return tableRecord
  }
}

function runHooks(hooks, model, options, data, validatedInstance) {
  var allHooks = []
  hooks.map(function(name) {
    allHooks = allHooks.concat(data.hooks[name])
  })
  return _.reduce(
      allHooks,
      function(chain, hook) {
        return chain.then(function() {
          var res
          try {
            res = hook.fn.call(
                validatedInstance || model,
                options,
            validatedInstance ? model : void 0
            )
            if (res && isGenerator(res)) {
              res = co(res)
            }
          } catch (err) {
            throw new EntityError({
              type: hook.name + 'HookError',
              message: err.message,
              errors: [{path: hook.id, message: err.message}],
              err
            })
          }
          if (res && res.then) {
            return res.catch(function(err) {
              throw new EntityError({
                message: hook.name + ' hook error',
                errors: [{path: hook.id, message: err.message}],
                err
              })
            })
          }
        })
      },
      Promise.resolve()
  )
}

function create(entity, options, data, adapter) {
  var record
  return runHooks(['beforeCreate', 'beforeSave'], entity, options, data)
      .then(function() {
        record = _.pick(entity, data.propertiesList)
        return adapter.create(record, data, options).then(function(record) {
          var newEntity = _.pick(record, data.propertiesList)
          return _.reduce(
              data.associations,
              function(chain, association) {
                const associationKey = association.data.key
                var associatedEntity = entity[associationKey]
                const recordIsArray = _.isArray(associatedEntity)
                var hasMany =
              (recordIsArray && associatedEntity.length > 1) ||
              association.type === 'hasMany'
                if (association.type === 'hasOne' && hasMany) {
                  throw new EntityError({
                    type: 'InvalidData',
                    message:
                  'Association ' + associationKey + ' can not be an array'
                  })
                }
                associatedEntity =
              associatedEntity === void 0 || recordIsArray
                ? associatedEntity
                : [associatedEntity]
                return _.reduce(
                    associatedEntity,
                    function(chain, entity) {
                      entity[association.data.foreignKey] =
                  newEntity[data.primaryKeyAttributes[0]]
                      return chain.then(function() {
                        return create(
                            entity,
                            options,
                            association.data,
                            adapter
                        ).then(function(associationEntity) {
                          if (hasMany) {
                            newEntity[associationKey] =
                        newEntity[associationKey] || []
                            newEntity[associationKey].push(associationEntity)
                          } else {
                            newEntity[associationKey] = associationEntity
                          }
                        })
                      })
                    },
                    chain
                )
              },
              Promise.resolve()
          ).then(function() {
            return newEntity
          })
        })
      })
      .then(function(newRecord) {
        return runHooks(
            ['afterCreate', 'afterSave'],
            newRecord,
            options,
            data,
            entity
        ).then(function() {
          return newRecord
        })
      })
}

function update(entity, was, options, data, adapter) {
  var record
  return runHooks(['beforeUpdate', 'beforeSave'], entity, options, data)
      .then(function() {
        record = _.pick(entity, data.propertiesList)
        options = Object.assign({}, options, {where: {}})
        data.primaryKeyAttributes.map(function(field) {
          if (entity[field] !== undefined || options.where[field] === undefined) {
            options.where[field] =
            entity[field] === undefined ? null : entity[field]
          }
        })
        if (data.timestamps && entity.updatedAt !== undefined) {
          options.where.updatedAt = entity.updatedAt || null
        }
        return adapter.update(record, data, options).then(function(res) {
          assert(
              res[0] === 1 || (typeof res === 'object' && res[0] === void 0),
              'Record of ' +
            data.key +
            ' found ' +
            res[0] +
            ' times for update, expected 1.' +
            ' Check if your entity has two association with the same foreign key'
          )
          var modifiedEntity = record
          return _.reduce(
              data.associations,
              function(chain, association) {
                const associationKey = association.data.key

                function exists(a) {
                  return a[association.data.foreignKey]
                }

                var find = function(entity, entities) {
                  if (!_.isArray(entities)) {
                    return entities
                  }
                  for (var i = 0; i < entities.length; i++) {
                    var obj = entities[i]
                    if (hasEqualPrimaryKey(entity, obj, association.data)) {
                      return obj
                    }
                  }
                  throw new EntityError({
                    type: 'InvalidData',
                    message:
                  'Record ' +
                  JSON.stringify(entity) +
                  ' in association ' +
                  associationKey +
                  ' has no previous data'
                  })
                }

                var associatedIsEntity = entity[associationKey]
                var hasMany =
              (_.isArray(associatedIsEntity) &&
                associatedIsEntity.length > 1) ||
              association.type === 'hasMany'
                if (association.type === 'hasOne' && hasMany) {
                  throw new EntityError({
                    type: 'InvalidData',
                    message:
                  'Association ' + associationKey + ' can not be an array'
                  })
                }

                var primaryKeyValue = entity[data.primaryKeyAttributes[0]]

                associatedIsEntity = _.isArray(associatedIsEntity)
              ? associatedIsEntity
              : associatedIsEntity
              ? [associatedIsEntity]
              : void 0
                var toBeCreated = []
                var toBeUpdated = []
                _.forEach(associatedIsEntity, function(is) {
                  if (is[association.data.foreignKey] !== void 0) {
                    // Should convert to string before comparing
                    if (is[association.data.foreignKey] != primaryKeyValue) {
                  // eslint-disable-line
                      throw new EntityError({
                        type: 'InvalidData',
                        message:
                      'Foreign key in ' +
                      association.data.key +
                      ' does not match primary key of ' +
                      data.key
                      })
                    }
                  }
                  if (exists(is)) {
                    toBeUpdated.push(is)
                  } else {
                    toBeCreated.push(is)
                  }
                })

                var associatedWasEntity = was[associationKey]
                associatedWasEntity = _.isArray(associatedWasEntity)
              ? associatedWasEntity
              : associatedWasEntity
              ? [associatedWasEntity]
              : void 0
                var toBeDeleted = []
                _.forEach(associatedWasEntity, function(was) {
                  var hasIs = false
                  _.forEach(toBeUpdated, function(is) {
                    if (hasEqualPrimaryKey(was, is, association.data)) {
                      hasIs = true
                      return false
                    }
                  })
                  if (!hasIs) {
                    toBeDeleted.push(was)
                  }
                })

                return _.reduce(
                    toBeDeleted,
                    function(chain, entity) {
                      return chain.then(function() {
                        return destroy(entity, options, association.data, adapter)
                      })
                    },
                    chain
                )
                    .then(function() {
                      return _.reduce(
                          toBeUpdated,
                          function(chain, entity) {
                            return chain.then(function() {
                              return update(
                                  entity,
                                  find(entity, was[association.data.key]),
                                  options,
                                  association.data,
                                  adapter
                              ).then(function(associationEntity) {
                                if (hasMany) {
                                  modifiedEntity[associationKey] =
                            modifiedEntity[associationKey] || []
                                  modifiedEntity[associationKey].push(associationEntity)
                                } else {
                                  modifiedEntity[associationKey] = associationEntity
                                }
                              })
                            })
                          },
                          chain
                      )
                    })
                    .then(function() {
                      return _.reduce(
                          toBeCreated,
                          function(chain, entity) {
                            entity[association.data.foreignKey] =
                      modifiedEntity[data.primaryKeyAttributes[0]]
                            return chain.then(function() {
                              return create(
                                  entity,
                                  options,
                                  association.data,
                                  adapter
                              ).then(function(associationEntity) {
                                if (hasMany) {
                                  modifiedEntity[associationKey] =
                            modifiedEntity[associationKey] || []
                                  modifiedEntity[associationKey].push(associationEntity)
                                } else {
                                  modifiedEntity[associationKey] = associationEntity
                                }
                              })
                            })
                          },
                          chain
                      )
                    })
              },
              Promise.resolve()
          ).then(function() {
            return modifiedEntity
          })
        })
      })
      .then(function(updatedRecord) {
        return runHooks(
            ['afterUpdate', 'afterSave'],
            updatedRecord,
            options,
            data,
            entity
        ).then(function() {
          return updatedRecord
        })
      })
}

function destroy(entity, options, data, adapter) {
  return runHooks(['beforeDelete', 'beforeDestroy'], entity, options, data)
      .then(function() {
        return _.reduce(
            data.associations,
            function(chain, association) {
              const associationKey = association.data.key
              var associatedEntity = entity[associationKey]
              const recordIsArray = _.isArray(associatedEntity)
              associatedEntity =
            associatedEntity === void 0 || recordIsArray
              ? associatedEntity
              : [associatedEntity]
              return _.reduce(
                  associatedEntity,
                  function(chain, entity) {
                    return chain.then(function() {
                      return destroy(entity, options, association.data, adapter)
                    })
                  },
                  chain
              )
            },
            Promise.resolve()
        ).then(function() {
          options = Object.assign({}, options, {where: {}})
          data.primaryKeyAttributes.map(function(field) {
            options.where[field] =
            entity[field] === undefined ? null : entity[field]
          })
          if (data.timestamps) {
            options.where.updatedAt = entity.updatedAt || null
          }
          return adapter.destroy(data, options)
        })
      })
      .then(function(deletedEntity) {
        return runHooks(
            ['afterDestroy', 'afterDelete'],
            deletedEntity,
            options,
            data,
            entity
        )
      })
}

module.exports = function(schemaName, schema, config) {
  config = Object.assign({}, config)
  config.dialect = config.dialect || 'postgres'
  var adapter = getAdapter(config.dialect)
  var sv = sqlView(config.dialect)
  var entity = entityFactory(schemaName, schema, rebuild)
  entity.entity = entity

  function entityFactory(schemaName, schema, rebuild) {
    const publicAssociationMethods = [
      'setTitle',
      'setDescription',
      'setProperties',
      'hasMany',
      'hasOne',
      'validate',
      'instanceMethod',
      'foreignKey',
      'beforeCreate',
      'afterCreate',
      'beforeUpdate',
      'afterUpdate',
      'beforeSave',
      'afterSave',
      'beforeDelete',
      'afterDelete',
      'beforeDestroy',
      'afterDestroy'
    ]
    const reservedInstanceMethodsNames = [
      'constructor',
      'entity',
      'validate',
      'save',
      'destroy',
      'was',
      'db'
    ]
    const identity = splitAlias(schemaName)
    var data = {
      validator: config.validator,
      identity: identity,
      table: schema || {},
      adapter, // Use only when db access is not required
      title: schema && schema.title,
      description: schema && schema.description,
      key: identity.as || identity.name,
      associations: [],
      requestedProperties: (schema && schema.properties) || {},
      reservedInstanceMethodsNames,
      propertiesList: [],
      schema: {},
      primaryKey: schema.primaryKey,
      hooks: {},
      coerce: [],
      public: {
        new(db) {
          var newEntity = {}
          data.entityMethods.map(method =>
            Object.defineProperty(newEntity, method.id, {
              value: method.fn
            })
          )
          return Object.assign(newEntity, {
            get db() {
              return db // For db access
            },
            get adapter() {
              return Object.assign({db}, adapter) // For db access
            },
            get id() {
              return data.public.id
            },
            get alias() {
              return data.public.alias
            },
            get schema() {
              return data.public.schema
            },
            fetch(criteria, options) {
              criteria = criteria || {}
              var self = this
              return Promise.resolve().then(function() {
                options = options || {}
                var where = _.extend({}, criteria.where, data.scope)
                if (where.updatedAt !== undefined) {
                  where.updated_at = where.updatedAt
                  delete where.updatedAt
                }
                if (where.createdAt !== undefined) {
                  where.created_at = where.createdAt
                  delete where.createdAt
                }
                criteria = _.extend({}, criteria)
                criteria.where = where
                var view = sv.build(
                    adapter.buildQuery(entity, options),
                    criteria
                )
                return db
                    .query(view.statement, view.params, options)
                    .then(function(res) {
                      return res.map(function(record) {
                        return options.toPlainObject === true ||
                        options.fetchExternalDescription === true
                        ? buildPlainObject(record, data)
                        : buildEntity(record, data, false, true, void 0, self)
                      })
                    })
              })
            },
            create: function(entity, options) {
              options = options || {}
              var self = this
              var isInstance =
                entity instanceof TableRecord && entity.entity === this
              return (isInstance
                ? Promise.resolve()
                : validateFields(entity, data)
              )
                  .then(function() {
                    entity = isInstance
                    ? entity
                    : buildEntity(entity, data, true, void 0, void 0, self)
                  })
                  .then(function() {
                    return validateModel(entity, void 0, data, options)
                        .then(function() {
                          return options.transaction
                        ? create(entity, options, data, self.adapter)
                        : db.transaction(function(transaction) {
                          return create(
                              entity,
                              Object.assign({}, options, {transaction}),
                              data,
                              self.adapter
                          )
                        }, options)
                        })
                        .then(function(record) {
                          orderAssociations(record, data)
                          return options.toPlainObject === true && !isInstance
                        ? record
                        : buildEntity(record, data, false, false, entity, self)
                        })
                  })
            },
            update: function(entity, key, options) {
              var self = this
              key = key || entity[data.primaryKeyAttributes[0]]
              if (!key) {
                return Promise.resolve().then(function() {
                  throw new EntityError({
                    type: 'InvalidArgument',
                    message:
                      'Entity ' + data.key + ' need a primary key for update'
                  })
                })
              }
              options = options || {}
              if (typeof key !== 'object') {
                var id = key
                key = {where: {}}
                key.where[data.primaryKeyAttributes[0]] = id
              } else if (!key.where) {
                return Promise.resolve().then(function() {
                  throw new EntityError({
                    type: 'InvalidArgument',
                    message:
                      'Where clause not defined for entity ' +
                      data.key +
                      ' update'
                  })
                })
              }
              if (data.timestamps) {
                const updatedAt = entity.updatedAt || key.where.updatedAt
                if (updatedAt !== undefined) {
                  key.where.updatedAt = updatedAt || null
                }
              }
              var isInstance =
                entity instanceof TableRecord && entity.entity === this
              return (isInstance
                ? Promise.resolve([entity.was])
                : this.fetch(key, options)
              ).then(function(was) {
                if (was.length === 0) {
                  throw new EntityError({
                    type: 'RecordModifiedOrDeleted',
                    message:
                      'Entity {' +
                      data.key +
                      '} key ' +
                      JSON.stringify(key.where) +
                      ' not found for update'
                  })
                }
                assert(was.length === 1)

                return (isInstance
                  ? Promise.resolve()
                  : validateFields(entity, data)
                )
                    .then(function() {
                      entity = isInstance
                      ? entity
                      : updateEntity(
                          buildEntity(
                              _.cloneDeep(was[0]),
                              data,
                              void 0,
                              void 0,
                              void 0,
                              self
                          ),
                          entity,
                          data
                      )
                    })
                    .then(function() {
                      return validateModel(entity, was[0], data, options)
                    })
                    .then(function() {
                      return options.transaction
                      ? update(entity, was[0], options, data, self.adapter)
                      : db.transaction(function(transaction) {
                        return update(
                            entity,
                            was[0],
                            Object.assign({}, options, {transaction}),
                            data,
                            self.adapter
                        )
                      }, options)
                    })
                    .then(function(record) {
                      orderAssociations(record, data)
                      return options.toPlainObject === true && !isInstance
                      ? record
                      : buildEntity(record, data, false, false, entity, self)
                    })
              })
            },
            destroy: function(key, options, entity) {
              var self = this
              if (!key) {
                return Promise.resolve().then(function() {
                  throw new EntityError({
                    type: 'InvalidArgument',
                    message:
                      'Entity ' + data.key + ' need a primary key for delete'
                  })
                })
              }
              options = options || {}
              if (typeof key !== 'object') {
                var id = key
                key = {where: {}}
                key.where[data.primaryKeyAttributes[0]] = id
              } else if (!key.where) {
                return Promise.resolve().then(function() {
                  throw new EntityError({
                    type: 'InvalidArgument',
                    message:
                      'Where clause not defined for entity ' +
                      data.key +
                      ' delete'
                  })
                })
              }
              if (data.timestamps) {
                key.where.updatedAt = key.where.updatedAt || null
              }
              var isInstance =
                entity instanceof TableRecord && entity.entity === this
              return (isInstance
                ? Promise.resolve([entity.was])
                : this.fetch(key, options)
              ).then(function(was) {
                if (was.length === 0) {
                  throw new EntityError({
                    type: 'RecordModifiedOrDeleted',
                    message:
                      'Entity {' +
                      data.key +
                      '} key ' +
                      JSON.stringify(key.where) +
                      ' not found for delete'
                  })
                }
                assert(was.length === 1)
                return (isInstance
                  ? Promise.resolve()
                  : validateFields(entity, data)
                )
                    .then(function() {
                      entity = isInstance ? entity : was[0]
                    })
                    .then(function() {
                      return validateModel(void 0, entity, data, options)
                    })
                    .then(function() {
                      return options.transaction
                      ? destroy(entity, options, data, self.adapter)
                      : db.transaction(function(transaction) {
                        return destroy(
                            entity,
                            Object.assign({}, options, {transaction}),
                            data,
                            self.adapter
                        )
                      }, options)
                    })
              })
            },
            createInstance: function(entity) {
              return buildEntity(entity || {}, data, true, void 0, void 0, this)
            },
            createTables: function() {
              var self = this
              return Promise.resolve().then(function() {
                var tables = []
                getTables(data, tables)
                var jsts = []
                tables.map(function(table) {
                  jsts.push(jst(table.name, table.schema, {db: self.db}))
                })
                return jsts.reduce(function(promise, jst) {
                  return promise.then(function() {
                    return jst.create().then(function() {
                      if (data.timestamps) {
                        return self.adapter.createTimestamps(data)
                      }
                    })
                  })
                }, Promise.resolve())
              })
            },
            syncTables: function() {
              var self = this
              return Promise.resolve().then(function() {
                var tables = []
                getTables(data, tables)
                var jsts = []
                tables.map(function(table) {
                  jsts.push(jst(table.name, table.schema, {db: self.db}))
                })
                return jsts.reduce(function(promise, jst) {
                  return promise.then(function() {
                    return jst.sync()
                  })
                }, Promise.resolve())
              })
            }
          })
        }
      },
      methods: {
        setTitle: function(title) {
          data.title = title
          rebuild()
          return data.public
        },
        setDescription: function(description) {
          data.description = description
          rebuild()
          return data.public
        },
        setProperties: function(cb) {
          cb(data.requestedProperties)
          data.table.properties = data.requestedProperties
          rebuild()
          return data.public
        },
        setScope: function(scope) {
          data.scope = scope
          rebuild()
          return data.public
        },
        useTimestamps: function() {
          data.timestamps = true
          rebuild()
          return data.public
        },
        hasMany: function(schemaName, schema, options) {
          var association = entityFactory(schemaName, schema, rebuild)
          association.entity = entity
          association.isAssociation = true
          data.methods[association.key] = association.methods
          data.public[association.key] = association.public
          publicAssociationMethods.map(function(name) {
            data.public[association.key][name] = association.methods[name]
          })
          if (options && options.orderBy) {
            const orderBy = Array.isArray(options.orderBy)
              ? options.orderBy
              : options.orderBy.split(',')
            association.primarySortFields = orderBy
            association.primaryOrderFields = orderBy.map(
                field => schema.properties[field].field || field
            )
          }
          data.associations.push({type: 'hasMany', data: association})
          rebuild()
          return data.public[association.key]
        },
        hasOne: function(schemaName, schema) {
          var association = entityFactory(schemaName, schema, rebuild)
          association.entity = entity
          association.isAssociation = true
          data.methods[association.key] = association.methods
          data.public[association.key] = association.public
          publicAssociationMethods.map(function(name) {
            data.public[association.key][name] = association.methods[name].bind(
                association.methods
            )
          })
          data.associations.push({type: 'hasOne', data: association})
          rebuild()
          return data.public[association.key]
        },
        foreignKey: function(name) {
          data.foreignKey = name
          rebuild()
          return data.public
        },
        get id() {
          return identity.name
        },
        get alias() {
          return identity.as
        },
        get schema() {
          function buildSchema(data) {
            var schema = data.schema
            _.forEach(data.associations, function(association) {
              var key = association.data.key
              if (association.type === 'hasOne') {
                schema.properties[key] = buildSchema(association.data)
              } else {
                schema.properties[key] = {
                  type: 'array',
                  items: buildSchema(association.data)
                }
              }
            })
            return data.schema
          }

          return {
            get() {
              return buildSchema(data)
            },

            primaryKey() {
              return data.primaryKeyAttributes.slice()
            },

            tables() {
              var tables = []
              getTables(data, tables)
              var res = {}
              tables.forEach(table => {
                res[table.name] = res[table.name] || table.schema
                return res[table.name]
              })
              return res
            }
          }
        }
      }
    }

    var methodId = 0

    function addHook(name, id, fn) {
      fn = fn || id
      id = typeof id === 'string' ? id : (methodId++).toString()
      data.hooks[name].push({id: id, fn: fn, name: name})
    }

    ;[
      'beforeCreate',
      'afterCreate',
      'beforeUpdate',
      'afterUpdate',
      'beforeSave',
      'afterSave',
      'beforeDelete',
      'afterDelete',
      'beforeDestroy',
      'afterDestroy'
    ].map(function(name) {
      data.hooks[name] = []
      data.methods[name] = function(id, fn) {
        addHook(name, id, fn)
      }
    })

    data.validate = []
    data.methods.validate = function(id, fn, options) {
      options = options || {}
      var normalizedOptions = {
        onCreate: true,
        onUpdate: true,
        onDestroy: false
      }
      if (options.onDelete === true || options.onDestroy === true) {
        normalizedOptions.onDestroy = true
      }
      if (options.onSave === false || options.onCreate === false) {
        normalizedOptions.onCreate = false
      }
      if (options.onSave === false || options.onUpdate === false) {
        normalizedOptions.onUpdate = false
      }
      fn = fn || id
      id = typeof id === 'string' ? id : (methodId++).toString()
      data.validate.push({id: id, fn: fn, options: normalizedOptions})
    }

    data.instanceMethods = []
    data.methods.instanceMethod = function(id, fn) {
      assert(id, 'Method should have an identification')
      assert(fn, 'Method missing')
      if (_.find(data.instanceMethods, ['id', id])) {
        throw new EntityError({
          type: 'InvalidArgument',
          message: 'Instance method ' + id + ' is already defined'
        })
      }
      if (data.propertiesList.indexOf(id) !== -1) {
        throw new EntityError({
          type: 'InvalidArgument',
          message:
            'Instance method ' +
            id +
            ' cannot be used, there is already a column with this name'
        })
      }
      data.instanceMethods.push({id: id, fn: fn})
    }

    data.entityMethods = []
    data.methods.entityMethod = function(id, fn) {
      assert(id, 'Method should have an identification')
      assert(fn, 'Method missing')
      if (_.find(data.entityMethods, ['id', id])) {
        throw new EntityError({
          type: 'InvalidArgument',
          message: 'Entity method ' + id + ' is already defined'
        })
      }
      if (data.propertiesList.indexOf(id) !== -1) {
        throw new EntityError({
          type: 'InvalidArgument',
          message:
            'Entity method ' +
            id +
            ' cannot be used, there is already a column with this name'
        })
      }
      data.entityMethods.push({id: id, fn: fn})
    }

    return data
  }

  rebuild()
  return _.extend(entity.public, entity.methods)

  function rebuild() {
    buildTable(entity)
  }
}

function getForeignKey(table, properties) {
  var foreignKey
  _.forEach(properties, function(property, name) {
    var $ref = property.$ref || (property.schema && property.schema.$ref)
    if ($ref) {
      var referencedTableName = getReferencedTableName($ref)
      if (referencedTableName === table) {
        foreignKey = name
        return false
      }
    }
  })
  return foreignKey
}

function getTables(data, tables) {
  tables.push({
    name: data.identity.name,
    schema: data.table
  })
  data.associations.map(function(association) {
    getTables(association.data, tables)
  })
}

function getReferencedTableName($ref) {
  const re = /^\#\/definitions\/(.*)/
  var match = re.exec($ref)
  if (match) {
    return match[1]
  }
  return $ref
}

function getAdapter(dialect) {
  if (dialect === 'mssql') {
    return require('./adapters/mssql')()
  } else if (dialect === 'postgres') {
    return require('./adapters/postgres')()
  } else {
    throw new Error('Adapter for this conector is not implemented')
  }
}

function splitAlias(name) {
  var res = {}
  var re = /^(.+) as (.+)$/i
  var match = re.exec(name)
  if (match) {
    res.name = match[1]
    res.as = match[2]
  } else {
    res.name = name
  }
  return res
}

function buildTable(data) {
  data.schema = {
    type: 'object',
    properties: {}
  }
  if (data.title) {
    data.schema.title = data.title
  }
  if (data.description) {
    data.schema.description = data.description
  }
  data.properties = {}
  _.forEach(data.requestedProperties, function(property, name) {
    data.properties[name] = data.requestedProperties[name]
    if (
      data.properties[name].format !== 'hidden' &&
      !(
        (data.properties[name].autoIncrement || data.foreignKey === name) &&
        data.isAssociation
      )
    ) {
      data.schema.properties[name] = data.properties[name]
    }
  })
  if (data.foreignKey && !data.properties[data.foreignKey]) {
    data.properties[data.foreignKey] = {
      type: 'integer'
    }
  }

  data.primaryKeyAttributes = []
  data.primaryKeyFields = []
  if (data.primaryKey) {
    _.forEach(data.primaryKey, function(key) {
      var property = findProperty(key, data.properties)
      var name
      _.forEach(data.properties, function(prop, key) {
        if (property === prop) {
          name = key
          return false
        }
      })
      data.primaryKeyAttributes.push(name)
      data.primaryKeyFields.push(property.field || name)
    })
  } else {
    _.forEach(data.properties, function(property, name) {
      if (property.primaryKey === true) {
        data.primaryKeyAttributes.push(name)
        data.primaryKeyFields.push(property.field || name)
      }
    })
  }
  assert(
      data.primaryKeyAttributes.length > 0,
      'Primary key not defined for table ' + data.key
  )

  data.adapter.buildInsertCommand(data)
  data.adapter.buildUpdateCommand(data)
  data.adapter.buildDeleteCommand(data)

  _.forEach(data.associations, function(association) {
    association.data.foreignKey =
      association.data.foreignKey ||
      getForeignKey(data.identity.name, association.data.requestedProperties)
    buildTable(association.data)
  })

  // Cache
  data.propertiesList = Object.keys(data.properties)
  data.coerce = []
  _.forEach(data.properties, function(property, name) {
    data.coerce.push({
      property: name,
      fn: data.adapter.getCoercionFunction(property.type, property.timezone)
    })
  })
  if (data.timestamps) {
    if (data.propertiesList.indexOf('updatedAt') !== -1) {
      throw new EntityError({
        message:
          'Properties cannot have timestamp name updatedAt, use an alias',
        type: 'InvalidIdentifier'
      })
    }
    data.propertiesList.push('updatedAt')
    data.coerce.push({
      property: 'updatedAt',
      fn: data.adapter.getCoercionFunction('datetime')
    })
    if (data.propertiesList.indexOf('createdAt') === -1) {
      data.propertiesList.push('createdAt')
      data.coerce.push({
        property: 'createdAt',
        fn: data.adapter.getCoercionFunction('datetime')
      })
    }
  }

  data.propertiesList.forEach(function(name) {
    if (data.reservedInstanceMethodsNames.indexOf(name) !== -1) {
      throw new EntityError({
        message: `Property ${name} cannot have this name, it is a reserved word, use an alias`,
        type: 'InvalidIdentifier'
      })
    }
  })

  data.trs = new TableRecordSchema(data)
}

// from json-schema-table
function findProperty(name, properties) {
  var property = properties[name]
  if (property === void 0) {
    property =
      _.reduce(
          properties,
          function(res, prop, propName) {
            return res ? res : name === propName ? prop : void 0
          },
          void 0
      ) ||
      _.reduce(
          properties,
          function(res, prop) {
            return res ? res : prop.field && name === prop.field ? prop : void 0
          },
          void 0
      )
  }
  assert(property, 'Property "' + name + '" not found')
  return property
}
