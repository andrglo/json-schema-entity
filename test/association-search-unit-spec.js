'use strict'

/* eslint no-undef:0 */

// Pure unit spec for the hasMany association search predicate: no
// database needed, asserts on the emitted statement and its params.
// Run standalone with:
//   npx mocha test/association-search-unit-spec.js --exit
const entity = require('../src')
const sqlView = require('../src/sql-view')
const postgresAdapter = require('../src/adapters/postgres')
const mssqlAdapter = require('../src/adapters/mssql')

let expect
before(function () {
  return import('chai').then(chai => {
    expect = chai.expect
  })
})

// The parent of the fixture below: its primary key is the property
// `id` stored in the column `NUMINT`, so the correlation can only be
// written with the ATTRIBUTE - the derived table exposes the alias
const VIEW = 'SELECT "NUMINT" AS "id" FROM "docpag"'

function buildChild(searchable) {
  return {
    key: 'CLASSIFICACAO',
    identity: {name: 'docpagcc'},
    foreignKey: 'NUMDOC',
    searchable: searchable,
    properties: {
      NUMDOC: {type: 'integer', field: 'numdoc'},
      HISTORICO: {type: 'string', field: 'historico'},
      CONTACC: {
        type: 'string',
        field: 'contacc',
        display: 'cost_center.description',
        schema: {$ref: 'cost_center', key: 'id'}
      },
      CONTAEV: {
        type: 'string',
        field: 'contaev',
        display: 'category.description',
        schema: {$ref: 'category', key: 'id'}
      },
      SEMCAMPO: {type: 'string'},
      VALOR: {type: 'integer', field: 'valor'}
    }
  }
}

function buildData(config) {
  config = config || {}
  const associations = []
  if (config.association !== false) {
    associations.push({
      type: 'hasMany',
      data: config.child || buildChild(config.searchable)
    })
  }
  return {
    key: 'docpag',
    identity: {name: 'docpag'},
    primaryKeyAttributes: config.primaryKeyAttributes || ['id'],
    primaryKeyFields: ['NUMINT'],
    properties: {
      id: {type: 'integer', primaryKey: true, field: 'NUMINT'},
      DESCRICAO: {type: 'string'}
    },
    associations: associations
  }
}

function build(dialect, criteria, config) {
  config = config || {}
  const adapter =
    dialect === 'postgres' ? postgresAdapter() : mssqlAdapter()
  const data = buildData(config)
  const options = config.options || {}
  return sqlView(dialect).build(config.view || VIEW, criteria, {
    buildAssociationSearch: function (
      key,
      value,
      prepareValue,
      outerAlias
    ) {
      return adapter.buildAssociationSearch(
        data,
        key,
        value,
        prepareValue,
        options,
        outerAlias
      )
    }
  })
}

// everything after the outer where, i.e. the predicate itself - the
// exists carries its own WHERE, so only the first one is the boundary
function predicateOf(view) {
  const at = view.statement.indexOf(' WHERE ')
  expect(at).to.be.above(-1)
  return view.statement.slice(at + 7)
}

const defaultSearchable = ['HISTORICO', 'CONTACC', 'CONTAEV']

// The child is the parent's OWN table - hasMany('docpag as parcels')
// is a real shape - and the lookup of a searchable property points at
// that same table again: three appearances of one table in one
// predicate, told apart only by their aliases
function selfRefChild() {
  return {
    key: 'parcels',
    identity: {name: 'docpag'},
    foreignKey: 'NUMDOCORI',
    searchable: ['HISTORICO', 'NUMDOCORI'],
    properties: {
      NUMDOCORI: {
        type: 'integer',
        field: 'numdocori',
        display: 'docpag.historico',
        schema: {$ref: 'docpag', key: 'id'}
      },
      HISTORICO: {type: 'string', field: 'historico'}
    }
  }
}

// the body of the exists, i.e. everything after its own WHERE
function existsBodyOf(predicate) {
  const at = predicate.indexOf(' WHERE ')
  expect(at).to.be.above(-1)
  return predicate.slice(at + 7)
}

// every table reference, with the alias it was given - a table with no
// explicit alias takes an implicit one from its name, and an implicit
// alias equal to an outer one shadows it and silently under matches
function tableReferencesOf(predicate) {
  return (predicate.match(/\b(?:FROM|JOIN) \S+(?: AS \S+)?/g) || []).map(
    function (reference) {
      const parts = reference.split(' ')
      return {
        table: parts[1],
        alias: parts[2] === 'AS' ? parts[3] : void 0
      }
    }
  )
}

