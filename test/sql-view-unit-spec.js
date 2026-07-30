// Pure unit spec for src/sql-view: no database needed, asserts on the
// generated statement string. Run standalone with:
//   npx mocha test/sql-view-unit-spec.js --exit
const sqlView = require('../src/sql-view')

let expect
before(function() {
  return import('chai').then(chai => {
    expect = chai.expect
  })
})

function statement(dialect, view, criteria) {
  return sqlView(dialect).build(view, criteria).statement
}

describe('sql-view identifier escaping (postgres)', function() {
  const pg = (view, criteria) => statement('postgres', view, criteria)

  describe('break out of a quoted identifier', function() {
    it('should escape a double quote in a where key', function() {
      const key = 'datname as x" FROM pg_database--'
      const result = pg('t', {where: {[key]: 1}})
      expect(result).to.contain(
        '"datname as x"" FROM pg_database--"'
      )
      expect(result).to.not.contain(
        '"datname as x" FROM pg_database--"'
      )
    })
    it('should escape a double quote in a comparator parent key', function() {
      const result = pg('t', {where: {'ev"il': {gt: 1}}})
      expect(result).to.contain('"ev""il">$1')
      expect(result).to.not.contain('"ev"il"')
    })
    it('should escape a double quote in a select key', function() {
      const result = pg('t', {select: 'ev"il'})
      expect(result).to.equal(
        'SELECT "ev""il" AS "ev""il" FROM "t"'
      )
    })
    it('should escape a double quote in both sides of an alias', function() {
      const result = pg('t', {
        select: 'ev"il as al"ias'
      })
      expect(result).to.equal(
        'SELECT "ev""il" AS "al""ias" FROM "t"'
      )
    })
    it('should escape a double quote in an alias used to break out', function() {
      const result = pg('t', {
        select: 'datname as x" FROM pg_database--'
      })
      expect(result).to.contain(
        'AS "x"" FROM pg_database--"'
      )
      expect(result).to.not.contain(
        'AS "x" FROM pg_database--"'
      )
    })
    it('should escape a double quote in a group by key', function() {
      const result = pg('t', {groupBy: 'ev"il'})
      expect(result).to.equal(
        'SELECT "ev""il" AS "ev""il" FROM "t" GROUP BY "ev""il"'
      )
    })
    it('should escape a double quote in an order column', function() {
      const result = pg('t', {order: 'ev"il desc'})
      expect(result).to.contain('ORDER BY "ev""il" DESC')
      expect(result).to.not.contain('"ev"il"')
    })
    it('should escape a double quote in the table name', function() {
      const result = pg('ev"il', {})
      expect(result).to.equal('SELECT * FROM "ev""il"')
    })
  })

  describe('break out of the cast option', function() {
    it('should reject a cast type carrying sql in a select', function() {
      expect(function() {
        pg('t', {select: 'datname:as text FROM pg_database--'})
      }).to.throw(/Invalid cast type/)
    })
    it('should reject a cast type carrying sql in a where key', function() {
      expect(function() {
        pg('t', {where: {'datname:as text FROM pg_database--': 1}})
      }).to.throw(/Invalid cast type/)
    })
    it('should reject a cast type carrying a quote', function() {
      expect(function() {
        pg('t', {select: 'datname:as text"'})
      }).to.throw(/Invalid cast type/)
    })
  })

  describe('options round trip', function() {
    it('should keep a plain identifier unchanged', function() {
      expect(pg('person', {where: {name: 'a'}})).to.equal(
        'SELECT * FROM "person" WHERE "name"=$1'
      )
    })
    it('should cast with asText', function() {
      expect(pg('t', {where: {'id:asText': 'a'}})).to.contain(
        '"id"::text=$1'
      )
    })
    it('should unaccent with ai', function() {
      expect(pg('t', {where: {'NOME:ai': 'a'}})).to.contain(
        'public.f_unaccent("NOME")=$1'
      )
    })
    it('should lower case with ci', function() {
      expect(pg('t', {where: {'NOME:ci': 'a'}})).to.contain(
        'lower("NOME")=$1'
      )
    })
    it('should build NOMECAD:ci:ai', function() {
      expect(pg('t', {where: {'NOMECAD:ci:ai': 'a'}})).to.contain(
        'lower(public.f_unaccent("NOMECAD"))=$1'
      )
    })
    it('should build id:asText:ci:ai', function() {
      expect(pg('t', {where: {'id:asText:ci:ai': 'a'}})).to.contain(
        'lower(public.f_unaccent("id"::text))=$1'
      )
    })
    it('should build IDENT:ai:ci', function() {
      expect(pg('t', {where: {'IDENT:ai:ci': 'a'}})).to.contain(
        'lower(public.f_unaccent("IDENT"))=$1'
      )
    })
    it('should build CLASSIFICACAO:asText:ci:ai', function() {
      expect(
        pg('t', {where: {'CLASSIFICACAO:asText:ci:ai': 'a'}})
      ).to.contain(
        'lower(public.f_unaccent("CLASSIFICACAO"::text))=$1'
      )
    })
  })

  describe('clauses round trip', function() {
    it('should order descending', function() {
      expect(pg('t', {order: 'createdAt desc'})).to.equal(
        'SELECT * FROM "t" ORDER BY "createdAt" DESC'
      )
    })
    it('should order ascending', function() {
      expect(pg('t', {order: 'X asc'})).to.equal(
        'SELECT * FROM "t" ORDER BY "X" ASC'
      )
    })
    it('should alias a group by column', function() {
      expect(pg('t', {groupBy: 'ENDERECO as V'})).to.equal(
        'SELECT "ENDERECO" AS "V" FROM "t" GROUP BY "ENDERECO"'
      )
    })
    it('should alias a sum column', function() {
      expect(pg('t', {sum: 'VALORLCTO as sumV'})).to.equal(
        'SELECT SUM("VALORLCTO") AS "sumV" FROM "t"'
      )
    })
    it('should keep a subquery view untouched', function() {
      expect(
        pg('SELECT * FROM person', {where: {name: 'a'}})
      ).to.equal(
        'SELECT * FROM (SELECT * FROM person) t WHERE "name"=$1'
      )
    })
  })
})

