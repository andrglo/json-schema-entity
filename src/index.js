'use strict';

var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
var debug = require('debug')('json-schema-entity');

var utils = require('./utils');

var log = console.log;

const pk = '__jse__'; // package key
const xmlSpaceToken = '_-_';
const xmlSpaceTokenRegExp = new RegExp(xmlSpaceToken, 'g');

function EntityError(options) {
  options = options || {};
  this.name = options.name || 'EntityError';
  this.message = options.message || 'Entity error';
  options.errors &&
  (this.errors = options.errors);
  options.type &&
  (this.type = options.type);
}
EntityError.prototype = Object.create(Error.prototype);
EntityError.prototype.constructor = EntityError;

function runValidations(is, was, data) {

  let errors = [];

  function validate(is, was, data) {
    return runFieldValidations(is, was, data, errors).then(function() {
      return runModelValidations(is, was, data, errors).then(function() {
        return _.reduce(data.associations, function(chain, association) {
          return chain.then(function() {
            let associationKey = association.data.key;
            debug('Associated validation:', associationKey);
            let from = is && is[associationKey];
            let to = was && was[associationKey];
            if (_.isArray(from) || _.isArray(to)) {
              from = _.isArray(from) ? from.slice(0) : from ? [form] : [];
              to = _.isArray(to) ? to.slice(0) : to ? [to] : [];
              let pairs = [];

              var hasEqualPrimaryKey = function(a, b) {
                let same;
                _.forEach(association.data.primaryKeyAttributes, function(name) {
                  return same = a[name] === b[name]
                });
                return same;
              }

              var findAndRemove = function(arr, obj) {       //todo refactor and more validation tests
                let res = _.remove(arr, function(e) { //todo save and new in instance
                  if (hasEqualPrimaryKey(e, obj)) {
                    return true
                  }
                });
                assert(res.length < 2, 'Better call Gloria' + res.length);
                return res.length === 0 ? void 0 : res[0];
              }

              from.map(function(record) {
                pairs.push({
                  to: record,
                  from: findAndRemove(to, record)
                })
              });
              to.map(function(record) {
                pairs.push({
                  to: record
                })
              });

              return _.reduce(pairs, function(chain, pair) {
                return validate(pair.from, pair.to, association.data);
              }, Promise.resolve())
            } else {
              return validate(from, to, association.data);
            }
          })
        }, Promise.resolve())
      })
    })
  }

  return validate(is, was, data).then(function() {
    if (errors.length > 0) {
      throw new EntityError({
        message: 'Validation error',
        type: 'ValidationError',
        errors: errors
      });
    }
  })
}

function runFieldValidations(is, was, data, errors) {
  let validator = data.validator;
  return _.reduce(is && validator && data.properties, function(chain, property, key) {

    let validations = {};
    if (is[key]) {
      _.forEach(property.validations, function(validation, name) {
        let args = _.map(validation.args, function(arg) {
          if (typeof arg === 'string' && arg.startsWith('this.')) {
            return is[arg.substring(5)]
          } else {
            return arg;
          }
        });
        validations[name] = {
          id: key,
          message: validation.message,
          fn: validator[name],
          args: [is[key]].concat(args)
        }
      });
      if (property.format && !validations[property.format] && validator[property.format]) {
        validations[property.format] = {
          id: key,
          fn: validator[property.format],
          args: [is[key]]
        }
      }
    }
    return _.reduce(validations, function(chain, validation) {
      return chain.then(function() {
        debug('Running field validation:', validation.id, validation.args);
        let res;
        try {
          res = validation.fn.apply(validator, validation.args)
        } catch (err) {
          errors.push({path: validation.id, message: err.message})
        }             //todo change to field
        if (res && res.then) {
          return res.catch(function(err) {
            errors.push({path: validation.id, message: err.message})
          })
        } else {
          if (res === false) {
            errors.push({
              path: validation.id, message: validation.message ||
              'Invalid ' + validation.id
            })
          }
        }
      })
    }, chain)

  }, Promise.resolve())
}

