const winston = require('winston');

const globalLogger = require('./logger');
const config = require('./config').config;

module.exports = function(fileStore) {
    const transports = [
        new (winston.transports.File)({
            stream: fileStore.createLogStream(),
            json: false
        })
    ];

    if (config.useConsoleLoggingForJobs) {
        transports.push(new (winston.transports.Console)({timestamp: true, colorize: true}));
    }

    const logger = new (winston.Logger)({ transports });

    logger.on('error', (err) => {
        globalLogger.error('Error sending logs to output.log in file store');
        globalLogger.error(err);
    });

    return logger;
};
