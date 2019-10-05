const fs = require('fs-extra');
const path = require('path');
const Ajv = require('ajv');
const { sqldb, sqlLoader } = require('@prairielearn/prairielib');

const globalLogger = require('./logger');
const config = require('./config').config;
const sql = sqlLoader.loadSqlEquiv(__filename);

const schemaData = fs.readJsonSync(path.join(__dirname, 'messageSchema.json'));
const ajv = new Ajv();
const messageSchema = ajv.compile(schemaData);

module.exports = {};

module.exports.receive = async function(sqs, queueUrl) {
    let params;

    params = {
        MaxNumberOfMessages: 1,
        QueueUrl: queueUrl,
        WaitTimeSeconds: 20
    };
    const data = await sqs.receiveMessage(params).promise();
    if (!data.Messages) return;

    globalLogger.info('Received job!');
    const job = JSON.parse(data.Messages[0].Body);
    const receiptHandle = data.Messages[0].ReceiptHandle;

    const valid = messageSchema(job);
    if (!valid) {
        globalLogger.error('Message did not match schema.', messageSchema.errors);
        return;
    }

    const timeout = job.timeout || config.defaultTimeout;
    // Add additional time to account for work that PG has to do:
    // downloading/uploading files, etc. This wasn't scientifically
    // chosen at all.
    const newTimeout = timeout + 10;
    params = {
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: newTimeout,
    };
    await sqs.changeMessageVisibility(params).promise();

    // If we're configured to use the database, ensure that this job
    // wasn't canceled in the time since job submission
    params = {
        grading_job_id: job.jobId,
    };
    const result = await sqldb.queryOneRowAsync(sql.check_job_cancelation, params);
    if (result.rows[0].canceled) {
        globalLogger.info(`Job ${job.jobId} was canceled; skipping job.`);
        return;
    }

    return {job, receiptHandle};
};

module.exports.delete = async function(sqs, queueUrl, receiptHandle) {
    const deleteParams = {
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle
    };
    await sqs.deleteMessage(deleteParams).promise();
};
