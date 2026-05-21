export default class WebOSServiceStub {
  static __instances = [];

  name;
  handlers;
  activityManager;

  constructor(name) {
    this.name = name;
    this.handlers = {};
    this.activityManager = {
      create(_id, cb) {
        if (cb) cb({});
      },
    };
    WebOSServiceStub.__instances.push(this);
  }

  register(name, handler) {
    this.handlers[name] = handler;
  }
}
