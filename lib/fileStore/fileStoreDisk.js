const path = require('path');
const fs = require('fs-extra');

const { config } = require('../config');

class DiskFileStore {
    constructor(job) {
        this.basePath = path.join(config.fileStorePath, `job_${job.jobId}`);
    }

    getName() {
        return `([disk] ${this.basePath})`;
    }

    getFile(name, writeStream, callback) {
        const stream = fs.createReadStream(this.getFilePath(name)).pipe(writeStream);
        stream.on('error', (e) => callback(e));
        stream.on('finish', () => callback(null));
    }

    putFileReadStream(name, readStream, callback) {
        const stream = fs.createWriteStream(this.getFilePath(name));
        readStream.pipe(stream);
        stream.on('finish', () => callback(null));
        stream.on('error', (e) => callback(e));
    }

    putFileBuffer(name, buffer, callback) {
        fs.writeFile(this.getFilePath(name), buffer, callback);
    }

    createLogStream() {
        return fs.createWriteStream(this.getFilePath('output.log'));
    }

    getFilePath(name) {
        return path.join(this.basePath, name);
    }
}

module.exports = DiskFileStore;
