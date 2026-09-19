# json-schema-entity [![NPM version][npm-image]][npm-url] [![Dependency Status][daviddm-image]][daviddm-url] [![CircleCI](https://circleci.com/gh/andrglo/json-schema-entity.svg?style=svg)](https://circleci.com/gh/andrglo/json-schema-entity)
> Manage a group of tables with a parent child relation in SQL that will be seen as a document, or entity, like a no SQL database

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

var db = new PgCrLayer(config)

var invoiceClass = jse('invoice', {
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
  });

invoiceClass.hasMany('items', {
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
var invoice = invoiceClass.new(db);
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

```

## Searching a hasMany association

A `hasMany` association can declare which of its properties are searchable, and a fetch
criteria can then select the parents by a free text matched against them:

```js
invoiceClass.hasMany('items', itemsSchema, {
  searchable: ['name', 'description']
});

invoice.fetch({where: {items: {search: 'diamond'}}});
```

`searchable` accepts an array or a comma separated string (`'name,description'`); the names
are trimmed and repeated ones are kept only once. Every name must be a property of the
association: an unknown name, or a list that ends up empty (`[]`, `''`), throws when the
association is declared. A property that displays a lookup table (`display` plus
`schema.$ref`) is searched on the description of the lookup, which is left joined in.

The declaration is published by `schema.get()` as `searchable` on the association property,
so a consumer can tell which associations offer a search.

The criteria `{<association>: {search: <text>}}` becomes a correlated `EXISTS` over the child
table, with one `LIKE` per searchable property, combined with `OR`. Also:

- the parent needs a single column primary key: with a composite one only the first column
  would be correlated, so it throws instead of answering with an `EXISTS` that over matches;
- the value is always bound as a parameter and the library wraps it in `%…%`. LIKE
  metacharacters are **not** escaped, on purpose: a `%` or a `_` in the text is a wildcard;
- an empty or blank text throws. `LIKE '%%'` is not "match everything": it still requires a
  child row with a non null searchable column, so it would silently drop every parent with no
  children - a cleared search box returning fewer rows than no search at all.

### The text is normalized by the caller, and the contract differs per dialect

- **PostgreSQL** folds the *column*, never the parameter: each term is
  `lower(public.f_unaccent(<column>)) LIKE $n`, with a non text column cast to `text` first.
  The caller must pass text already in lower case and without accents - `agua` finds
  `Pagamento de água`, while `Água` finds nothing. `public.f_unaccent` has to exist in the
  database; it is the same function `sql-view` uses for its `:ai` decoration.
- **SQL Server** emits a plain `LIKE` and relies entirely on the collation of the database.
  Whether `agua` matches `água` is decided there, not here.

So a caller that normalizes for PostgreSQL gets **zero accented hits** on an accent
*sensitive* SQL Server collation. The same call is not portable: how to normalize is a
decision that has to be taken knowing the dialect.

### Re-entrancy

The search predicate is resolved in the middle of `build`, and `src/sql-view.js` keeps its
state - the parameter list included - in module globals. A resolver supplied by a consumer
must not call `build` itself: the nested call resets that state and corrupts the parameters
of the statement being built.

## License

MIT © [Andre Gloria]()


[npm-image]: https://badge.fury.io/js/json-schema-entity.svg
[npm-url]: https://npmjs.org/package/json-schema-entity
[daviddm-image]: https://david-dm.org/andrglo/json-schema-entity.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/andrglo/json-schema-entity