function runModelValidations(is, was, data, errors) {
  return _.reduce(data.validate, function(chain, validation) {
    return chain.then(function() {
      if (!((is && !was && validation.options.onCreate) ||
        (is && was && validation.options.onUpdate) ||
        (!is && was && validation.options.onDestroy))) {
        return;
      }
      debug('Running validation:', validation.id);
      let res;
      try {
        res = validation.fn.call(is || was, is ? was : void 0)
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
  }, Promise.resolve());
}

function Base(entity) {
  _.extend(this, entity)
}

function newInstace(entity, data) {

  let oldValues = _.cloneDeep(entity);

  function Instance(values) {
    _.extend(this, values)
  }

  Instance.prototype.validate = function() {
    return runValidations(this, oldValues, data)
  };

  data.instanceMethods.map(function(method) {
    Instance.prototype[method.id] = method.fn;
  });
  return new Instance(entity);
}

function buildEntity(record, data) {
  debug('Entity will be built:', data.key);
  let entity = data.adapter.createInstance(_.pick(record, data.propertiesList), data.identity.name, data);
  _.forEach(data.associations, function(association) {
    let key = association.data.key;
    debug('Checking association key:', key);
    if (record[key]) {
      let recordset = extractRecordset(record[key], association.data.coerce)
        .map(function(record) {
          return buildEntity(record, association.data)
        });
      entity[key] = recordset.length === 1 && association.type === 'hasOne' ?
        recordset[0] : recordset;
    }
  });
  return newInstace(entity, data);
}

function extractRecordset(xmlField, coerce) {
  let json = xml2json.toJson('<recordset>' + xmlField + '</recordset>', {
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
      record[coercion.property] &&
      (record[coercion.property] = coercion.fn(record[coercion.property]));
      debug('Coercion after', coercion.property, typeof record[coercion.property], record[coercion.property]);
    })
  });

  return isArray ? json : [json];
}

function runHooks(hooks, model, transaction, data) {

  let allHooks = [];
  hooks.map(function(name) {
    allHooks = allHooks.concat(data.hooks[name])
  });

  return _.reduce(allHooks, function(chain, hook) {
    return chain.then(function() {
      debug('Running hook:', hook.id);
      let res;
      try {
        res = hook.fn.call(model, transaction)
      } catch (err) {
        throw new EntityError({
          type: hook.name + 'HookError',
          message: err.message, errors: [
            {path: hook.id, message: err.message}
          ]
        });
      }
      if (res && res.then) {
        return res.catch(function(err) {
          throw new EntityError({
            message: hook.name + ' hook error', errors: [
              {path: hook.id, message: err.message}
            ]
          });
        });
      }
    });
  }, Promise.resolve());
}

function create(entity, options, data) {
  let record = _.pick(entity, data.propertiesList);
  debug('Creating ', data.key);
  return runHooks(['beforeCreate', 'beforeSave'], entity, options.transaction, data)
    .then(function() {
      return data.adapter.create(record, data, {transaction: options.transaction})
        .then(function(instance) {
          let newEntity = _.pick(instance, data.propertiesList);
          return _.reduce(data.associations, function(chain, association) {
            const associationKey = association.data.key;
            let associatedEntity = entity[associationKey];
            const recordIsArray = _.isArray(associatedEntity);
            let hasMany = (recordIsArray && associatedEntity.length > 1) ||
              association.type === 'hasMany';
            if (association.type === 'hasOne' && hasMany) {
              throw new EntityError({
                type: 'InvalidData',
                message: 'Association ' + associationKey + ' can not be an array'
              })
            }
            associatedEntity = associatedEntity === void 0 || recordIsArray ? associatedEntity : [associatedEntity];
            return _.reduce(associatedEntity, function(chain, entity) {
              debug('ForeignKey in create', association.data.foreignKey, 'key', data.primaryKeyAttributes[0]);
              entity[association.data.foreignKey] = newEntity[data.primaryKeyAttributes[0]];
              debug(entity ? entity : data.key + ' association ' + associationKey + ' non existent');
              return chain.then(function() {
                return create(entity, {transaction: options.transaction}, association.data)
                  .then(function(associationEntity) {
                    debug('created ', data.key, 'association', associationKey);
                    if (hasMany) {
                      newEntity[associationKey] = newEntity[associationKey] || [];
                      newEntity[associationKey].push(associationEntity);
                    } else {
                      newEntity[associationKey] = associationEntity;
                    }
                  })
              })
            }, chain);
          }, Promise.resolve()).then(function() {
            return newEntity;
          })
        })
    }).then(function(entity) {
      return runHooks(['afterCreate', 'afterSave'], entity, options.transaction, data)
        .then(function() {
          return newInstace(entity, data)
        })
    });
}

function update(entity, was, options, data) {
  let record = _.pick(entity, data.propertiesList);
  debug('Updating ', data.key);
  return runHooks(['beforeUpdate', 'beforeSave'], entity, options.transaction, data)
    .then(function() {
      options = {where: {}, transaction: options.transaction};
      data.primaryKeyAttributes.map(function(field) {
        options.where[field] = entity[field] || null;
      });
      if (data.timestamps) {
        options.where.updatedAt = entity.updatedAt || null;
      }
      debug('Will update', data.key, 'key', options.where);
      return data.adapter.update(record, data, options)
        .then(function(res) {
          assert(res[0] === 1 || (typeof res === 'object' && res[0] === void 0),
            'Record of ' + data.key + ' found ' + res[0] + ' times for update, expected 1.' +
            ' Check if your entity has two association with the same foreign key');
          let modifiedEntity = record;
          return _.reduce(data.associations, function(chain, association) {
            const associationKey = association.data.key;
            const associationPrimaryKey = association.data.primaryKeyAttributes;

            function exists(a) {
              return a[association.data.foreignKey] !== void 0
            }

            var hasEqualPrimaryKey = function(a, b) {
              let same;
              _.forEach(associationPrimaryKey, function(name) {
                return same = a[name] === b[name]
              });
              return same;
            };

            var find = function(entity, entities) {
              if (!_.isArray(entities)) {
                return entities;
              }
              for (var i = 0; i < entities.length; i++) {
                var obj = entities[i];
                if (hasEqualPrimaryKey(entity, obj)) {
                  return obj
                }
              }
              assert(false, 'Better call Gloria')
            };

            let associatedIsEntity = entity[associationKey];
            let hasMany = (_.isArray(associatedIsEntity) && associatedIsEntity.length > 1) ||
              association.type === 'hasMany';
            if (association.type === 'hasOne' && hasMany) {
              throw new EntityError({
                type: 'InvalidData',
                message: 'Association ' + associationKey + ' can not be an array'
              })
            }
            associatedIsEntity = _.isArray(associatedIsEntity) ?
              associatedIsEntity.slice(0) : associatedIsEntity ? [associatedIsEntity] : void 0;

            let associatedWasEntity = was[associationKey];
            associatedWasEntity = _.isArray(associatedWasEntity) ?
              associatedWasEntity.slice(0) : associatedWasEntity ? [associatedWasEntity] : void 0;

            let toBeCreated = _.remove(associatedIsEntity, function(is) {
              return !exists(is)
            });
            let toBeUpdated = associatedIsEntity;
            let toBeDeleted = _.remove(associatedWasEntity, function(was) {
              let hasIs = false;
              _.forEach(toBeUpdated, function(is) {
                if (hasEqualPrimaryKey(was, is)) {
                  hasIs = true;
                  return false;
                }
              });
              return !hasIs
            });

            return _.reduce(toBeDeleted, function(chain, entity) {
              debug('ForeignKey in update/delete', association.data.foreignKey, 'key', data.primaryKeyAttributes[0]);
              return chain.then(function() {
                return destroy(entity, options, association.data)
              })
            }, chain).then(function() {
              return _.reduce(toBeUpdated, function(chain, entity) {
                debug('ForeignKey in update/update', association.data.foreignKey, 'key', data.primaryKeyAttributes[0]);
                return chain.then(function() {
                  return update(entity, find(entity, was[association.data.key]), options, association.data)
                    .then(function(associationEntity) {
                      debug('updated ', data.key, 'association', associationKey);
                      if (hasMany) {
                        modifiedEntity[associationKey] = modifiedEntity[associationKey] || [];
                        modifiedEntity[associationKey].push(associationEntity);
                      } else {
                        modifiedEntity[associationKey] = associationEntity;
                      }
                    })
                })
              }, chain)
            }).then(function() {
              return _.reduce(toBeCreated, function(chain, entity) {
                debug('ForeignKey in update/create', association.data.foreignKey, 'key', data.primaryKeyAttributes[0]);
                entity[association.data.foreignKey] = modifiedEntity[data.primaryKeyAttributes[0]];
                debug(entity ? entity : data.key + ' association ' + associationKey + ' non existent');
                return chain.then(function() {
                  return create(entity, options, association.data)
                    .then(function(associationEntity) {
                      debug('created ', data.key, 'association', associationKey);
                      if (hasMany) {
                        modifiedEntity[associationKey] = modifiedEntity[associationKey] || [];
                        modifiedEntity[associationKey].push(associationEntity);
                      } else {
                        modifiedEntity[associationKey] = associationEntity;
                      }
                    })
                })
              }, chain)
            })
          }, Promise.resolve()).then(function() {
            return modifiedEntity;
          })
        })
    }).then(function(entity) {
      return runHooks(['afterUpdate', 'afterSave'], entity, options.transaction, data)
        .then(function() {
          return newInstace(entity, data)
        })
    })
}

function destroy(entity, options, data) {
  debug('Deleting ', data.key);
  return runHooks(['beforeDelete', 'beforeDestroy'], entity, options.transaction, data)
    .then(function() {
      return _.reduce(data.associations, function(chain, association) {
        const associationKey = association.data.key;
        let associatedEntity = entity[associationKey];
        const recordIsArray = _.isArray(associatedEntity);
        associatedEntity = associatedEntity === void 0 || recordIsArray ? associatedEntity : [associatedEntity];
        return _.reduce(associatedEntity, function(chain, entity) {
          return chain.then(function() {
            return destroy(entity, {transaction: options.transaction}, association.data)
          })
        }, chain);
      }, Promise.resolve()).then(function() {
        options = {where: {}, transaction: options.transaction};
        data.primaryKeyAttributes.map(function(field) {
          options.where[field] = entity[field] || null;
        });
        if (data.timestamps) {
          options.where.updatedAt = entity.updatedAt || null;
        }
        return data.adapter.destroy(data, options)
      })
    }).then(function(entity) {
      return runHooks(['afterDestroy', 'afterDelete'], entity, options.transaction, data)
    })
}

module.exports = function(schemaName, schema, config) {

  let adapter = buildAdapter(config.db);
  let entity = entityFactory(schemaName, schema, rebuild);

  function entityFactory(schemaName, schema, rebuild) {
    const publicAssociationMethods = [
      'setTitle',
      'setDescription',
      'setProperties',
      'hasMany',
      'hasOne',
      'validate',
      'method',
      'foreignKey'
    ];
    const identity = splitAlias(schemaName);
    let data = {
      validator: config.validator,
      identity: identity,
      adapter: adapter,
      title: schema && schema.title,
      description: schema && schema.description,
      key: identity.as || identity.name,
      associations: [],
      requestedProperties: schema && schema.properties,
      propertiesList: [],
      schema: {},
      hooks: {},
      coerce: [],
      public: {},
      methods: {
        setTitle: function(title) {
          data.title = title;
          rebuild();
          return data.public;
        },
        setDescription: function(description) {
          data.description = description;
          rebuild();
          return data.public;
        },
        setProperties: function(cb) {
          cb(data.requestedProperties);
          rebuild();
          return data.public;
        },
        setScope: function(scope) {
          data.scope = scope;
          rebuild();
          return data.public;
        },
        useTimestamps: function() {
          data.timestamps = true;
          rebuild();
          return data.public;
        },
        hasMany: function(schemaName, schema) {
          let association = entityFactory(schemaName, schema, rebuild);
          association.isAssociation = true;
          data.methods[association.key] = association.methods;
          data.public[association.key] = association.public;
          publicAssociationMethods.map(function(name) {
            data.public[association.key][name] = association.methods[name]
          });
          data.associations.push({type: 'hasMany', data: association});
          rebuild();
          return data.public[association.key];
        },
        hasOne: function(schemaName, schema) {
          let association = entityFactory(schemaName, schema, rebuild);
          association.isAssociation = true;
          data.methods[association.key] = association.methods;
          data.public[association.key] = association.public;
          publicAssociationMethods.map(function(name) {
            data.public[association.key][name] = association.methods[name].bind(association.methods)
          });
          data.associations.push({type: 'hasOne', data: association});
          rebuild();
          return data.public[association.key];
        },
        foreignKey(name) {
          data.foreignKey = name;
          rebuild();
          return data.public;
        },
        getSchema: function() {

          function buildSchema(data) {
            let schema = data.schema;
            _.forEach(data.associations, function(association) {
              let key = association.data.key;
              if (association.type === 'hasOne') {
                schema.properties[key] = buildSchema(association.data);
              } else {
                schema.properties[key] = {
                  type: 'array',
                  items: buildSchema(association.data)
                }
              }
            });
            return data.schema
          }

          return buildSchema(data)

        },
        findAll: function(criteria, options) {
          options = options || {};
          if (data.scope) {
            let where = _.extend({}, criteria.where, data.scope);
            criteria = _.extend({}, criteria);
            criteria.where = where;
          }
          return adapter
            .query(data.query, criteria, options)
            .then(function(res) {
              return res.map(function(record) {
                return buildEntity(record, data)
              })
            })
        },
        create: function(entity, options) {
          options = options || {};
          return runValidations(entity, void 0, data)
            .then(function() {
              return options.transaction ?
                create(entity, options, data) :
                adapter.transaction(function(t) {
                  options.transaction = t;
                  return create(entity, options, data);
                });
            });
        },
        update: function(entity, key, options) {
          key = key || entity[data.primaryKeyAttributes[0]];
          if (!key) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Entity ' + data.key + ' need a primary key for update'
              })
            })
          }
          options = options || {};
          if (typeof key !== 'object') {
            let id = key;
            key = {where: {}};
            key.where[data.primaryKeyAttributes[0]] = id;
          } else if (!key.where) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Where clause not defined for entity ' + data.key + ' update'
              })
            })
          }
          if (data.timestamps) {
            key.where.updatedAt = entity.updatedAt || key.where.updatedAt || null;
          }
          return data.methods.findAll(key, options)
            .then(function(was) {
              if (was.length === 0) {
                throw new EntityError({
                  type: 'RecordModifiedOrDeleted',
                  message: 'Entity {' + data.key + '} key ' + JSON.stringify(key.where) + ' not found for update'
                })
              }
              assert(was.length === 1);
              entity = _.extend({}, was[0], entity);
              return runValidations(entity, was[0], data)
                .then(function() {
                  return options.transaction ?
                    update(entity, was[0], options, data) :
                    adapter.transaction(function(t) {
                      options.transaction = t;
                      return update(entity, was[0], options, data);
                    });
                })
            })
        },
        destroy: function(key, options) {
          if (!key) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Entity ' + data.key + ' need a primary key for delete'
              })
            })
          }
          options = options || {};
          if (typeof key !== 'object') {
            let id = key;
            key = {where: {}};
            key.where[data.primaryKeyAttributes[0]] = id;
          } else if (!key.where) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Where clause not defined for entity ' + data.key + ' delete'
              })
            })
          }
          if (data.timestamps) {
            key.where.updatedAt = key.where.updatedAt || null;
          }
          return data.methods.findAll(key, options)
            .then(function(was) {
              if (was.length === 0) {
                throw new EntityError({
                  type: 'RecordModifiedOrDeleted',
                  message: 'Entity {' + data.key + '} key ' + JSON.stringify(key.where) + ' not found for delete'
                })
              }
              assert(was.length === 1);
              return runValidations(void 0, was[0], data)
                .then(function() {
                  return options.transaction ?
                    destroy(was[0], options, data) :
                    adapter.transaction(function(t) {
                      options.transaction = t;
                      return destroy(was[0], options, data);
                    });
                })
            })
        }
      }
    };

    let methodId = 0;

    function addHook(name, id, fn) {
      fn = fn || id;
      id = typeof id === 'string' ? id : (methodId++).toString();
      data.hooks[name].push({id: id, fn: fn, name: name})
    }

    [
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
        data.hooks[name] = [];
        data.methods[name] = function(id, fn) {
          addHook(name, id, fn)
        }
      });

    data.validate = [];
    data.methods.validate = function(id, fn, options) {
      options = options || {};
      let normalizedOptions = {
        onCreate: true,
        onUpdate: true,
        onDestroy: false
      };
      if (options.onDelete === true || options.onDestroy === true) {
        normalizedOptions.onDestroy = true;
      }
      if (options.onSave === false || options.onCreate === false) {
        normalizedOptions.onCreate = false;
      }
      if (options.onSave === false || options.onUpdate === false) {
        normalizedOptions.onUpdate = false;
      }
      fn = fn || id;
      id = typeof id === 'string' ? id : (methodId++).toString();
      data.validate.push({id: id, fn: fn, options: normalizedOptions})
    };

    data.instanceMethods = [];
    data.methods.method = function(id, fn) {
      assert(id, 'Methods should have an identification');
      assert(fn, 'Method missing');
      data.instanceMethods.push({id: id, fn: fn})
    };

    return data;
  }

  rebuild();
  return _.extend(entity.public, entity.methods);

  function rebuild() {
    buildTable(entity);
    buildQuery(entity);
  }

};

