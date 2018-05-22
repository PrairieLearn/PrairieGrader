const ERR = require('async-stacktrace');
const async = require('async');

class SqsQueue {
    constructor(sqs, queueUrl) {
        this.sqs = sqs;
        this.queueUrl = queueUrl;
    }

    receiveMessage(callback) {
        async.doUntil((done) => {
            const params = {
                MaxNumberOfMessages: 1,
                QueueUrl: this.queueUrl,
                WaitTimeSeconds: 20
            };
            this.sqs.receiveMessage(params, (err, data) => {
                if (ERR(err, done)) return;
                if (!data.Messages) {
                    return done(null, null);
                }
                let message;
                try {
                    const parsedMessage = JSON.parse(data.Messages[0].Body);
                    const receiptHandle = data.Messages[0].ReceiptHandle;
                    message = {
                        content: parsedMessage,
                        receiptHandle,
                    };
                } catch (e) {
                    return done(e);
                }
                return done(null, message);
            });
        }, (result) => {
            return !!result;
        }, (err, message) => {
            if (ERR(err, callback)) return;
            callback(null, message);
        });
    }

    updateMessageTtl(message, timeout, callback) {
        const visibilityParams = {
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.receiptHandle,
            VisibilityTimeout: timeout,
        };
        this.sqs.changeMessageVisibility(visibilityParams, (err) => {
            if (ERR(err, callback)) return;
            return callback(null);
        });
    }

    ackMessage(message, callback) {
        const deleteParams = {
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.receiptHandle
        };
        this.sqs.deleteMessage(deleteParams, (err) => {
            if (ERR(err, callback)) return;
            return callback(null);
        });
    }
}

module.exports = SqsQueue;