function identifiersOf(dialect, text) {
  return dialect === 'postgres'
    ? text.match(/"(?:[^"]|"")+"/g) || []
    : text.match(/\[[^\]]+]/g) || []
}

describe('association search (postgres)', function () {
  const pg = (criteria, config) =>
    build('postgres', criteria, config)

  it('should emit the exists with its joins and like terms', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    expect(predicateOf(view)).to.equal(
      'EXISTS (SELECT 1 FROM "docpagcc" AS "CLASSIFICACAO"' +
        ' LEFT JOIN "cost_center" AS "CLASSIFICACAO_CONTACC"' +
        ' ON "CLASSIFICACAO_CONTACC"."id"="CLASSIFICACAO"."contacc"' +
        ' LEFT JOIN "category" AS "CLASSIFICACAO_CONTAEV"' +
        ' ON "CLASSIFICACAO_CONTAEV"."id"="CLASSIFICACAO"."contaev"' +
        ' WHERE "CLASSIFICACAO"."numdoc"=t."id" AND (' +
        'lower(public.f_unaccent("CLASSIFICACAO"."historico")) LIKE $1' +
        ' OR lower(public.f_unaccent(' +
        '"CLASSIFICACAO_CONTACC"."description")) LIKE $2' +
        ' OR lower(public.f_unaccent(' +
        '"CLASSIFICACAO_CONTAEV"."description")) LIKE $3))'
    )
  })

  // the trap: buildQuery emits "NUMINT" AS "id", so the field does not
  // exist in the derived table the outer where is applied to
  it('should correlate by the primary key attribute, not the field', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    const predicate = predicateOf(view)
    expect(predicate).to.contain('=t."id"')
    expect(predicate).to.not.contain('NUMINT')
  })

  it('should use the view name as the correlation when it is not a view', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable, view: 'docpag'}
    )
    expect(predicateOf(view)).to.contain('="docpag"."id"')
  })

  it('should bind the value, never write it in the statement', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    expect(view.statement).to.not.contain('energia')
    expect(view.params).to.eql([
      '%energia%',
      '%energia%',
      '%energia%'
    ])
  })

  it('should not escape the like metacharacters', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: '100%_a'}}},
      {searchable: ['HISTORICO']}
    )
    expect(view.params).to.eql(['%100%_a%'])
  })

  it('should search a property with no field using its name', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'x'}}},
      {searchable: ['SEMCAMPO']}
    )
    expect(predicateOf(view)).to.contain(
      'lower(public.f_unaccent("CLASSIFICACAO"."SEMCAMPO")) LIKE $1'
    )
  })

  it('should accept a number as the search value', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 10}}},
      {searchable: ['HISTORICO']}
    )
    expect(view.params).to.eql(['%10%'])
  })

  // f_unaccent(integer) does not exist: with no cast the query dies
  // at run time on postgres while mssql matches happily
  it('should cast a non text column before folding it', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: '10'}}},
      {searchable: ['VALOR']}
    )
    expect(predicateOf(view)).to.contain(
      'lower(public.f_unaccent("CLASSIFICACAO"."valor"::text))' +
        ' LIKE $1'
    )
  })

  it('should not cast a text column', function () {
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'x'}}},
      {searchable: ['HISTORICO']}
    )
    expect(predicateOf(view)).to.not.contain('::')
  })

  it('should search inside an or', function () {
    const view = pg(
      {
        where: {
          or: [
            {DESCRICAO: 'x'},
            {CLASSIFICACAO: {search: 'energia'}}
          ]
        }
      },
      {searchable: ['HISTORICO']}
    )
    expect(view.statement).to.contain('"DESCRICAO"=$1')
    expect(view.statement).to.contain('EXISTS (SELECT 1 FROM')
    expect(view.params).to.eql(['x', '%energia%'])
  })

  // the strip is the one buildQuery already does: everything up to and
  // including the FIRST point
  it('should strip the table from the display', function () {
    const child = buildChild(['CONTACC'])
    child.properties.CONTACC.display = 'cost_center.description'
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'x'}}},
      {child: child}
    )
    expect(predicateOf(view)).to.contain(
      '"CLASSIFICACAO_CONTACC"."description"'
    )
    expect(predicateOf(view)).to.not.contain('cost_center."')
  })

  it('should keep a display with no point as it is', function () {
    const child = buildChild(['CONTACC'])
    child.properties.CONTACC.display = 'description'
    const view = pg(
      {where: {CLASSIFICACAO: {search: 'x'}}},
      {child: child}
    )
    expect(predicateOf(view)).to.contain(
      '"CLASSIFICACAO_CONTACC"."description"'
    )
  })

  describe('schema qualification', function () {
    // the pg pool is shared between tenants and there is no per
    // connection search_path: an unqualified table here reads another
    // tenant's rows
    it('should qualify the child and every lookup', function () {
      const view = pg(
        {where: {CLASSIFICACAO: {search: 'energia'}}},
        {
          searchable: defaultSearchable,
          options: {schema: 'userdb_x'}
        }
      )
      const predicate = predicateOf(view)
      const qualified = predicate.match(/userdb_x\."/g) || []
      expect(qualified.length).to.equal(3)
      expect(predicate).to.not.contain(' "docpagcc"')
      expect(predicate).to.not.contain(' "cost_center"')
      expect(predicate).to.not.contain(' "category"')
      expect(predicate).to.contain('FROM userdb_x."docpagcc"')
      expect(predicate).to.contain(
        'LEFT JOIN userdb_x."cost_center"'
      )
      expect(predicate).to.contain('LEFT JOIN userdb_x."category"')
    })

    it('should not qualify when no schema was given', function () {
      const view = pg(
        {where: {CLASSIFICACAO: {search: 'energia'}}},
        {searchable: defaultSearchable}
      )
      const predicate = predicateOf(view)
      expect(predicate).to.not.contain('userdb_x')
      expect(predicate).to.contain('FROM "docpagcc"')
      expect(predicate).to.contain('LEFT JOIN "cost_center"')
      expect(predicate).to.contain('LEFT JOIN "category"')
    })

    it('should refuse an invalid schema', function () {
      expect(function () {
        pg(
          {where: {CLASSIFICACAO: {search: 'energia'}}},
          {
            searchable: defaultSearchable,
            options: {schema: 'x" OR 1=1--'}
          }
        )
      }).to.throw('Invalid schema')
    })
  })
})