function getForeignKey(table, properties) {
  let foreignKey;
  _.forEach(properties, function(property, name) {
    var $ref = property.$ref || (property.schema && property.schema.$ref);
    if ($ref) {
      var referencedTableName = getReferencedTableName($ref);
      if (referencedTableName === table) {
        foreignKey = name;
        return false;
      }
    }
  });
  return foreignKey;
}

function getReferencedTableName($ref) {
  const re = /^\#\/definitions\/(.*)/;
  var match = re.exec($ref);
  if (match) {
    return match[1];
  }
  return $ref;
}

function buildAdapter(db) {
  let adapter = {};
  if (isNodeMssql(db)) {
    adapter.query = function(command, criteria, options) {
      var sentence = utils.embedCriteria(command, criteria);
      let request = new db.Request(options.transaction);
      return request.query(sentence);
    };
    adapter.createInstance = function(record, name, data) {
      _.forEach(data.properties, function(property, name) {
        if (property.enum) {
          _.forEach(property.enum, function(value) {
            if (value.startsWith(record[name])) {
              record[name] = value;
              return false;
            }
          })
        }
        if ((property.type === 'date' || property.type === 'datetime') &&
          record[name]) {
          record[name] = new Date(record[name])
        }
      });
      return record;
    };
    adapter.getAttributes = function(name) {
    };
    adapter.transaction = function(fn) {
      var transaction = new db.Transaction();
      var rolledBack = false;
      transaction.on('rollback', function() {
        rolledBack = true;
      });
      return transaction.begin()
        .then(function() {
          return fn(transaction);
        })
        .then(function(res) {
          return transaction.commit()
            .then(function() {
              return res;
            });
        })
        .catch(function(err) {
          if (!rolledBack) {
            return transaction.rollback()
              .then(function() {
                throw err;
              });
          }
          throw err;
        });
    };
    adapter.toSqlType = function(property) {
      switch (property.type) {
        case 'integer':
          return 'INTEGER';
        case 'number':
          return 'DECIMAL(' + property.maxLength + ',' + property.decimals + ')';
        case 'date':
        case 'datetime':
          return 'DATETIME';
        case 'string':
          return 'NVARCHAR(' + property.maxLength + ')';
        default:
          throw new Error('Coercion not defined for type ' + property.type)
      }
    };
    adapter.toAdapterType = function(property) {
      switch (property.type) {
        case 'integer':
          return db.Int;
        case 'number':
          return db.Decimal(property.maxLength, property.decimals);
        case 'date':
        case 'datetime':
          return db.DateTime;
        case 'string':
          return db.NVarChar(property.maxLength);
        default:
          throw new Error('Adapter type not defined for type ' + property.type)
      }
    };
    adapter.buildInsertCommand = function(data) {

      //declare @tmp table ([NUMCAD] INTEGER,[NOMECAD] NVARCHAR(60),[IDENT] NVARCHAR(30),
      // [CGCCPF] NVARCHAR(14),[INSCEST] NVARCHAR(18),[InscriçãoMunicipal] NVARCHAR(20),
      // [DATNASC] DATETIME2,[ENDERECO] NVARCHAR(45),[NUMERO] NVARCHAR(6),[COMPLEMENTO] NVARCHAR(22),
      // [BAIRRO] NVARCHAR(30),[CEP] NVARCHAR(8),[CIDADE] NVARCHAR(30),[ESTADO] NVARCHAR(2),
      // [PAIS] NVARCHAR(50),[TELEFONE] NVARCHAR(20),[FAX] NVARCHAR(20),
      // [CELULAR] NVARCHAR(20),[EMAIL] NVARCHAR(100),[CONTAEV] NVARCHAR(20),
      // [CONTACC] NVARCHAR(20),[Suframa] NVARCHAR(9),[TipoSimplesNacional] VARCHAR(255),
      // [Inativo] VARCHAR(255),[NUMLANORI] INTEGER,[NUMLANORI2] INTEGER,
      // [FKOUTRO] INTEGER,[createdAt] DATETIME2,[updatedAt] DATETIME2);

      // INSERT INTO [CADASTRO] ([NOMECAD],[NUMERO],[TipoSimplesNacional],
      // [Inativo],[updatedAt],[createdAt])
      // OUTPUT
      // INSERTED.[NUMCAD],INSERTED.[NOMECAD],
      // INSERTED.[IDENT],INSERTED.[CGCCPF],
      // INSERTED.[INSCEST],INSERTED.[InscriçãoMunicipal],
      // INSERTED.[DATNASC],INSERTED.[ENDERECO],INSERTED.[NUMERO],
      // INSERTED.[COMPLEMENTO],
      // INSERTED.[BAIRRO],INSERTED.[CEP],INSERTED.[CIDADE],INSERTED.[ESTADO],
      // INSERTED.[PAIS],INSERTED.[TELEFONE],INSERTED.[FAX],INSERTED.[CELULAR],
      // INSERTED.[EMAIL],INSERTED.[CONTAEV],INSERTED.[CONTACC],INSERTED.[Suframa],
      // INSERTED.[TipoSimplesNacional],INSERTED.[Inativo],INSERTED.[NUMLANORI],
      // INSERTED.[NUMLANORI2],INSERTED.[FKOUTRO],INSERTED.[createdAt],INSERTED.[updatedAt]
      // into @tmp VALUES ('João','1','1','N','2015-08-10 20:44:55.751 +00:00',

      // '2015-08-10 20:44:55.751 +00:00');select * from @tmp

      let fieldsWithType = [];
      let fields = [];
      //let fieldsToInsert = [];
      _.forEach(data.properties, function(property, name) {
        if (property.autoIncrement) {
          fieldsWithType.push('[' + (property.field || name) + ']' + ' ' +
            adapter.toSqlType(property));
          fields.push(property.field || name);
          //fieldsToInsert.push(property.field || name);
        }
      });
      if (data.timestamps) {
        fieldsWithType.push('createdAt DATETIME2');
        fields.push('createdAt');
        //fieldsToInsert.push('createdAt');
        fieldsWithType.push('updatedAt DATETIME2');
        fields.push('updatedAt');
        //fieldsToInsert.push('updatedAt');
      }
      if (fieldsWithType.length === 0) {
        data.insertCommand = 'INSERT INTO [' + data.identity.name + '] (<fields>) VALUES (<values>)';
      } else {
        let commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
        commands.push('INSERT INTO [' + data.identity.name + '] (<fields>) OUTPUT ' +
          fields.map(function(field) {
            return 'INSERTED.[' + field + ']'
          }).join(',') +
          ' INTO @tmp VALUES (<values>)');
        commands.push('SELECT * FROM @tmp');
        data.insertCommand = commands.join(';');
      }
      //console.log('insert command', data.insertCommand);

    };
    adapter.buildUpdateCommand = function(data) {

      if (data.timestamps) {
        data.updateCommand = 'declare @tmp table (updatedAt DATETIME2);' +
          '' +
          'UPDATE [' + data.identity.name + '] SET <fields-values> ' +
          'OUTPUT INSERTED.updatedAt into @tmp WHERE <primary-keys>;SELECT * from @tmp';
      } else {
        data.updateCommand = 'UPDATE [' + data.identity.name +
          '] SET <fields-values> WHERE <primary-keys>';

      }
      //UPDATE [ClassificaçãoCad] SET [Classe]='Fornecedor',[NUMCAD]=19
      // OUTPUT INSERTED.* WHERE [Classe] = 'Fornecedor' AND [NUMCAD] = 19

    };
    adapter.buildDeleteCommand = function(data) {
      data.deleteCommand = 'DELETE FROM [' + data.identity.name +
        '] WHERE <find-keys>;SELECT @@ROWCOUNT AS rowsAffected';
      //DELETE FROM [CADASTRO]
      // WHERE [updatedAt] = '2015-08-10 20:44:55.792 +00:00' AND
      // [NUMCAD] = 1; SELECT @@ROWCOUNT AS AFFECTEDROWS;
    };
    adapter.create = function(record, data, options) {
      options = options || {};
      let fields = [];
      let fieldsToRead = [];
      let defaultValues = {};
      let save = {};
      let ps = new db.PreparedStatement(options.transaction);
      _.forEach(data.properties, function(property, name) {
        if (property.autoIncrement) {
          fieldsToRead.push({from: property.field || name, to: name})
        } else {
          let value = record[name];
          if (!value && property.defaultValue) {
            value = property.defaultValue;
            defaultValues[name] = value;
          }
          if (value && property.enum) {
            value = value.substr(0, property.maxLength);
          }
          if (value) {
            let field = property.field || name;
            fields.push(field);
            const key = _.camelCase(field);
            ps.input(key, adapter.toAdapterType(property));
            if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
              record[name] = save[key] = new Date(value);
            } else {
              save[key] = value;
            }
          }
        }
      });
      if (data.timestamps) {
        let now = new Date();
        ps.input('createdAt', db.DateTime2(3));
        ps.input('updatedAt', db.VarChar(26));
        save.createdAt = now.toISOString();
        save.updatedAt = now.toISOString().substring(0, 23) + '000';
        fields.push('createdAt');
        fields.push('updatedAt');
        fieldsToRead.push({from: 'createdAt', to: 'createdAt'});
        fieldsToRead.push({from: 'updatedAt', to: 'updatedAt'})
      }
      let insertCommand = data.insertCommand.replace('<fields>',
        fields.reduce(function(fields, field) {
          return fields + (fields ? ',' : '') + '[' + field + ']';
        }, '')).replace('<values>',
        fields.reduce(function(fields, field) {
          return fields + (fields ? ',' : '') + '@' + _.camelCase(field);
        }, ''));
      debug(insertCommand, save);
      return ps.prepare(insertCommand)
        .then(function() {
          return ps.execute(save);
        })
        .then(function(recordset) {
          return ps.unprepare().then(function() {
            fieldsToRead.map(function(data) {
              record[data.to] = recordset[0][data.from]
            });
            _.forEach(defaultValues, function(value, key) {
              record[key] = value;
            });
            return record;
          });
        })
        .catch(function(error) {
          return ps.unprepare().then(function() {
            throw error;
          });
        });
    };
    adapter.update = function(record, data, options) {
      assert(options.where);
      let fields = [];
      let save = {};
      let ps = new db.PreparedStatement(options.transaction);
      _.forEach(data.properties, function(property, name) {
        if (!property.autoIncrement) {
          let value = record[name];
          if (value && property.enum) {
            value = value.substr(0, property.maxLength);
          }
          if (value !== void 0) {
            let field = property.field || name;
            fields.push(field);
            const key = _.camelCase(field);
            ps.input(key, adapter.toAdapterType(property));
            if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
              record[name] = save[key] = new Date(value);
            } else {
              save[key] = value;
            }
          }
        }
      });

      let findKeys = data.primaryKeyFields.map(function(name, index) {
        const attribute = data.primaryKeyAttributes[index];
        let key = _.camelCase('pk' + name);
        ps.input(key, adapter.toAdapterType(data.properties[attribute]));
        save[key] = options.where[attribute];
        return name;
      });
      if (data.timestamps) {
        let now = new Date();
        ps.input('updatedAt', db.VarChar(26));
        save.updatedAt = now.toISOString().substring(0, 23) + '000';
        fields.push('updatedAt');

        ps.input('pkupdatedAt', db.VarChar(26));
        save.pkupdatedAt = _.isDate(options.where.updatedAt) ?
          options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
        findKeys.push('updatedAt')
      }

      //UPDATE [ClassificaçãoCad] SET [Classe]='Fornecedor',[NUMCAD]=19
      // OUTPUT INSERTED.* WHERE [Classe] = 'Fornecedor' AND [NUMCAD] = 19

      //declare @tmp table ([NUMCAD] INTEGER,[NOMECAD] NVARCHAR(60),
      // [IDENT] NVARCHAR(30),[CGCCPF] NVARCHAR(14),[INSCEST] NVARCHAR(18),
      // [InscriçãoMunicipal] NVARCHAR(20),[DATNASC] DATETIME2,[ENDERECO] NVARCHAR(45),
      // [NUMERO] NVARCHAR(6),[COMPLEMENTO] NVARCHAR(22),[BAIRRO] NVARCHAR(30),[CEP] NVARCHAR(8),
      // [CIDADE] NVARCHAR(30),[ESTADO] NVARCHAR(2),[PAIS] NVARCHAR(50),[TELEFONE] NVARCHAR(20),
      // [FAX] NVARCHAR(20),[CELULAR] NVARCHAR(20),[EMAIL] NVARCHAR(100),[CONTAEV] NVARCHAR(20),
      // [CONTACC] NVARCHAR(20),[Suframa] NVARCHAR(9),[TipoSimplesNacional] VARCHAR(255),
      // [Inativo] VARCHAR(255),[NUMLANORI] INTEGER,[NUMLANORI2] INTEGER,[FKOUTRO] INTEGER,
      // [createdAt] DATETIME2,[updatedAt] DATETIME2);
      //
      // UPDATE [CADASTRO] SET [NOMECAD]='Lidia with two vctos one event each',
      // [IDENT]=NULL,[CGCCPF]=NULL,[INSCEST]=NULL,[DATNASC]=NULL,[ENDERECO]=NULL,[NUMERO]='6666',
      // [COMPLEMENTO]=NULL,[BAIRRO]=NULL,[CEP]=NULL,[CIDADE]=NULL,[PAIS]=NULL,[TELEFONE]=NULL,
      // [ESTADO]=NULL,[FAX]=NULL,[CELULAR]=NULL,[EMAIL]=NULL,[CONTAEV]=NULL,[CONTACC]=NULL,
      // [Suframa]=NULL,[Inativo]='N',[updatedAt]='2015-08-11 14:16:10.910 +00:00',
      // [createdAt]='2015-08-11 14:16:10.870 +00:00' OUTPUT
      // INSERTED.[NUMCAD],INSERTED.[NOMECAD],INSERTED.[IDENT],INSERTED.[CGCCPF],
      // INSERTED.[INSCEST],INSERTED.[InscriçãoMunicipal],INSERTED.[DATNASC],
      // INSERTED.[ENDERECO],INSERTED.[NUMERO],INSERTED.[COMPLEMENTO],INSERTED.[BAIRRO],
      // INSERTED.[CEP],INSERTED.[CIDADE],INSERTED.[ESTADO],INSERTED.[PAIS],INSERTED.[TELEFONE],
      // INSERTED.[FAX],INSERTED.[CELULAR],INSERTED.[EMAIL],INSERTED.[CONTAEV],INSERTED.[CONTACC],
      // INSERTED.[Suframa],INSERTED.[TipoSimplesNacional],INSERTED.[Inativo],INSERTED.[NUMLANORI],
      // INSERTED.[NUMLANORI2],INSERTED.[FKOUTRO],INSERTED.[createdAt],INSERTED.[updatedAt]
      // into @tmp WHERE [updatedAt] = '2015-08-11 14:16:10.870 +00:00' AND [NUMCAD] = 19;select * from @tmp

      let updateCommand = data.updateCommand.replace('<fields-values>',
        fields.reduce(function(fields, field) {
          return fields + (fields ? ',' : '') + '[' + field + ']=@' + _.camelCase(field);
        }, '')).replace('<primary-keys>',
        findKeys.reduce(function(fields, field) {
          return fields + (fields ? ' AND ' : '') + '[' + field + ']=@' + _.camelCase('pk' + field);
        }, ''));
      //console.log(updateCommand)
      return ps.prepare(updateCommand)
        .then(function() {
          return ps.execute(save)
        })
        .then(function(recordset) {
          if (data.timestamps) {
            if (!(recordset && recordset[0] && recordset[0].updatedAt)) {
              console.log('Timestamp not saved', recordset, typeof save.pkupdatedAt, save.pkupdatedAt,
                save,
                updateCommand)
            }
            assert(recordset && recordset[0] && recordset[0].updatedAt,
              'Timestamp not saved:', recordset);
            record.updatedAt = recordset[0].updatedAt
          }
          return ps.unprepare().then(function() {
            return record;
          })
        })
        .catch(function(error) {
          return ps.unprepare().then(function() {
            throw  error;
          })
        })
    };
    adapter.destroy = function(data, options) {
      assert(options.where)
      let ps = new db.PreparedStatement(options.transaction);
      let params = {};
      let findKeys = data.primaryKeyFields.map(function(name, index) {
        const attribute = data.primaryKeyAttributes[index];
        let key = _.camelCase('pk' + name);
        ps.input(key, adapter.toAdapterType(data.properties[attribute]));
        params[key] = options.where[attribute]
        return name;
      });
      if (data.timestamps) {
        ps.input('pkupdatedAt', db.VarChar(26));
        params.pkupdatedAt = _.isDate(options.where.updatedAt) ?
          options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
        findKeys.push('updatedAt')
      }

      let deleteCommand = data.deleteCommand.replace('<find-keys>',
        findKeys.reduce(function(fields, field) {
          return fields + (fields ? ' AND ' : '') + '[' + field + ']=@' + _.camelCase('pk' + field);
        }, ''));
      //console.log(deleteCommand, params)
      return ps.prepare(deleteCommand)
        .then(function() {
          return ps.execute(params)
        })
        .then(function(recordset) {
          if (!(recordset && recordset[0] && recordset[0].rowsAffected === 1)) {
            console.log('No or more than 1 record deleted:',
              recordset && recordset[0].rowsAffected, params, deleteCommand)
          }
          assert(recordset && recordset[0] && recordset[0].rowsAffected === 1,
            'No or more than 1 record deleted:', recordset && recordset[0].rowsAffected);
          return ps.unprepare().then(function() {
            return recordset[0];
          })
        })
        .catch(function(error) {
          return ps.unprepare().then(function() {
            throw  error;
          })
        })
    };
  } else {
    throw new Error('Adapter for this database is not implemented')
  }
  return adapter;
}

