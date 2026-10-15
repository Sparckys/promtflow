const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pf', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => {
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  platform: process.platform,
});