describe('association search (mssql)', function () {
  const ms = (criteria, config) => build('mssql', criteria, config)

  it('should emit the exists with its joins and like terms', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    expect(predicateOf(view)).to.equal(
      'EXISTS (SELECT 1 FROM [docpagcc] AS [CLASSIFICACAO]' +
        ' LEFT JOIN [cost_center] AS [CLASSIFICACAO_CONTACC]' +
        ' ON [CLASSIFICACAO_CONTACC].[id]=[CLASSIFICACAO].[contacc]' +
        ' LEFT JOIN [category] AS [CLASSIFICACAO_CONTAEV]' +
        ' ON [CLASSIFICACAO_CONTAEV].[id]=[CLASSIFICACAO].[contaev]' +
        ' WHERE [CLASSIFICACAO].[numdoc]=t.[id] AND (' +
        '[CLASSIFICACAO].[historico] LIKE $1' +
        ' OR [CLASSIFICACAO_CONTACC].[description] LIKE $2' +
        ' OR [CLASSIFICACAO_CONTAEV].[description] LIKE $3))'
    )
  })

  it('should correlate by the primary key attribute, not the field', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    const predicate = predicateOf(view)
    expect(predicate).to.contain('=t.[id]')
    expect(predicate).to.not.contain('NUMINT')
  })

  // a placeholder reused is fatal in mssql-cr-layer, so every like gets
  // its own parameter
  it('should use a distinct placeholder per like', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    const predicate = predicateOf(view)
    const likes = predicate.match(/ LIKE /g) || []
    const placeholders = predicate.match(/\$\d+/g) || []
    expect(likes.length).to.equal(3)
    expect(placeholders.length).to.equal(likes.length)
    expect(new Set(placeholders).size).to.equal(likes.length)
    expect(view.params.length).to.equal(likes.length)
  })

  it('should not fold the case or the accents', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    const predicate = predicateOf(view)
    expect(predicate).to.not.contain('lower(')
    expect(predicate).to.not.contain('f_unaccent')
  })

  // the counterpart of the postgres cast: the plain like takes the
  // implicit conversion of the database, so nothing is cast here
  it('should not cast a non text column', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: '10'}}},
      {searchable: ['VALOR']}
    )
    const predicate = predicateOf(view)
    expect(predicate).to.contain('[CLASSIFICACAO].[valor] LIKE $1')
    expect(predicate).to.not.contain('::')
  })

  it('should not qualify the tables with a schema', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {
        searchable: defaultSearchable,
        options: {schema: 'userdb_x'}
      }
    )
    const predicate = predicateOf(view)
    expect(predicate).to.not.contain('userdb_x')
    expect(predicate).to.contain('FROM [docpagcc]')
  })

  it('should bind the value, never write it in the statement', function () {
    const view = ms(
      {where: {CLASSIFICACAO: {search: 'energia'}}},
      {searchable: defaultSearchable}
    )
    expect(view.statement).to.not.contain('energia')
    expect(view.params).to.eql([
      '%energia%',
      '%energia%',
      '%energia%'
    ])
  })
})