function isNodeMssql(db) {
  return db.DRIVERS !== void 0; //todo identify in a better way
}

function splitAlias(name) {
  let res = {};
  let re = /^(.+) as (.+)$/i;
  let match = re.exec(name);
  if (match) {
    res.name = match[1];
    res.as = match[2];
  } else {
    res.name = name;
  }
  return res;
}

function getCoercionFunction(type) {
  switch (type) {
    case 'integer':
      return Number.parseInt;
    case 'number':
      return Number.parseFloat;
    case 'date':
    case 'datetime':
      return Date.parse;
    default:
      throw new Error('Coercion not defined for type ' + type)
  }
}

function getPropertyByFieldName(properties, fieldName) {
  let property;
  _.forEach(properties, function(prop) {
    if (prop.field === fieldName) {
      property = prop;
      return false;
    }
  });
  if (property === void 0) {
    _.forEach(properties, function(prop, name) {
      if (name === fieldName) {
        property = prop;
        return false;
      }
    })
  }
  return property;
}

function getAttributeName(attributes, properties, key) {
  let attributeName;
  _.forEach(attributes, function(attribute, name) {
    if (name === key) {
      attributeName = key;
      return false;
    }
  });
  if (attributeName === void 0) {
    _.forEach(properties, function(prop, name) {
      if (name === key) {
        attributeName = prop.field;
        return false;
      }
    });
  }
  return attributeName;
}

