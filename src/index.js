var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('json-schema-entity');

function EntityError(options) {
  options = options || {};
  this.name = options.name || 'EntityError';
  this.message = options.message || 'Entity error';
  if (options.errors) this.errors = options.errors;
  if (options.type) this.type = options.type;
}
EntityError.prototype = Object.create(Error.prototype);
EntityError.prototype.constructor = EntityError;

function runValidations(is, was, data) {

  var errors = [];

  function validate(is, was, data) {
    return runFieldValidations(is, was, data, errors).then(function() {
      return runModelValidations(is, was, data, errors).then(function() {
        return _.reduce(data.associations, function(chain, association) {
          return chain.then(function() {
            var associationKey = association.data.key;
            debug('Associated validation:', associationKey);
            var from = is && is[associationKey];
            var to = was && was[associationKey];
            if (_.isArray(from) || _.isArray(to)) {
              from = _.isArray(from) ? from.slice(0) : from ? [from] : [];
              to = _.isArray(to) ? to.slice(0) : to ? [to] : [];
              var pairs = [];

              var hasEqualPrimaryKey = function(a, b) {
                var same = false;
                _.forEach(association.data.primaryKeyAttributes, function(name) {
                  same = a[name] === b[name];
                  return same;
                });
                return same;
              }

              var findAndRemove = function(arr, obj) {       //todo refactor and more validation tests
                var res = _.remove(arr, function(e) { //todo save and new in instance
                  if (hasEqualPrimaryKey(e, obj)) {
                    return true;
                  }
                });
                assert(res.length < 2, 'Better call Gloria' + res.length);
                return res.length === 0 ? void 0 : res[0];
              };

              from.map(function(record) {
                pairs.push({
                  to: record,
                  from: findAndRemove(to, record)
                });
              });
              to.map(function(record) {
                pairs.push({
                  to: record
                });
              });

              return _.reduce(pairs, function(chain, pair) {
                return validate(pair.from, pair.to, association.data);
              }, Promise.resolve());
            } else {
              return validate(from, to, association.data);
            }
          });
        }, Promise.resolve());
      });
    });
  }

  return validate(is, was, data).then(function() {
    if (errors.length > 0) {
      throw new EntityError({
        message: 'Validation error',
        type: 'ValidationError',
        errors: errors
      });
    }
  });
}