const dialects = ['postgres', 'mssql']

describe('association search closure', function () {
  dialects.forEach(function (dialect) {
    describe(dialect, function () {
      const run = (criteria, config) =>
        build(dialect, criteria, config)

      it('should refuse an association with no searchable', function () {
        expect(function () {
          run({where: {CLASSIFICACAO: {search: 't'}}}, {})
        }).to.throw('Association is not searchable: CLASSIFICACAO')
      })

      it('should refuse an empty searchable', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: 't'}}},
            {searchable: []}
          )
        }).to.throw('Association is not searchable: CLASSIFICACAO')
      })

      it('should refuse a key that is not an association', function () {
        let message
        try {
          run(
            {where: {DESCRICAO: {search: 't'}}},
            {searchable: defaultSearchable}
          )
        } catch (error) {
          message = error.message
        }
        expect(message).to.equal(
          'Invalid search association: DESCRICAO'
        )
        expect(message).to.not.contain('SELECT')
      })

      it('should refuse a hostile key', function () {
        const key = 'CLASSIFICACAO" OR 1=1--'
        let view
        let message
        try {
          view = run(
            {where: {[key]: {search: 't'}}},
            {searchable: defaultSearchable}
          )
        } catch (error) {
          message = error.message
        }
        expect(view).to.equal(void 0)
        expect(message).to.equal(
          'Invalid search association: ' + key
        )
        expect(message).to.not.contain('EXISTS')
      })

      it('should refuse a searchable property that does not exist', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: 't'}}},
            {searchable: ['NAOEXISTE']}
          )
        }).to.throw('Invalid searchable property NAOEXISTE')
      })

      it('should refuse an object as the search value', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: {a: 1}}}},
            {searchable: defaultSearchable}
          )
        }).to.throw('Invalid search value for: CLASSIFICACAO')
      })

      it('should refuse an array as the search value', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: ['a']}}},
            {searchable: defaultSearchable}
          )
        }).to.throw('Invalid search value for: CLASSIFICACAO')
      })

      // LIKE '%%' is not a match all: it still demands a child row
      // with a non null searchable column, so a cleared search box
      // would silently return only the parents that have children
      it('should refuse an empty search value', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: ''}}},
            {searchable: defaultSearchable}
          )
        }).to.throw('Invalid search value for: CLASSIFICACAO')
      })

      it('should refuse a blank search value', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: '   '}}},
            {searchable: defaultSearchable}
          )
        }).to.throw('Invalid search value for: CLASSIFICACAO')
      })

      // only the first attribute is correlated, so the exists would
      // be under constrained and match parents it should not
      it('should refuse a composite primary key', function () {
        expect(function () {
          run(
            {where: {CLASSIFICACAO: {search: 'energia'}}},
            {
              searchable: defaultSearchable,
              primaryKeyAttributes: ['id', 'ano']
            }
          )
        }).to.throw(
          'Search needs a single column primary key: CLASSIFICACAO'
        )
      })

      // the parent key is what tells the comparator from a column: a
      // table with a column named search must keep working, and the
      // resolver must not even be reached
      it('should read a top level search as a column', function () {
        const view = run(
          {where: {search: 'abc'}},
          {searchable: defaultSearchable}
        )
        expect(view.statement).to.contain(
          dialect === 'postgres' ? '"search"=$1' : '[search]=$1'
        )
        expect(view.statement).to.not.contain('EXISTS')
        expect(view.params).to.eql(['abc'])
      })

      it('should still refuse any other unknown comparator', function () {
        expect(function () {
          run({where: {a: {bogus: 1}}}, {searchable: ['HISTORICO']})
        }).to.throw('Unknown comparator: bogus')
      })

      // sql-view stays usable standalone: with no resolver the search
      // comparator is just one more unknown comparator
      it('should refuse search with no context', function () {
        expect(function () {
          sqlView(dialect).build(VIEW, {
            where: {CLASSIFICACAO: {search: 't'}}
          })
        }).to.throw('Unknown comparator: search')
      })

      it('should refuse search with a context with no resolver', function () {
        expect(function () {
          sqlView(dialect).build(
            VIEW,
            {where: {CLASSIFICACAO: {search: 't'}}},
            {}
          )
        }).to.throw('Unknown comparator: search')
      })
    })
  })
})