function getPropertyName(properties, key) {
  let propertyName;
  _.forEach(properties, function(attribute, name) {
    if (name === key) {
      propertyName = key;
      return false;
    }
  });
  if (propertyName === void 0) {
    _.forEach(properties, function(prop, name) {
      if (name === key) {
        propertyName = prop.field;
        return false;
      }
    });
  }
  return propertyName || key;
}

function buildTable(data) {

  let attributes = data.adapter.getAttributes(data.identity.name);
  data.schema = {
    type: 'object',
    properties: {}
  };
  data.title &&
  (data.schema.title = data.title);
  data.description &&
  (data.schema.description = data.description);
  let hasRequestedProperties = data.requestedProperties !== void 0;
  data.properties = {};
  _.forEach(data.requestedProperties, function(property, name) {
    data.properties[name] = data.requestedProperties[name];
    if (data.properties[name].format !== 'hidden' && !((data.properties[name].autoIncrement || data.foreignKey === name) &&
      data.isAssociation)) {
      data.schema.properties[name] = data.properties[name];
    }
  });
  _.forEach(attributes, function(attribute, name) {
    if (!hasRequestedProperties ||
      ((name === data.foreignKey || attribute.required === true || attribute.primaryKey === true)
      && !getPropertyByFieldName(data.properties, name))) {
      data.properties[name] = attribute;
      if (!hasRequestedProperties) {
        data.schema.properties[name] = data.properties[name];
      }
    }
  });
  if (data.foreignKey && !data.properties[data.foreignKey]) {
    data.properties[data.foreignKey] = {
      type: 'integer'
    };
  }

  data.primaryKeyAttributes = [];
  data.primaryKeyFields = [];
  _.forEach(data.properties, function(property, name) {
    if (property.primaryKey === true) {
      data.primaryKeyAttributes.push(name);
      data.primaryKeyFields.push(property.field || name);
    }
  });
  assert(data.primaryKeyAttributes.length > 0, 'Primary key not defined for table ' + data.key);

  data.adapter.buildInsertCommand(data);
  data.adapter.buildUpdateCommand(data);
  data.adapter.buildDeleteCommand(data);

  _.forEach(data.associations, function(association) {
    association.data.foreignKey = association.data.foreignKey ||
      getForeignKey(data.identity.name, association.data.requestedProperties);
    buildTable(association.data);
  });

  // Cache
  data.propertiesList = Object.keys(data.properties);
  data.coerce = [];
  _.forEach(data.properties, function(property, name) {
    if (property.type !== 'string') {
      data.coerce.push({
        property: name,
        fn: getCoercionFunction(property.type)
      });
    }
  });
  if (data.timestamps) {
    data.propertiesList.push('updatedAt');
    data.propertiesList.push('createdAt');
    data.coerce.push({
      property: 'createdAt',
      fn: getCoercionFunction('datetime')
    });
    data.coerce.push({
      property: 'updatedAt',
      fn: getCoercionFunction('datetime')
    });
  }

}

