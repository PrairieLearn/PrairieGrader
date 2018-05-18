const ERR = require('async-stacktrace');
const async = require('async');
const fs = require('fs-extra');
const path = require('path');
const Ajv = require('ajv');
const { sqldb, sqlLoader } = require('@prairielearn/prairielib');

const globalLogger = require('./logger');
const config = require('./config').config;
const sql = sqlLoader.loadSqlEquiv(__filename);

let messageSchema = null;

module.exports = function(queue, receiveCallback, doneCallback) {
    let message, messageContents, jobCanceled;
    async.series([
        (callback) => {
            globalLogger.info('Waiting for next job...');
            queue.receiveMessage((err, receivedMessage) => {
                if (ERR(err, callback)) return;
                message = receivedMessage;
                messageContents = receivedMessage.contents;
                callback(null);
            });
        },
        (callback) => {
            if (!messageSchema) {
                fs.readJson(path.join(__dirname, 'messageSchema.json'), (err, data) => {
                    if (ERR(err, (err) => globalLogger.error(err))) {
                        globalLogger.error('Failed to read message schema; exiting process.');
                        process.exit(1);
                    }
                    const ajv = new Ajv();
                    messageSchema = ajv.compile(data);
                    return callback(null);
                });
            } else {
                return callback (null);
            }
        },
        (callback) => {
            const valid = messageSchema(messageContents);
            if (!valid) {
                globalLogger.error(messageSchema.errors);
                return callback(new Error('Message did not match schema.'));
            } else {
                return callback(null);
            }
        },
        (callback) => {
            const timeout = messageContents.timeout || config.defaultTimeout;
            // Add additional time to account for work that PG has to do:
            // downloading/uploading files, etc. This wasn't scientifically
            // chosen at all.
            const newTimeout = timeout + 10;
            queue.extendMessageTtl(message, newTimeout, (err) => {
                if (ERR(err, callback)) return;
                return callback(null);
            });
        },
        (callback) => {
            // If we're configured to use the database, ensure that this job
            // wasn't canceled in the time since job submission
            if (!config.useDatabase) return callback(null);

            const params = {
                grading_job_id: messageContents.jobId,
            };
            sqldb.queryOneRow(sql.check_job_cancelation, params, (err, result) => {
                if (ERR(err, callback)) return;
                jobCanceled = result.rows[0].canceled;
                callback(null);
            });
        },
        (callback) => {
            // Don't execute the job if it was canceled
            if (jobCanceled) {
                globalLogger.info(`Job ${messageContents.jobId} was canceled; skipping job.`);
                return callback(null);
            }

            receiveCallback(messageContents, (err) => {
                globalLogger.info(`Job ${messageContents.jobId} errored.`);
                callback(err);
            }, () => {
                globalLogger.info(`Job ${messageContents.jobId} finished successfully.`);
                callback(null);
            });
        },
        (callback) => {
            queue.ackMessage(message, (err) => {
                if (ERR(err, callback)) return;
                return callback(null);
            });
        }
    ], (err) => {
        if (ERR(err, doneCallback)) return;
        doneCallback(null);
    });
};
