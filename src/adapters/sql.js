// Adapted from https://github.com/cnect/sails-sqlserver/blob/master/lib/sql.js

var _ = require('lodash');
_.str = require('underscore.string');

var sql = {

  escapeId: function(val) {
    return sql.cl.wrap(val.replace(/'/g, '\'\''));
  },

  escape: function(val, stringifyObjects, timeZone) {

    if (val === undefined || val === null) {
      return 'NULL';
    }

    switch (typeof val) {
      case 'boolean':
        return (val) ? '1' : '0';
      case 'number':
        return val + '';
    }

    if (typeof val === 'object') {
      val = val.toString();
    }

    val = val.replace(/[\']/g, function(s) {
      switch (s) {
        case '\'':
          return '\'\'';
        default:
          return ' ';
      }
    });

    return '\'' + val + '\'';
  },

  normalizeSchema: function(schema) {
    return _.reduce(schema, function(memo, field) {

      // Marshal mssql DESCRIBE to waterline collection semantics
      var attrName = field.ColumnName;
      var type = field.TypeName;

      memo[attrName] = {
        type: type
        //defaultsTo: field.Default
      };

      memo[attrName].autoIncrement = field.AutoIncrement;
      memo[attrName].primaryKey = field.PrimaryKey;
      memo[attrName].unique = field.Unique;
      memo[attrName].indexed = field.Indexed;
      memo[attrName].nullable = field.Nullable;

      return memo;
    }, {});
  },

  // @returns ALTER query for adding a column
  addColumn: function(collectionName, attrName, attrDef) {
    var tableName = collectionName;
    var columnDefinition = sql.uSchema(collectionName, attrDef, attrName);
    return 'ALTER TABLE [' + tableName + '] ADD ' + columnDefinition;
  },

  // @returns ALTER query for dropping a column
  removeColumn: function(collectionName, attrName) {
    var tableName = collectionName;
    attrName = attrName;
    return 'ALTER TABLE [' + tableName + '] DROP COLUMN ' + attrName;
  },

  insertQuery: function(collectionName, data) {
    var tableName = collectionName;
    return 'INSERT INTO [' + tableName + '] ' + '(' + sql.attributes(collectionName, data) + ')' + ' VALUES (' + sql.values(collectionName, data) + '); SELECT @@IDENTITY AS [id]';
  },

  // Create a schema csv for a DDL query
  schema: function(collectionName, attributes) {
    return sql.build(collectionName, attributes, sql.uSchema);
  },

  uSchema: function(collectionName, attribute, attrName) {

    attrName = '[' + attrName + ']';
    var type = sqlTypeCast(attribute.type);

    if (attribute.primaryKey) {

      // If type is an integer, set auto increment
      if (type === 'INT') {
        return attrName + ' INT IDENTITY PRIMARY KEY';
      }

      // Just set NOT NULL on other types
      return attrName + ' VARCHAR(255) NOT NULL PRIMARY KEY';
    }

    // Process UNIQUE field
    if (attribute.unique) {
      return attrName + ' ' + type + ' UNIQUE';
    }

    return attrName + ' ' + type + ' NULL';
  },

  // Create an attribute csv for a DQL query
  attributes: function(collectionName, attributes) {
    return sql.build(collectionName, attributes, sql.prepareAttribute);
  },

  // Create a value csv for a DQL query
  // key => optional, overrides the keys in the dictionary
  values: function(collectionName, values, key) {
    return sql.build(collectionName, values, sql.prepareValue, ', ', key);
  },

  updateCriteria: function(collectionName, values) {
    var query = sql.build(collectionName, values, sql.prepareCriterion);
    query = query.replace(/IS NULL/g, '=NULL');
    return query;
  },

  prepareCriterion: function(collectionName, value, key, parentKey) {

    if (validSubAttrCriteria(value)) {
      return sql.where(collectionName, value, null, key);
    }

    // Build escaped attr and value strings using either the key,
    // or if one exists, the parent key
    var attrStr;
    var valueStr;

    // Special comparator case
    if (parentKey) {

      attrStr = sql.prepareAttribute(collectionName, value, parentKey);
      valueStr = sql.prepareValue(collectionName, value, parentKey);

      // Why don't we strip you out of those bothersome apostrophes?
      var nakedButClean = _.str.trim(valueStr, '\'');

      if (key === '<' || key === 'lessThan') return attrStr + '<' + valueStr;
      else if (key === '<=' || key === 'lessThanOrEqual') return attrStr + '<=' + valueStr;
      else if (key === '>' || key === 'greaterThan') return attrStr + '>' + valueStr;
      else if (key === '>=' || key === 'greaterThanOrEqual') return attrStr + '>=' + valueStr;
      else if (key === '!' || key === 'not') {
        if (value === null) return attrStr + ' IS NOT NULL';
        else if (_.isArray(value)) {
          //return attrStr + ' NOT IN (' + valueStr.split(',') + ')';
          return attrStr + ' NOT IN (' + sql.values(collectionName, value, key) + ')';
        }
        else return attrStr + '<>' + valueStr;
      }
      else if (key === 'like') return attrStr + ' LIKE \'' + nakedButClean + '\'';
      else if (key === 'contains') return attrStr + ' LIKE \'%' + nakedButClean + '%\'';
      else if (key === 'startsWith') return attrStr + ' LIKE \'' + nakedButClean + '%\'';
      else if (key === 'endsWith') return attrStr + ' LIKE \'%' + nakedButClean + '\'';
      else throw new Error('Unknown comparator: ' + key);
    } else {
      attrStr = sql.prepareAttribute(collectionName, value, key);
      valueStr = sql.prepareValue(collectionName, value, key);
      if (_.isNull(value)) {
        return attrStr + ' IS NULL';
      } else return attrStr + '=' + valueStr;
    }
  },

  prepareValue: function(collectionName, value, attrName) {
    // Cast dates to SQL
    if (_.isDate(value)) {
      if (sql.cl.dialect === 'mssql') {
        value = toSqlDate(value);
      } else {
        value = value.toISOString();
      }
    }

    // Cast functions to strings
    if (_.isFunction(value)) {
      value = value.toString();
    }

    // Escape (also wraps in quotes)
    return sql.escape(value);
  },

  prepareAttribute: function(collectionName, value, attrName) {
    return sql.cl.wrap(attrName);
  },

  // Starting point for predicate evaluation
  // parentKey => if set, look for comparators and apply them to the parent key
  where: function(collectionName, where, key, parentKey) {
    return sql.build(collectionName, where, sql.predicate, ' AND ', undefined, parentKey);
  },

  // Recursively parse a predicate calculus and build a SQL query
  predicate: function(collectionName, criterion, key, parentKey) {

    var queryPart = '';

    if (parentKey) {
      return sql.prepareCriterion(collectionName, criterion, key, parentKey);
    }

    // OR
    if (key.toLowerCase() === 'or') {
      queryPart = sql.build(collectionName, criterion, sql.where, ' OR ');
      return ' ( ' + queryPart + ' ) ';
    } else if (key.toLowerCase() === 'and') { // AND
      queryPart = sql.build(collectionName, criterion, sql.where, ' AND ');
      return ' ( ' + queryPart + ' ) ';
    } else if (_.isArray(criterion)) { // IN
      var values = sql.values(collectionName, criterion, key) || 'NULL';
      queryPart = sql.prepareAttribute(collectionName, null, key) + ' IN (' + values + ')';
      return queryPart;
    } else if (key.toLowerCase() === 'like') { // LIKE
      return sql.build(collectionName, criterion, function(collectionName, value, attrName) {
        var attrStr = sql.prepareAttribute(collectionName, value, attrName);
        if (_.isRegExp(value)) {
          throw new Error('RegExp not supported');
        }
        var valueStr = sql.prepareValue(collectionName, value, attrName);
        // Handle escaped percent (%) signs [encoded as %%%]
        valueStr = valueStr.replace(/%%%/g, '\\%');

        return attrStr + ' LIKE ' + valueStr;
      }, ' AND ');
    } else if (key.toLowerCase() === 'not') { // NOT
      throw new Error('NOT not supported yet!');
    } else { // Basic criteria item
      return sql.prepareCriterion(collectionName, criterion, key);
    }

  },

  serializeOptions: function(collectionName, options) {

    var queryPart = '';

    if (options.where) {
      queryPart += 'WHERE ' + sql.where(collectionName, options.where) + ' ';
    }

    if (options.groupBy) {
      queryPart += 'GROUP BY ';

      // Normalize to array
      if (!Array.isArray(options.groupBy)) options.groupBy = [options.groupBy];
      options.groupBy.forEach(function(key) {
        queryPart += key + ', ';
      });

      // Remove trailing comma
      queryPart = queryPart.slice(0, -2) + ' ';
    }

    //options are sorted during skip when applicable
    if (options.sort && !options.skip) {
      queryPart += 'ORDER BY ';

      // Sort through each sort attribute criteria
      _.each(options.sort, function(direction, attrName) {

        queryPart += sql.prepareAttribute(collectionName, null, attrName) + ' ';

        // Basic MongoDB-style numeric sort direction
        if (direction === 1) {
          queryPart += 'ASC, ';
        } else {
          queryPart += 'DESC, ';
        }
      });

      // Remove trailing comma
      if (queryPart.slice(-2) === ', ') {
        queryPart = queryPart.slice(0, -2) + ' ';
      }
    }

    return queryPart;
  },

  build: function(collectionName, collection, fn, separator, keyOverride, parentKey) {

    separator = separator || ', ';
    var $sql = '';

    _.each(collection, function(value, key) {
      $sql += fn(collectionName, value, keyOverride || key, parentKey);

      // (always append separator)
      $sql += separator;
    });

    return _.str.rtrim($sql, separator);
  }

};

