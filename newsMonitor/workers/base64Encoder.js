const { parentPort } = require('worker_threads');

// Worker: receives an ArrayBuffer + metadata, returns base64 string
parentPort.on('message', (msg) => {
    try {
        const { arrayBuffer, byteOffset = 0, byteLength } = msg || {};
        if (!arrayBuffer || typeof byteLength !== 'number') {
            parentPort.postMessage({ error: 'Invalid payload for base64 encoding' });
            return;
        }
        const view = new Uint8Array(arrayBuffer, byteOffset, byteLength);
        // Node's Buffer can wrap the underlying ArrayBuffer without copy
        const b64 = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
        parentPort.postMessage({ result: b64 });
    } catch (e) {
        parentPort.postMessage({ error: e.message || String(e) });
    }
});


