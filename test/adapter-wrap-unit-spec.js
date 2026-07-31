'use strict'

/* eslint no-undef:0 */

// Pure unit spec for the adapters' identifier quoting: no database needed,
// asserts on the wrap output. Run standalone with:
//   npx mocha test/adapter-wrap-unit-spec.js --exit
const postgresAdapter = require('../src/adapters/postgres')
const mssqlAdapter = require('../src/adapters/mssql')

let expect
before(function () {
  return import('chai').then(chai => {
    expect = chai.expect
  })
})

// Same escape sql-view got in 7.2.6: the closing delimiter is doubled -
// the standard SQL escape - so any character is safe inside a wrapped
// identifier and a caller controlled field name cannot end the identifier
// early and continue as SQL
describe('adapter identifier escaping (postgres)', function () {
  const wrap = postgresAdapter().wrap

  it('should keep a plain identifier unchanged', function () {
    expect(wrap('person')).to.equal('"person"')
  })
  it('should keep an accented identifier unchanged', function () {
    expect(wrap('Classificação')).to.equal('"Classificação"')
  })
  it('should escape a double quote', function () {
    expect(wrap('we"ird')).to.equal('"we""ird"')
  })
  it('should escape every double quote', function () {
    expect(wrap('a"b"c')).to.equal('"a""b""c"')
  })
  it('should escape a leading and a trailing double quote', function () {
    expect(wrap('"x"')).to.equal('"""x"""')
  })
  it('should not break out of the identifier', function () {
    const result = wrap('id" IS NOT NULL OR 1=1 OR "id')
    expect(result).to.equal(
      '"id"" IS NOT NULL OR 1=1 OR ""id"'
    )
    expect(result).to.not.contain('"id" IS NOT NULL')
    // no lone quote is left inside the identifier body
    expect(result.slice(1, -1).replace(/""/g, '')).to.not.contain(
      '"'
    )
  })
  it('should not escape the mssql delimiter', function () {
    expect(wrap('a]b')).to.equal('"a]b"')
  })
})

describe('adapter identifier escaping (mssql)', function () {
  const wrap = mssqlAdapter().wrap

  it('should keep a plain identifier unchanged', function () {
    expect(wrap('person')).to.equal('[person]')
  })
  it('should keep an accented identifier unchanged', function () {
    expect(wrap('Classificação')).to.equal('[Classificação]')
  })
  it('should escape a closing bracket', function () {
    expect(wrap('we]ird')).to.equal('[we]]ird]')
  })
  it('should escape every closing bracket', function () {
    expect(wrap('a]b]c')).to.equal('[a]]b]]c]')
  })
  it('should escape a trailing closing bracket', function () {
    expect(wrap('x]')).to.equal('[x]]]')
  })
  it('should not break out of the identifier', function () {
    const result = wrap('id] IS NOT NULL OR 1=1 OR [id')
    expect(result).to.equal(
      '[id]] IS NOT NULL OR 1=1 OR [id]'
    )
    expect(result).to.not.contain('[id] IS NOT NULL')
    // no lone closing bracket is left inside the identifier body
    expect(result.slice(1, -1).replace(/]]/g, '')).to.not.contain(
      ']'
    )
  })
  it('should not escape the postgres delimiter', function () {
    expect(wrap('we"ird')).to.equal('[we"ird]')
  })
})