// Cast waterline types into SQL data types
function sqlTypeCast(type) {

  type = type && type.toLowerCase();

  switch (type) {
    case 'binary':
    case 'string':
      return 'NVARCHAR(max)';

    case 'array':
    case 'json':
    case 'text':
      return 'VARCHAR(max)';

    case 'boolean':
      return 'BIT';

    case 'int':
    case 'integer':
      return 'INT';

    case 'float':
    case 'double':
      return 'FLOAT';

    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'datetime':
      return 'DATETIME';

    default:
      console.error('Unregistered type given: ' + type);
      return 'VARCHAR';
  }
}

function wrapInQuotes(val) {
  return '"' + val + '"';
}

function toSqlDate(date) {
  date = date.getUTCFullYear() + '-' +
    ('00' + (date.getUTCMonth() + 1)).slice(-2) + '-' +
    ('00' + date.getUTCDate()).slice(-2) + ' ' +
    ('00' + date.getUTCHours()).slice(-2) + ':' +
    ('00' + date.getUTCMinutes()).slice(-2) + ':' +
    ('00' + date.getUTCSeconds()).slice(-2) + '.' +
    ('00' + date.getUTCMilliseconds()).slice(-3);

  return date;
}

function validSubAttrCriteria(c) {
  return _.isObject(c) && (
    !_.isUndefined(c.not) || !_.isUndefined(c.greaterThan) || !_.isUndefined(c.lessThan) || !_.isUndefined(c.greaterThanOrEqual) || !_.isUndefined(c.lessThanOrEqual) || !_.isUndefined(c['<']) || !_.isUndefined(c['<=']) || !_.isUndefined(c['!']) || !_.isUndefined(c['>']) || !_.isUndefined(c['>=']) || !_.isUndefined(c.startsWith) || !_.isUndefined(c.endsWith) || !_.isUndefined(c.contains) || !_.isUndefined(c.like));
}

module.exports = sql;