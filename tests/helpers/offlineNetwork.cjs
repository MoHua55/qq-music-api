const net = require('node:net');

// Contract checks may reach their local HTTP host, but never a real upstream endpoint.
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host =
    typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !allowed.has(host))
    throw new Error('External connection blocked during offline verification');
  return originalConnect.apply(this, args);
};

const originalFetch = global.fetch;
global.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!allowed.has(url.hostname))
    return Promise.reject(new Error('External fetch blocked during offline verification'));
  return originalFetch(input, init);
};