function buildQuery(data) {
  let fields = [];
  _.forEach(data.properties, function(property, name) {
    debug('Property', name);
    let fieldName = property.field || name;
    let alias = name.replace(/ /g, xmlSpaceToken);
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
    let foreignKey = association.data.properties[association.data.foreignKey].field ||
      association.data.foreignKey;
    fields.push(
      '(' + association.data.query +
      ' WHERE [' + foreignKey + ']=[' +
      data.key + '].[' +
      data.primaryKeyFields[0] +
      '] FOR XML PATH) AS [' +
      association.data.key + ']'
    )
  });
  data.query = 'SELECT ' + fields.join(',') +
    ' FROM [' + data.identity.name + '] AS [' + data.key + ']';
  debug('Query:', data.query);
}

function toJsonSchemaField(attribute) {
  let field = {};
  if (attribute.type.key === 'INTEGER') {
    field.type = 'integer';
  } else if (attribute.type.key === 'STRING') {
    field.type = 'string';
    field.maxLength = attribute.type.options.length;
  } else if (attribute.type.key === 'DATE') {
    field.type = 'date';
  } else if (attribute.type.key === 'ENUM') {
    field.type = 'string';
    field.enum = attribute.values;
    field.maxLength = attribute.values.reduce(function(length, value) {
      return value.length > length ? value.length : length;
    }, 0);
  } else if (attribute.type.key === 'DECIMAL') {
    field.type = 'number';
    field.decimals = attribute.type.options.scale;
    field.maxLength = attribute.type.options.precision;
  } else if (attribute.type.key === 'TEXT') {
    field.type = 'string';
  } else {
    throw new Error('Type ' + attribute.type.key + ' has no conversion defined')
  }
  attribute.primaryKey &&
  (field.primaryKey = attribute.primaryKey);
  attribute.autoIncrement &&
  (field.autoIncrement = attribute.autoIncrement);
  if (attribute.field !== attribute.fieldName) {
    field.field = attribute.field;
  }
  if (attribute.allowNull === false) {
    field.required = true;
  }
  return field;
}