function runFieldValidations(is, was, data, errors) {
  var validator = data.validator;
  return _.reduce(is && validator && data.properties, function(chain, property, key) {

    var validations = {};
    if (is[key]) {
      _.forEach(property.validations, function(validation, name) {
        var args = _.map(validation.args, function(arg) {
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
        };
      });
      if (property.format && !validations[property.format] && validator[property.format]) {
        validations[property.format] = {
          id: key,
          fn: validator[property.format],
          args: [is[key]]
        };
      }
    }
    return _.reduce(validations, function(chain, validation) {
      return chain.then(function() {
        debug('Running field validation:', validation.id, validation.args);
        var res;
        try {
          res = validation.fn.apply(validator, validation.args)
        } catch (err) {
          errors.push({path: validation.id, message: err.message})
        }             //todo change to field
        if (res && res.then) {
          return res.catch(function(err) {
            errors.push({path: validation.id, message: err.message})
          });
        } else {
          if (res === false) {
            errors.push({
              path: validation.id, message: validation.message ||
              'Invalid ' + validation.id
            });
          }
        }
      });
    }, chain);

  }, Promise.resolve());
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
      var res;
      try {
        res = validation.fn.call(is || was, is ? was : void 0)
      } catch (err) {
        errors.push({path: validation.id, message: err.message})
      }
      if (res && res.then) {
        return res.catch(function(err) {
          errors.push({path: validation.id, message: err.message});
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
  _.extend(this, entity);
}

function newInstace(entity, data) {

  var oldValues = _.cloneDeep(entity);

  function Instance(values) {
    _.extend(this, values);
  }

  Instance.prototype.validate = function() {
    return runValidations(this, oldValues, data);
  };

  data.instanceMethods.map(function(method) {
    Instance.prototype[method.id] = method.fn;
  });
  return new Instance(entity);
}

function buildEntity(record, data) {
  debug('Entity will be built:', data.key);
  var entity = data.adapter.createInstance(_.pick(record, data.propertiesList), data.identity.name, data);
  _.forEach(data.associations, function(association) {
    var key = association.data.key;
    debug('Checking association key:', key);
    if (record[key]) {
      var recordset = data.adapter.extractRecordset(record[key], association.data.coerce)
        .map(function(record) {
          return buildEntity(record, association.data)
        });
      entity[key] = recordset.length === 1 && association.type === 'hasOne' ?
        recordset[0] : recordset;
    }
  });
  return newInstace(entity, data);
}

function runHooks(hooks, model, transaction, data) {

  var allHooks = [];
  hooks.map(function(name) {
    allHooks = allHooks.concat(data.hooks[name]);
  });

  return _.reduce(allHooks, function(chain, hook) {
    return chain.then(function() {
      debug('Running hook:', hook.id);
      var res;
      try {
        res = hook.fn.call(model, transaction);
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
  var record = _.pick(entity, data.propertiesList);
  debug('Creating ', data.key);
  return runHooks(['beforeCreate', 'beforeSave'], entity, options.transaction, data)
    .then(function() {
      return data.adapter.create(record, data, {transaction: options.transaction})
        .then(function(instance) {
          var newEntity = _.pick(instance, data.propertiesList);
          return _.reduce(data.associations, function(chain, association) {
            const associationKey = association.data.key;
            var associatedEntity = entity[associationKey];
            const recordIsArray = _.isArray(associatedEntity);
            var hasMany = (recordIsArray && associatedEntity.length > 1) ||
              association.type === 'hasMany';
            if (association.type === 'hasOne' && hasMany) {
              throw new EntityError({
                type: 'InvalidData',
                message: 'Association ' + associationKey + ' can not be an array'
              });
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
                  });
              });
            }, chain);
          }, Promise.resolve()).then(function() {
            return newEntity;
          });
        });
    }).then(function(entity) {
      return runHooks(['afterCreate', 'afterSave'], entity, options.transaction, data)
        .then(function() {
          return newInstace(entity, data)
        });
    });
}

function update(entity, was, options, data) {
  var record = _.pick(entity, data.propertiesList);
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
          var modifiedEntity = record;
          return _.reduce(data.associations, function(chain, association) {
            const associationKey = association.data.key;
            const associationPrimaryKey = association.data.primaryKeyAttributes;

            function exists(a) {
              return a[association.data.foreignKey] !== void 0;
            }

            var hasEqualPrimaryKey = function(a, b) {
              var same = false;
              _.forEach(associationPrimaryKey, function(name) {
                same = a[name] === b[name];
                return same;
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
                  return obj;
                }
              }
              assert(false, 'Better call Gloria');
            };

            var associatedIsEntity = entity[associationKey];
            var hasMany = (_.isArray(associatedIsEntity) && associatedIsEntity.length > 1) ||
              association.type === 'hasMany';
            if (association.type === 'hasOne' && hasMany) {
              throw new EntityError({
                type: 'InvalidData',
                message: 'Association ' + associationKey + ' can not be an array'
              })
            }
            associatedIsEntity = _.isArray(associatedIsEntity) ?
              associatedIsEntity.slice(0) : associatedIsEntity ? [associatedIsEntity] : void 0;

            var associatedWasEntity = was[associationKey];
            associatedWasEntity = _.isArray(associatedWasEntity) ?
              associatedWasEntity.slice(0) : associatedWasEntity ? [associatedWasEntity] : void 0;

            var toBeCreated = _.remove(associatedIsEntity, function(is) {
              return !exists(is)
            });
            var toBeUpdated = associatedIsEntity;
            var toBeDeleted = _.remove(associatedWasEntity, function(was) {
              var hasIs = false;
              _.forEach(toBeUpdated, function(is) {
                if (hasEqualPrimaryKey(was, is)) {
                  hasIs = true;
                  return false;
                }
              });
              return !hasIs;
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
                    });
                });
              }, chain);
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
                    });
                });
              }, chain);
            });
          }, Promise.resolve()).then(function() {
            return modifiedEntity;
          });
        });
    }).then(function(entity) {
      return runHooks(['afterUpdate', 'afterSave'], entity, options.transaction, data)
        .then(function() {
          return newInstace(entity, data);
        });
    });
}

