var _ = require('lodash');
var assert = require('assert');
var xml2json = require('xml2json');
var debug = require('debug')('json-schema-entity');

var utils = require('./utils');
var commonLayer = require('./commonLayer');

var xmlSpaceToken = '_-_';
var xmlSpaceTokenRegExp = new RegExp(xmlSpaceToken, 'g');

module.exports = function(db) {

  var cl = commonLayer(db);

  var adapter = {};
  adapter.query = function(command, criteria, options) {
    var sentence = utils.embedCriteria(command, criteria, cl);
    return cl.query(sentence, options.transaction);
  };
  adapter.createInstance = function(record, name, data) {
    var instance = {};
    _.forEach(data.properties, function(property, name) {
      if (property.enum) {
        _.forEach(property.enum, function(value) {
          if (value.substr(0, record[name].length) === record[name]) {
            instance[name] = value;
            return false;
          }
        });
      } else if (record[name] && record[name] !== null) {
        instance[name] = record[name];
      }
    });
    if (data.timestamps) {
      instance.createdAt = record.createdAt;
      instance.updatedAt = record.updatedAt;
    }
    return instance;
  };
  adapter.getAttributes = function(name) {
  };
  adapter.transaction = cl.transaction;
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
        return new db.Decimal(property.maxLength, property.decimals);
      case 'date':
      case 'datetime':
        return db.DateTime;
      case 'string':
        return new db.NVarChar(property.maxLength);
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

    var fieldsWithType = [];
    var fields = [];
    //var fieldsToInsert = [];
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
      var commands = ['DECLARE @tmp TABLE (' + fieldsWithType.join(',') + ')'];
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
    var fields = [];
    var fieldsToRead = [];
    var defaultValues = {};
    var params = {};
    var ps = new db.PreparedStatement(options.transaction);
    _.forEach(data.properties, function(property, name) {
      if (property.autoIncrement) {
        fieldsToRead.push({from: property.field || name, to: name})
      } else {
        var value = record[name];
        if ((value === void 0 || value === null) && property.defaultValue) {
          value = property.defaultValue;
          defaultValues[name] = value;
        }
        if (value !== void 0) {
          var field = property.field || name;
          fields.push(field);
          if (property.enum) {
            value = value.substr(0, property.maxLength);
          }
          const key = _.camelCase(field);
          ps.input(key, adapter.toAdapterType(property));
          if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
            params[key] = new Date(value);
          } else {
            params[key] = value;
          }
        }
      }
    });
    if (data.timestamps) {
      var now = new Date();
      ps.input('createdAt', new db.DateTime2(3));
      ps.input('updatedAt', new db.VarChar(26));
      params.createdAt = now.toISOString();
      params.updatedAt = now.toISOString().substring(0, 23) + '000';
      fields.push('createdAt');
      fields.push('updatedAt');
      fieldsToRead.push({from: 'createdAt', to: 'createdAt'});
      fieldsToRead.push({from: 'updatedAt', to: 'updatedAt'})
    }
    var insertCommand = data.insertCommand.replace('<fields>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '[' + field + ']';
      }, '')).replace('<values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '@' + _.camelCase(field);
      }, ''));
    debug(insertCommand, params);
        return     ps.prepare(insertCommand)
      .then(function() {
        return ps.execute(params);
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
    var fields = [];
    var params = {};
    var ps = new db.PreparedStatement(options.transaction);
    _.forEach(data.properties, function(property, name) {
      if (!property.autoIncrement) {
        var value = record[name];
        if (value !== void 0) {
          var field = property.field || name;
          fields.push(field);
          if (property.enum) {
            value = value.substr(0, property.maxLength);
          }
          const key = _.camelCase(field);
          ps.input(key, adapter.toAdapterType(property));
          if ((property.type === 'date' || property.type === 'datetime') && !_.isDate(value)) {
            params[key] = new Date(value);
          } else {
            params[key] = value;
          }
        }
      }
    });

    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      var key = _.camelCase('pk' + name);
      ps.input(key, adapter.toAdapterType(data.properties[attribute]));
      params[key] = options.where[attribute];
      return name;
    });
    if (data.timestamps) {
      var now = new Date();
      ps.input('updatedAt', new db.VarChar(26));
      params.updatedAt = now.toISOString().substring(0, 23) + '000';
      fields.push('updatedAt');

      ps.input('pkupdatedAt', new db.VarChar(26));
      params.pkupdatedAt = _.isDate(options.where.updatedAt) ?
        options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
      findKeys.push('updatedAt')
    }

    var updateCommand = data.updateCommand.replace('<fields-values>',
      fields.reduce(function(fields, field) {
        return fields + (fields ? ',' : '') + '[' + field + ']=@' + _.camelCase(field);
      }, '')).replace('<primary-keys>',
      findKeys.reduce(function(fields, field) {
        return fields + (fields ? ' AND ' : '') + '[' + field + ']=@' + _.camelCase('pk' + field);
      }, ''));
    //console.log(updateCommand)
        return     ps.prepare(updateCommand)
      .then(function() {
        return ps.execute(params)
      })
      .then(function(recordset) {
        if (data.timestamps) {
          if (!(recordset && recordset[0] && recordset[0].updatedAt)) {
            console.log('Timestamp not saved', recordset, typeof params.pkupdatedAt, params.pkupdatedAt,
              params,
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
          throw error;
        })
      })
  };
  adapter.destroy = function(data, options) {
    assert(options.where)
    var ps = new db.PreparedStatement(options.transaction);
    var params = {};
    var findKeys = data.primaryKeyFields.map(function(name, index) {
      const attribute = data.primaryKeyAttributes[index];
      var key = _.camelCase('pk' + name);
      ps.input(key, adapter.toAdapterType(data.properties[attribute]));
      params[key] = options.where[attribute]
      return name;
    });
    if (data.timestamps) {
      ps.input('pkupdatedAt', new db.VarChar(26));
      params.pkupdatedAt = _.isDate(options.where.updatedAt) ?
        options.where.updatedAt.toISOString() : (options.where.updatedAt || null);
      findKeys.push('updatedAt')
    }

    var deleteCommand = data.deleteCommand.replace('<find-keys>',
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
        });
      })
      .catch(function(error) {
        return ps.unprepare().then(function() {
          throw error;
        });
      });
  };

  adapter.extractRecordset = function(xmlField, coerce) {
    var json = xml2json.toJson('<recordset>' + xmlField + '</recordset>', {
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
        if (record[coercion.property]) record[coercion.property] = coercion.fn(record[coercion.property]);
        debug('Coercion after', coercion.property, typeof record[coercion.property], record[coercion.property]);
      });
    });

    return isArray ? json : [json];
  };

  adapter.buildQuery = buildQuery;

  adapter.getCoercionFunction = function(type) {
    switch (type) {
      case 'integer':
        return Number.parseInt;
      case 'number':
        return Number.parseFloat;
      case 'date':
      case 'datetime':
        return function(value) {
          return new Date(value);
        };
      default:
        //return function(value) {
        //  return value;
        //};
        throw new Error('Coercion not defined for type ' + type)
    }
  };

  return adapter;
};

function buildQuery(data) {
  var fields = [];
  _.forEach(data.properties, function(property, name) {
    debug('Property', name);
    var fieldName = property.field || name;
    var alias = name.replace(/ /g, xmlSpaceToken);
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
    var foreignKey = association.data.properties[association.data.foreignKey].field ||
      association.data.foreignKey;
    fields.push(
      '(' + association.data.query +
      ' WHERE [' + foreignKey + ']=[' +
      data.key + '].[' +
      data.primaryKeyFields[0] +
      '] FOR XML PATH) AS [' +
      association.data.key + ']'
    );
  });
  data.query = 'SELECT ' + fields.join(',') +
    ' FROM [' + data.identity.name + '] AS [' + data.key + ']';
  debug('Query:', data.query);
}
