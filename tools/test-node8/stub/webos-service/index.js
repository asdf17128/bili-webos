function Service(name) {
  this.name = name; this.methods = {}; this.cancels = {};
  this.activityManager = { create: function () { } };
  module.exports.last = this;
}
Service.prototype.register = function (m, cb, cancel) { this.methods[m] = cb; this.cancels[m] = cancel; };
module.exports = Service;
