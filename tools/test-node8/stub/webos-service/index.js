function Service(name) {
  this.name = name; this.methods = {};
  this.activityManager = { create: function () { } };
  module.exports.last = this;
}
Service.prototype.register = function (m, cb) { this.methods[m] = cb; };
module.exports = Service;
