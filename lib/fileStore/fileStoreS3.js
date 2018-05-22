const ERR = require('async-stacktrace');
const AWS = require('aws-sdk');
const S3StreamLogger = require('s3-streamlogger').S3StreamLogger;

class S3FileStore {
    constructor(job) {
        this.bucket = job.s3Bucket;
        this.rootKey = job.s3RootKey;
        this.s3 = new AWS.S3();
    }

    getName() {
        return `([S3] ${this.bucket}/${this.rootKey})`;
    }

    getFile(name, writeStream, callback) {
        const params = {
            Bucket: this.bucket,
            Key: `${this.rootKey}/${name}`
        };
        const stream = this.s3.getObject(params).createReadStream().pipe(writeStream);
        stream.on('error', (e) => callback(e));
        stream.on('finish', () => callback(null));
    }

    putFileReadStream(name, readStream, callback) {
        const params = {
            Bucket: this.bucket,
            Key: `${this.rootKey}/${name}`,
            Body: readStream,
        };
        this.s3.upload(params, (err) => {
            if (ERR(err, callback)) return;
            callback(null);
        });
    }

    putFileBuffer(name, buffer, callback) {
        const params = {
            Bucket: this.bucket,
            Key: `${this.rootKey}/${name}`,
            Body: buffer,
        };
        this.s3.upload(params, (err) => {
            if (ERR(err, callback)) return;
            callback(null);
        });
    }

    createLogStream() {
        return new S3StreamLogger({
            bucket: this.bucket,
            folder: this.rootKey,
            name_format: 'output.log', // No need to rotate, all logs go to same file
            upload_every: 1000 // Most jobs are short-lived, so push every 1s
        });
    }
}

module.exports = S3FileStore;
