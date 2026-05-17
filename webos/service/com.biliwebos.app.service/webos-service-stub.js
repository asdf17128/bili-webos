function WebOSServiceStub(name) {
  this.name = name;
  this.handlers = {};
  this.activityManager = {
    create: function (_id, cb) {
      if (cb) cb({});
    },
  };
  WebOSServiceStub.__instances.push(this);
}

WebOSServiceStub.__instances = [];

WebOSServiceStub.prototype.register = function (name, handler) {
  this.handlers[name] = handler;
};

module.exports = WebOSServiceStub;
