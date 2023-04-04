module.exports = {
  parserOptions: {
    ecmaVersion: 11
  },
  env: {
    node: true,
    es6: true,
    mocha: true
  },
  rules: {
    indent: 0,
    'space-before-function-paren': [
      2,
      {
        anonymous: 'always', // due to prettier lack of support for 'never'
        named: 'never'
      }
    ],
    'generator-star-spacing': [
      'error',
      {
        before: true,
        after: false
      }
    ],
    'comma-dangle': 0,
    semi: ['error', 'never'],
    'require-jsdoc': 0,
    'quote-props': 0,
    'no-extra-parens': 0,
    'arrow-parens': ['error', 'as-needed'],
    'yield-star-spacing': ['error', {before: true, after: false}],
    'max-len': [
      'error',
      {
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true
      }
    ],
    'no-var': 0,
    camelcase: 0,
    'no-invalid-this': 0,
    'no-undef': 2,
    'no-unreachable': 2
  }
}