describe('searchable declaration', function () {
  // fresh schemas per entity: the definition mutates what it is given
  const parentSchema = () => ({
    properties: {
      id: {type: 'integer', primaryKey: true, field: 'NUMINT'},
      DESCRICAO: {type: 'string', maxLength: 30}
    }
  })
  const childSchema = () => ({
    properties: {
      id: {type: 'integer', primaryKey: true},
      NUMDOC: {type: 'integer'},
      HISTORICO: {type: 'string', maxLength: 30},
      CONTACC: {type: 'string', maxLength: 30}
    }
  })

  function buildEntity(options) {
    const def = entity('docpag', parentSchema(), {
      dialect: 'postgres'
    })
    def
      .hasMany('docpagcc as CLASSIFICACAO', childSchema(), options)
      .foreignKey('NUMDOC')
    return def
  }

  it('should accept an array', function () {
    const schema = buildEntity({
      searchable: ['HISTORICO', 'CONTACC']
    }).schema.get()
    expect(schema.properties.CLASSIFICACAO.type).to.equal('array')
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO',
      'CONTACC'
    ])
  })

  it('should accept a comma separated string', function () {
    const schema = buildEntity({
      searchable: 'HISTORICO,CONTACC'
    }).schema.get()
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO',
      'CONTACC'
    ])
  })

  it('should emit a copy, not the declared array', function () {
    const searchable = ['HISTORICO']
    const schema = buildEntity({searchable: searchable}).schema.get()
    expect(schema.properties.CLASSIFICACAO.searchable).to.not.equal(
      searchable
    )
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO'
    ])
  })

  // habilis keys on the presence of the key, so it must be absent when
  // the association did not declare it
  it('should not emit the key when not declared', function () {
    const schema = buildEntity().schema.get()
    expect(schema.properties.CLASSIFICACAO).to.not.have.property(
      'searchable'
    )
  })

  it('should refuse an unknown property', function () {
    expect(function () {
      buildEntity({searchable: ['HISTORICO', 'NAOEXISTE']})
    }).to.throw(
      'Invalid searchable property NAOEXISTE in association ' +
        'CLASSIFICACAO'
    )
  })

  // keeping the caller's array would bypass the validation above:
  // a name pushed after the declaration reaches the adapter and
  // only throws when a query is built
  it('should not keep the declared array', function () {
    const searchable = ['HISTORICO']
    const def = buildEntity({searchable: searchable})
    searchable.push('NAOEXISTE')
    expect(
      def.schema.get().properties.CLASSIFICACAO.searchable
    ).to.eql(['HISTORICO'])
  })

  it('should trim a comma separated string', function () {
    const schema = buildEntity({
      searchable: 'HISTORICO, CONTACC'
    }).schema.get()
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO',
      'CONTACC'
    ])
  })

  it('should trim an array', function () {
    const schema = buildEntity({
      searchable: [' HISTORICO ', 'CONTACC']
    }).schema.get()
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO',
      'CONTACC'
    ])
  })

  // twice the same name is twice the same like term and twice the
  // same parameter
  it('should emit each name once', function () {
    const schema = buildEntity({
      searchable: ['HISTORICO', 'HISTORICO', 'CONTACC']
    }).schema.get()
    expect(schema.properties.CLASSIFICACAO.searchable).to.eql([
      'HISTORICO',
      'CONTACC'
    ])
  })

  // the presence of the key is the search affordance: an empty one
  // offers a search that throws on every query
  it('should refuse an empty array', function () {
    expect(function () {
      buildEntity({searchable: []})
    }).to.throw('Empty searchable in association CLASSIFICACAO')
  })

  it('should refuse an empty string', function () {
    expect(function () {
      buildEntity({searchable: ''})
    }).to.throw('Empty searchable in association CLASSIFICACAO')
  })
})

