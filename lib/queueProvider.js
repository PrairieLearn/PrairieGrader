const AWS = require('aws-sdk');

const { config } = require('./config');
const logger = require('./logger');
const SqsQueue = require('./sqsQueue');

function initSqs(callback) {
  this.sqs = new AWS.SQS();
  if (config.queueUrl) {
    logger.info(`Using queue url from config: ${config.queueUrl}`);
    this.queueUrl = config.queueUrl;
    callback(null);
  } else if (config.queueName) {
    logger.info(`Loading url for queue "${config.queueName}"`);
    const params = {
        QueueName: config.queueName
    };
    this.sqs.getQueueUrl(params, (err, data) => {
        if (err) {
            logger.error(`Unable to load url for queue "${config.queueName}"`);
            callback(err);
        }
        this.queueUrl = data.QueueUrl;
        logger.info(`Loaded url for queue "${config.queueName}": ${config.queueUrl}`);
        callback(null);
    });
  }
}

function initRabbitMq(callback) {
  callback(new Error('RabbitMQ support has not been added yet'));
}

function provideSqsQueue(callback) {
    callback(null, new SqsQueue(this.sqs, this.queueUrl));
}

function provideRabbitMqQueue(callback) {
  callback(new Error('RabbitMQ support has not been added yet'));
}

module.exports.init = function(callback) {
  logger.info(`Initializing with queue type: ${config.queueType}`);
  switch(config.queueType) {
    case 'rabbitmq':
      return initRabbitMq(callback);
    case 'sqs':
      return initSqs(callback);
    default:
      callback(new Error(`Unknown queue type: ${config.queueType}`));
  }
};

module.exports.provideQueue = function(callback) {
  switch (config.queueType) {
    case 'rabbitmq':
      return provideRabbitMqQueue(callback);
    case 'sqs':
      return provideSqsQueue(callback);
    default:
      callback(new Error(`Unknown queue type: ${config.queueType}`));
  }
};