function destroy(entity, options, data) {
  debug('Deleting ', data.key);
  return runHooks(['beforeDelete', 'beforeDestroy'], entity, options.transaction, data)
    .then(function() {
      return _.reduce(data.associations, function(chain, association) {
        const associationKey = association.data.key;
        var associatedEntity = entity[associationKey];
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
      });
    }).then(function(entity) {
      return runHooks(['afterDestroy', 'afterDelete'], entity, options.transaction, data)
    });
}

module.exports = function(schemaName, schema, config) {

  var adapter = getAdapter(config.db);
  var entity = entityFactory(schemaName, schema, rebuild);

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
    var data = {
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
          var association = entityFactory(schemaName, schema, rebuild);
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
          var association = entityFactory(schemaName, schema, rebuild);
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
        foreignKey: function(name) {
          data.foreignKey = name;
          rebuild();
          return data.public;
        },
        getSchema: function() {

          function buildSchema(data) {
            var schema = data.schema;
            _.forEach(data.associations, function(association) {
              var key = association.data.key;
              if (association.type === 'hasOne') {
                schema.properties[key] = buildSchema(association.data);
              } else {
                schema.properties[key] = {
                  type: 'array',
                  items: buildSchema(association.data)
                };
              }
            });
            return data.schema;
          }

          return buildSchema(data);

        },
        findAll: function(criteria, options) {
          options = options || {};
          if (data.scope) {
            var where = _.extend({}, criteria.where, data.scope);
            criteria = _.extend({}, criteria);
            criteria.where = where;
          }
          return adapter
            .query(data.query, criteria, options)
            .then(function(res) {
              return res.map(function(record) {
                return buildEntity(record, data)
              });
            });
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
            var id = key;
            key = {where: {}};
            key.where[data.primaryKeyAttributes[0]] = id;
          } else if (!key.where) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Where clause not defined for entity ' + data.key + ' update'
              });
            });
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
                });
            });
        },
        destroy: function(key, options) {
          if (!key) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Entity ' + data.key + ' need a primary key for delete'
              });
            });
          }
          options = options || {};
          if (typeof key !== 'object') {
            var id = key;
            key = {where: {}};
            key.where[data.primaryKeyAttributes[0]] = id;
          } else if (!key.where) {
            return Promise.resolve().then(function() {
              throw new EntityError({
                type: 'InvalidArgument',
                message: 'Where clause not defined for entity ' + data.key + ' delete'
              });
            });
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

    var methodId = 0;

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
      var normalizedOptions = {
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
    adapter.buildQuery(entity);
  }

};

function getForeignKey(table, properties) {
  var foreignKey;
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

function getAdapter(db) {
  if (isNodeMssql(db)) {
    return require('./adapters/mssql')(db);
  } else if (isPostgres(db)) {
    return require('./adapters/postgres')(db);
  } else {
    throw new Error('Adapter for this conector is not implemented');
  }
}

function isNodeMssql(db) {
  return db.DRIVERS !== void 0; //todo identify in a better way
}

function isPostgres(db) {
  return db.oneOrNone !== void 0; //todo identify in a better way
}

function splitAlias(name) {
  var res = {};
  var re = /^(.+) as (.+)$/i;
  var match = re.exec(name);
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
  var property;
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
    });
  }
  return property;
}

function buildTable(data) {

  var attributes = data.adapter.getAttributes(data.identity.name);
  data.schema = {
    type: 'object',
    properties: {}
  };
  if (data.title) data.schema.title = data.title;
  if (data.description) data.schema.description = data.description;
  var hasRequestedProperties = data.requestedProperties !== void 0;
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

function toJsonSchemaField(attribute) {
  var field = {};
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
  if (attribute.primaryKey) {
    field.primaryKey = attribute.primaryKey;
  }
  if (attribute.autoIncrement) {
    field.autoIncrement = attribute.autoIncrement;
  }
  if (attribute.field !== attribute.fieldName) {
    field.field = attribute.field;
  }
  if (attribute.allowNull === false) {
    field.required = true;
  }
  return field;
}