// A table with no explicit alias answers to its own name, and that
// implicit alias shadows an outer one of the same name: the
// correlation then compares a row with itself, matches nothing and
// reports no error at all. jse's fetchExternalDescription subselect is
// written that way and under matches on a self referencing $ref - that
// bug is NOT fixed here, but the predicate this spec covers must be
// structurally immune to it, and that immunity is pinned below instead
// of being trusted to a reading of the code
describe('association search alias isolation', function () {
  dialects.forEach(function (dialect) {
    describe(dialect, function () {
      const predicate = () =>
        predicateOf(
          build(
            dialect,
            {where: {parcels: {search: 'energia'}}},
            {child: selfRefChild()}
          )
        )

      it('should emit the three appearances of the table apart', function () {
        expect(predicate()).to.equal(
          dialect === 'postgres'
            ? 'EXISTS (SELECT 1 FROM "docpag" AS "parcels"' +
                ' LEFT JOIN "docpag" AS "parcels_NUMDOCORI"' +
                ' ON "parcels_NUMDOCORI"."id"="parcels"."numdocori"' +
                ' WHERE "parcels"."numdocori"=t."id" AND (' +
                'lower(public.f_unaccent("parcels"."historico"))' +
                ' LIKE $1 OR lower(public.f_unaccent(' +
                '"parcels_NUMDOCORI"."historico")) LIKE $2))'
            : 'EXISTS (SELECT 1 FROM [docpag] AS [parcels]' +
                ' LEFT JOIN [docpag] AS [parcels_NUMDOCORI]' +
                ' ON [parcels_NUMDOCORI].[id]=[parcels].[numdocori]' +
                ' WHERE [parcels].[numdocori]=t.[id] AND (' +
                '[parcels].[historico] LIKE $1' +
                ' OR [parcels_NUMDOCORI].[historico] LIKE $2))'
        )
      })

      it('should alias every table it introduces', function () {
        const references = tableReferencesOf(predicate())
        expect(references.length).to.equal(2)
        const aliased = references.filter(
          reference => reference.alias !== void 0
        )
        expect(aliased.length).to.equal(references.length)
      })

      it('should give every table a distinct alias', function () {
        const aliases = tableReferencesOf(predicate()).map(
          reference => reference.alias
        )
        expect(aliases.length).to.equal(2)
        expect(new Set(aliases).size).to.equal(aliases.length)
        // and none of them can collide with the outer correlation
        expect(aliases.indexOf('t')).to.equal(-1)
      })

      it('should qualify every column in the exists body', function () {
        const body = existsBodyOf(predicate())
        const identifiers = identifiersOf(dialect, body)
        expect(identifiers.length).to.equal(7)
        identifiers.forEach(function (identifier) {
          let at = body.indexOf(identifier)
          while (at > -1) {
            const before = body.charAt(at - 1)
            const after = body.charAt(at + identifier.length)
            expect(
              before === '.' || after === '.',
              identifier + ' is not qualified'
            ).to.equal(true)
            at = body.indexOf(identifier, at + 1)
          }
        })
      })

      // the derived table t has a COLUMN named as the association - the
      // json blob of the children - while the exists aliases a TABLE
      // with that name. Different namespaces, so it is legal, but every
      // reference here must be a qualified column, never the bare alias
      it('should never write the child alias on its own', function () {
        const text = predicateOf(
          build(
            dialect,
            {where: {CLASSIFICACAO: {search: 'energia'}}},
            {searchable: defaultSearchable}
          )
        )
        const childAlias =
          dialect === 'postgres'
            ? '"CLASSIFICACAO"'
            : '[CLASSIFICACAO]'
        let at = text.indexOf(childAlias)
        let qualified = 0
        let declared = 0
        while (at > -1) {
          if (text.charAt(at + childAlias.length) === '.') {
            qualified++
          } else {
            expect(text.slice(at - 4, at)).to.equal(' AS ')
            declared++
          }
          at = text.indexOf(childAlias, at + 1)
        }
        expect(declared).to.equal(1)
        expect(qualified).to.equal(4)
      })
    })
  })
})
