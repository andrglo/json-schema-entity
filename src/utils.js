// Adapted from https://github.com/cnect/sails-sqlserver/blob/master/lib/sql.js

var _ = require('lodash');
var sql = require('./sql');

exports.embedCriteria = function(query, criteria) {
  var statement = buildSelectStatement(query, criteria);
  statement += serializeOptions(query, criteria);
  if (criteria.skip) {
    var outerOffsetQuery = 'SELECT ';
    if (criteria.limit) {
      outerOffsetQuery += 'TOP ' + criteria.limit + ' ';
    }
    outerOffsetQuery += '* FROM (' + statement + ') __outeroffset__ ' +
      'WHERE __outeroffset__.__rownum__ > ' + criteria.skip + ' ';
    statement = outerOffsetQuery;
  }
  return statement;
};

function buildSelectStatement(query, criteria) {

  var statement = 'SELECT ';

  if (criteria.groupBy || criteria.sum || criteria.average || criteria.min || criteria.max) {

    // Append groupBy columns to select statement
    if (criteria.groupBy) {
      if (criteria.groupBy instanceof Array) {
        criteria.groupBy.forEach(function(opt) {
          statement += '[' + opt + '], ';
        });
      } else {
        statement += '[' + criteria.groupBy + '], ';
      }
    }

    // Handle SUM
    if (criteria.sum) {
      if (criteria.sum instanceof Array) {
        criteria.sum.forEach(function(opt) {
          statement += 'SUM([' + opt + ']) AS [' + opt + '], ';
        });
      } else {
        statement += 'SUM([' + criteria.sum + ']) AS [' + criteria.sum + '], ';
      }
    }

    // Handle AVG (casting to float to fix percision with trailing zeros)
    if (criteria.average) {
      if (criteria.average instanceof Array) {
        criteria.average.forEach(function(opt) {
          statement += 'AVG(CAST([' + opt + '] AS FLOAT)) AS [' + opt + '], ';
        });
      } else {
        statement += 'AVG(CAST([' + criteria.average + '] AS FLOAT)) AS [' + criteria.average + '], ';
      }
    }

    // Handle MAX
    if (criteria.max) {
      if (criteria.max instanceof Array) {
        criteria.max.forEach(function(opt) {
          statement += 'MAX([' + opt + ']) AS [' + opt + '], ';
        });
      } else {
        statement += 'MAX([' + criteria.max + ']) AS [' + criteria.max + '], ';
      }
    }

    // Handle MIN
    if (criteria.min) {
      if (criteria.min instanceof Array) {
        criteria.min.forEach(function(opt) {
          statement += 'MIN([' + opt + ']) AS [' + opt + '], ';
        });
      } else {
        statement += 'MIN([' + criteria.min + ']) AS [' + criteria.min + '], ';
      }
    }

    // trim trailing comma
    statement = statement.slice(0, -2) + ' ';

    // Add FROM clause
    return statement += 'FROM (' + query + ') t ';
  }

  //HANDLE SKIP
  if (criteria.skip) {
    var primaryKeySort = {};
    primaryKeySort[criteria.__primaryKey__] = 1;
    //@todo what to do with no primary key OR sort?
    criteria.sort = criteria.sort || primaryKeySort;
    statement += 'ROW_NUMBER() OVER (' +
      buildOrderByStatement(criteria) +
      ') AS \'__rownum__\', ';
  }
  else if (criteria.limit) {
    // SQL Server implementation of LIMIT
    statement += 'TOP ' + criteria.limit + ' ';
  }

  return statement += '* FROM (' + query + ') t ';

}


function buildOrderByStatement(criteria){

  var queryPart = 'ORDER BY ';

  // Sort through each sort attribute criteria
  _.each(criteria.sort, function(attrName) {

    var direction = '';
    if (attrName.substr(attrName.length - 4).toUpperCase() === ' ASC') {
      direction = 'ASC, ';
      attrName = attrName.substr(0, attrName.length - 4);
    } else if (attrName.substr(attrName.length - 5).toUpperCase() === ' DESC') {
      direction = 'DESC, ';
      attrName = attrName.substr(0, attrName.length - 5);
    }
    queryPart += '[' + attrName + '] ' + direction;
  });

  // Remove trailing comma
  if(queryPart.slice(-2) === ', ') {
    queryPart = queryPart.slice(0, -2) + ' ';
  }
  return queryPart;
}


function serializeOptions(query, options) {

  var queryPart = '';

  if (options.where) {
    queryPart += 'WHERE ' + sql.where(query, options.where) + ' ';
  }

  if (options.groupBy) {
    queryPart += 'GROUP BY ';

    // Normalize to array
    if(!Array.isArray(options.groupBy)) options.groupBy = [options.groupBy];
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
    _.each(options.sort, function(attrName) {

      var direction = '';
      if (attrName.substr(attrName.length - 4).toUpperCase() === ' ASC') {
        direction = 'ASC, ';
        attrName = attrName.substr(0, attrName.length - 4);
      } else if (attrName.substr(attrName.length - 5).toUpperCase() === ' DESC') {
        direction = 'DESC, ';
        attrName = attrName.substr(0, attrName.length - 5);
      }
      queryPart += sql.prepareAttribute(query, null, attrName) + ' ' + direction;
    });

    // Remove trailing comma
    if(queryPart.slice(-2) === ', ') {
      queryPart = queryPart.slice(0, -2) + ' ';
    }
  }

  return queryPart;
}
