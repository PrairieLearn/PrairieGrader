const winston = require('winston');
const CloudWatchTransport = require('winston-aws-cloudwatch');

const logger = new (winston.Logger)({
    transports: [
        new winston.transports.Console({
            timestamp: true,
            colorize: true,
        })
    ]
});

// Disable logs during unit tests
if (process.env.NODE_ENV === 'test') {
  logger.transports.console.silent = true;
}

logger.initCloudWatchLogging = function(groupName, streamName) {
    // IMPORTANT: don't require('./config') until after module is initialized
    // in order to prevent a circular dependency issue
    const config = require('./config').config;

    logger.add(CloudWatchTransport, {
        logGroupName: groupName,
        logStreamName: streamName,
        createLogGroup: true,
        createLogStream: true,
        submissionInterval: 500,
        batchSize: 100,
        awsConfig: config.awsConfig
    });
};

logger.setLevel = function(level) {
    Object.keys(logger.transports).forEach((transport) => {
        logger.transports[transport].level = level;
    });
};

module.exports = logger;
