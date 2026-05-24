const globals = require('globals')

module.exports = [
  {
    ignores: ['node_modules/', '.history/', 'coverage/']
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.mocha
      }
    },
    rules: {
      indent: 0,
      'space-before-function-paren': [2, {
        anonymous: 'always',
        named: 'never'
      }],
      'generator-star-spacing': ['error', {before: true, after: false}],
      'comma-dangle': 0,
      semi: ['error', 'never'],
      'require-jsdoc': 0,
      'quote-props': 0,
      'no-extra-parens': 0,
      'arrow-parens': ['error', 'as-needed'],
      'yield-star-spacing': ['error', {before: true, after: false}],
      'max-len': ['error', {
        code: 120,
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true
      }],
      'no-var': 0,
      camelcase: 0,
      'no-invalid-this': 0,
      'no-undef': 2,
      'no-unreachable': 2
    }
  }
]
