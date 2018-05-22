const { config } = require('../config');
const S3FileStore = require('./fileStoreS3');
const DiskFileStore = require('./fileStoreDisk');

module.exports.provideFileStore = function(job) {
    switch (config.fileStoreType) {
        case 's3':
            return new S3FileStore(job);
        case 'disk':
            return new DiskFileStore(job);
        default:
            throw new Error(`Unknown file store type: ${config.fileStoreType}`);
    }
};
