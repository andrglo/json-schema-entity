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
}
EntityError.prototype = Object.create(Error.prototype)
EntityError.prototype.constructor = EntityError
