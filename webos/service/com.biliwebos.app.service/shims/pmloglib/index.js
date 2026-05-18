class ConsoleShim {
  constructor(scope) {
    this.scope = scope || 'pmlog';
  }

  format(args) {
    return [`[${this.scope}]`, ...args];
  }

  log(...args) {
    console.log(...this.format(args));
  }

  info(...args) {
    console.info(...this.format(args));
  }

  warn(...args) {
    console.warn(...this.format(args));
  }

  error(...args) {
    console.error(...this.format(args));
  }
}

module.exports = {
  Console: ConsoleShim,
};
