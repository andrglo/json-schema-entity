module.exports = EntityError

function EntityError(options) {
  options = options || {}
  this.name = options.name || 'EntityError'
  this.message = options.message || 'Entity error'
  if (options.errors) {
    this.errors = options.errors
  }
  if (options.type) {
    this.type = options.type
  }
  if (options.err) {
    this.originalError = options.err
  }
}
EntityError.prototype = Object.create(Error.prototype)
EntityError.prototype.constructor = EntityError
