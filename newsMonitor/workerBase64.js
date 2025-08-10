const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');
const logger = require('../utils/logger');

// Simple worker pool for base64 encoding to avoid blocking the event loop
class Base64WorkerPool {
    constructor(workerFilePath, poolSize = 2) {
        this.workerFilePath = workerFilePath;
        this.poolSize = Math.max(1, poolSize);
        this.workers = [];
        this.idleWorkers = [];
        this.taskQueue = [];
        this._initialize();
    }

    _initialize() {
        for (let i = 0; i < this.poolSize; i++) {
            this._spawnWorker();
        }
    }

    _spawnWorker() {
        const worker = new Worker(this.workerFilePath);
        worker.on('message', message => {
            const { result, error } = message || {};
            const currentTask = worker.__currentTask;
            worker.__currentTask = null;
            if (error) {
                currentTask?.reject(new Error(error));
            } else {
                currentTask?.resolve(result);
            }
            this.idleWorkers.push(worker);
            this._drainQueue();
        });
        worker.on('error', err => {
            logger.error(`WorkerBase64: Worker error: ${err.message}`);
            const currentTask = worker.__currentTask;
            worker.__currentTask = null;
            if (currentTask) currentTask.reject(err);
            // Remove the failed worker and spawn a new one to keep pool size
            this._removeWorker(worker);
            this._spawnWorker();
            this._drainQueue();
        });
        worker.on('exit', code => {
            if (code !== 0) {
                logger.warn(`WorkerBase64: Worker exited with code ${code}`);
            }
            this._removeWorker(worker);
            // Keep pool size
            if (this.workers.length < this.poolSize) {
                this._spawnWorker();
            }
        });
        this.workers.push(worker);
        this.idleWorkers.push(worker);
    }

    _removeWorker(worker) {
        this.workers = this.workers.filter(w => w !== worker);
        this.idleWorkers = this.idleWorkers.filter(w => w !== worker);
    }

    _drainQueue() {
        while (this.idleWorkers.length > 0 && this.taskQueue.length > 0) {
            const worker = this.idleWorkers.shift();
            const task = this.taskQueue.shift();
            worker.__currentTask = task;
            // Transfer the underlying buffer to avoid an extra copy
            const { arrayBuffer, byteOffset, byteLength } = task;
            try {
                worker.postMessage({ arrayBuffer, byteOffset, byteLength }, [arrayBuffer]);
            } catch (e) {
                // If transfer fails, fallback without transfer list
                worker.postMessage({ arrayBuffer, byteOffset, byteLength });
            }
        }
    }

    encode(u8Array) {
        return new Promise((resolve, reject) => {
            const arrayBuffer = u8Array.buffer.slice(0); // Ensure we pass a standalone buffer
            const task = {
                resolve,
                reject,
                arrayBuffer,
                byteOffset: 0,
                byteLength: u8Array.byteLength,
            };
            this.taskQueue.push(task);
            this._drainQueue();
        });
    }
}

// Initialize pool sized to available cores but capped at 2 for a 2-core VPS
const defaultPoolSize = Math.min(2, Math.max(1, os.cpus()?.length || 1));
const workerFile = path.join(__dirname, 'workers', 'base64Encoder.js');
const pool = new Base64WorkerPool(workerFile, defaultPoolSize);

/**
 * Encodes a Buffer (or Uint8Array) to base64 using a worker thread.
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<string>} Base64 string
 */
async function encodeBufferToBase64(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return pool.encode(u8);
}

module.exports = { encodeBufferToBase64 };


