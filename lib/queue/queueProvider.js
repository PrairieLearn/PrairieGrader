const AWS = require('aws-sdk');
const amqp = require('amqplib');

const { config } = require('../config');
const logger = require('../logger');
const SqsQueue = require('./sqsQueue');
const RabbitMqQueue = require('./rabbitMqQueue');

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

async function initRabbitMq() {
  this.conn = null;
  const that = this;
  return new Promise((resolve) => {
    async function tryConnect() {
      try {
        that.conn = await amqp.connect(config.rabbitMqQueueHost);
        resolve();
        that.conn.on('error', (err) => {
          logger.error(err);
          logger.error('Attempting to reconnect to RabbitMQ');
          setTimeout(tryConnect, 1000);
        });
        that.conn.on('close', () => {
          logger.error('Lost connection to RabbitMQ, attempting to reconnect');
          logger.error('Attempting to reconnect to RabbitMQ');
          setTimeout(tryConnect, 1000);
        });
      } catch (e) {
        logger.error('Couldn\'t connect to RabbitMQ, retrying');
        setTimeout(tryConnect, 1000);
      }
    }
    tryConnect();
  });
}

async function provideSqsQueue(callback) {
    callback(null, new SqsQueue(this.sqs, this.queueUrl));
}

async function provideRabbitMqQueue(callback) {
  try {
    const queue = new RabbitMqQueue(config.queueName);
    await queue.init(this.conn);
    callback(null, queue);
  } catch (e) {
    callback(e);
  }
}

module.exports.init = function(callback) {
  logger.info(`Initializing with queue type: ${config.queueType}`);
  switch(config.queueType) {
    case 'rabbitmq':
      initRabbitMq().then(() => callback(null)).catch(e => callback(e));
      break;
    case 'sqs':
      initSqs(callback);
      break;
    default:
      callback(new Error(`Unknown queue type: ${config.queueType}`));
  }
};

module.exports.provideQueue = function(callback) {
  switch (config.queueType) {
    case 'rabbitmq':
      provideRabbitMqQueue(callback);
      break;
    case 'sqs':
      provideSqsQueue(callback);
      break;
    default:
      callback(new Error(`Unknown queue type: ${config.queueType}`));
  }
};
