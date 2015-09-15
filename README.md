# json-schema-entity [![NPM version][npm-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Dependency Status][daviddm-image]][daviddm-url] [![Coverage percentage][coveralls-image]][coveralls-url]
> Manage a group of tables with a parent child relation in SQL that will be seen as a document, or entity, like a no SQL dtaabase

## Install

```sh
$ npm install --save json-schema-entity
```

## Usage (require pg-cr-layer or mssql-cr-layer)

```js
var jse = require('json-schema-entity');
var pgCrLayer = require('pg-cr-layer');
 
var config = {
  user: 'me',
  password: 'my password',
  host: 'localhost',
  port: 5432,
  pool: {
    max: 25,
    idleTimeout: 30000
  }
};
 
var layer = new PgCrLayer(config)
 
layer.connect()
  .then(function() {

    var invoice = jse('invoice', {
        properties: {
          id: {
            type: 'integer',
            autoIncrement: true,
            primaryKey: true
          },
          client: {
            type: 'string'
          }
        }
      }, {db: layer});
      invoice.hasMany('items', {
        properties: {
          id: {
            type: 'integer',
            autoIncrement: true,
            primaryKey: true
          },
          name: {
            type: 'string'
          },
          description: {
            type: 'string'
          },
          price: {
            type: 'number',
            maxLength: 10,
            decimals: 2
          },
          invoiceId: {
            type: 'integer',
            $ref: 'invoice'
          }
        }
      });
      var invoiceInstance;
      invoice.createTables() // Will create tables invoice and items
        .then(function() {
          return invoice.syncTables(); // Then the reference in items
        })
        .then(function() {
          invoiceInstance = invoice.createInstance({
            client: 'Jessica',
            items: [
              {
                name: 'diamond',
                description: 'a beautiful diamond',
                price: 9999.99
              }
            ]
          });
          return invoiceInstance.save();
        })
        .then(function() {
          console.log(JSON.stringify(invoiceInstance, null, ' '));
          /* will log
           {
            "id": 1,
            "client": "Jessica",
            "items": [
             {
              "id": 1,
              "name": "diamond",
              "description": "a beautiful diamond",
              "price": 9999.99,
              "invoiceId": 1
             }
            ]
           }
          */
        })
	});
  
```

## License

MIT © [Andre Gloria]()


[npm-image]: https://badge.fury.io/js/json-schema-entity.svg
[npm-url]: https://npmjs.org/package/json-schema-entity
[travis-image]: https://travis-ci.org/andrglo/json-schema-entity.svg?branch=master
[travis-url]: https://travis-ci.org/andrglo/json-schema-entity
[daviddm-image]: https://david-dm.org/andrglo/json-schema-entity.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/andrglo/json-schema-entity
[coveralls-image]: https://coveralls.io/repos/andrglo/json-schema-entity/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/andrglo/json-schema-entity?branch=master