describe('sql-view identifier escaping (mssql)', function() {
  const ms = (view, criteria) => statement('mssql', view, criteria)

  describe('break out of a bracketed identifier', function() {
    it('should escape a bracket in a where key', function() {
      const key = 'x] FROM sys.databases--'
      const result = ms('t', {where: {[key]: 1}})
      expect(result).to.contain('[x]] FROM sys.databases--]')
      expect(result).to.not.contain('[x] FROM sys.databases--]')
    })
    it('should escape a bracket in a comparator parent key', function() {
      const result = ms('t', {where: {'a]b': {gt: 1}}})
      expect(result).to.contain('[a]]b]>$1')
      expect(result).to.not.contain('[a]b]')
    })
    it('should escape a bracket in a select key', function() {
      expect(ms('t', {select: 'a]b'})).to.equal(
        'SELECT [a]]b] AS [a]]b] FROM [t]'
      )
    })
    it('should escape a bracket in both sides of an alias', function() {
      expect(ms('t', {select: 'a]b as c]d'})).to.equal(
        'SELECT [a]]b] AS [c]]d] FROM [t]'
      )
    })
    it('should escape a bracket in a group by key', function() {
      expect(ms('t', {groupBy: 'a]b'})).to.equal(
        'SELECT [a]]b] AS [a]]b] FROM [t] GROUP BY [a]]b]'
      )
    })
    it('should escape a bracket in an order column', function() {
      const result = ms('t', {order: 'a]b desc'})
      expect(result).to.contain('ORDER BY [a]]b] DESC')
      expect(result).to.not.contain('[a]b]')
    })
    it('should escape a bracket in the table name', function() {
      expect(ms('a]b', {})).to.equal('SELECT * FROM [a]]b]')
    })
  })

  describe('round trip', function() {
    it('should keep a plain identifier unchanged', function() {
      expect(ms('person', {where: {name: 'a'}})).to.equal(
        'SELECT * FROM [person] WHERE [name]=$1'
      )
    })
    it('should ignore the options', function() {
      expect(ms('t', {where: {'NOMECAD:ci:ai': 'a'}})).to.equal(
        'SELECT * FROM [t] WHERE [NOMECAD]=$1'
      )
      expect(ms('t', {where: {'id:asText:ci:ai': 'a'}})).to.equal(
        'SELECT * FROM [t] WHERE [id]=$1'
      )
    })
    it('should ignore a cast option carrying sql', function() {
      expect(
        ms('t', {select: 'datname:as text FROM pg_database--'})
      ).to.equal('SELECT [datname] AS [datname] FROM [t]')
    })
    it('should order descending', function() {
      expect(ms('t', {order: 'createdAt desc'})).to.equal(
        'SELECT * FROM [t] ORDER BY [createdAt] DESC'
      )
    })
    it('should alias a sum column', function() {
      expect(ms('t', {sum: 'VALORLCTO as sumV'})).to.equal(
        'SELECT SUM([VALORLCTO]) AS [sumV] FROM [t]'
      )
    })
  })
})
