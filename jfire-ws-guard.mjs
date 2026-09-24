import WebSocket from 'ws';

// Alpaca Basic accounts allow only one active market-data WebSocket connection.
// When another client already owns it, Alpaca sends error 406. The scanner's
// normal close handler would otherwise reconnect every 5 seconds forever.
// This preload marks sockets that received 406 and suppresses that reconnect.
const limitedSockets = new WeakSet();
const originalOn = WebSocket.prototype.on;
const guardInstalled = Symbol.for('jfire.alpaca.guardInstalled');

if (!WebSocket.prototype[guardInstalled]) {
  Object.defineProperty(WebSocket.prototype, guardInstalled, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  WebSocket.prototype.on = function on(event, listener) {
    if (event === 'message') {
      const wrappedMessage = function wrappedMessage(data, ...args) {
        try {
          const text = Buffer.isBuffer(data) ? data.toString() : String(data);
          if (text.includes('"code":406') || text.includes('"code": 406')) {
            limitedSockets.add(this);
            console.warn('[JFIRE WS GUARD] Alpaca 406 connection limit received; reconnect disabled for this socket.');
          }
        } catch {}
        return listener.call(this, data, ...args);
      };
      return originalOn.call(this, event, wrappedMessage);
    }

    if (event === 'close') {
      const wrappedClose = function wrappedClose(code, reason, ...args) {
        if (limitedSockets.has(this)) {
          console.warn(`[JFIRE WS GUARD] Suppressed automatic reconnect after Alpaca 406 (${code}).`);
          return this;
        }
        return listener.call(this, code, reason, ...args);
      };
      return originalOn.call(this, event, wrappedClose);
    }

    return originalOn.call(this, event, listener);
  };
}
