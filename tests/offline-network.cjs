/* eslint-disable @typescript-eslint/no-require-imports */
// Loaded only by the explicitly offline validation build, including workers.
// External networking fails before credentials or a request can leave the host.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = typeof options === 'object' ? options?.host : args[1];
  if (host && !['localhost','127.0.0.1','::1'].includes(host)) throw new Error('External network forbidden during offline build');
  return connect.apply(this,args);
};
globalThis.fetch = async () => { throw new Error('External fetch forbidden during offline build'); };
