/* eslint-env jest */
const SqsQueue = require('./sqsQueue');

function randomString() {
    return Math.random().toString(36).slice(2);
}

function fakeSqs(options = {}) {
    const receiptHandle = randomString();

    let message = options.message;
    if (!message) {
        message = {
            jobId: randomString(),
            image: randomString(),
            entrypoint: randomString(),
        };
    }
    if (options.mergeMessage) {
        message = {
            ...message,
            ...options.mergeMessage,
        };
    }

    const timeoutCount = options.timeoutCount || 0;
    let callCount = 0;
    return {
        receiveMessage: jest.fn((params, callback) => {
            if (callCount < timeoutCount) {
                callCount++;
                return callback(null, {});
            }
            callback(null, {
                Messages: [
                    {
                        Body: typeof message === 'string' ? message : JSON.stringify(message),
                        ReceiptHandle: receiptHandle
                    }
                ]
            });
        }),
        deleteMessage: jest.fn((params, callback) => callback(null)),
        changeMessageVisibility: jest.fn((params, callback) => callback(null)),
        message,
        receiptHandle
    };
}

describe('SqsQueue', () => {
    it('tries to receive a message from the correct queue url', (done) => {
        const sqs = fakeSqs();
        const queue = new SqsQueue(sqs, 'fakeurl');

        queue.receiveMessage((err) => {
            expect(err).toBeNull();
            expect(sqs.receiveMessage.mock.calls[0][0].QueueUrl).toBe('fakeurl');
            done();
        });
    });

    it('parses message from JSON', (done) => {
        const sqs = fakeSqs();
        const queue = new SqsQueue(sqs, 'fakeurl');

        queue.receiveMessage((err, message) => {
            expect(err).toBeNull();
            expect(message.content).toEqual(sqs.message);
            done();
        });
    });

    it('includes receipt handle in message object', (done) => {
        const sqs = fakeSqs();
        const queue = new SqsQueue(sqs, 'fakeurl');

        queue.receiveMessage((err, message) => {
            expect(err).toBeNull();
            expect(message.receiptHandle).toEqual(sqs.receiptHandle);
            done();
        });
    });

    it('tries to fetch a message again if none is delivered', (done) => {
        const sqs = fakeSqs({
            timeoutCount: 1
        });
        const queue = new SqsQueue(sqs, null);

        queue.receiveMessage((err) => {
            expect(err).toBeNull();
            expect(sqs.receiveMessage.mock.calls.length).toBe(2);
            done();
        });
    });

    it('rejects messages that aren\'t a valid json string', (done) => {
        const sqs = fakeSqs({
            message: '{"oops, this is invalid json"'
        });
        const queue = new SqsQueue(sqs, null);

        queue.receiveMessage((err) => {
            expect(err).not.toBeNull();
            done();
        });
    });

    it('updates visibility window', (done) => {
        const sqs = fakeSqs();
        const queue = new SqsQueue(sqs, null);

        queue.updateMessageTtl({ receiptHandle: sqs.receiptHandle }, 10, (err) => {
            expect(err).toBeNull();
            expect(sqs.changeMessageVisibility.mock.calls.length).toBe(1);
            const params = sqs.changeMessageVisibility.mock.calls[0][0];
            expect(params.VisibilityTimeout).toBe(10);
            done();
        });
    });

    it('deletes messages that are acked', (done) => {
        const sqs = fakeSqs();
        const queue = new SqsQueue(sqs, 'goodbyeworld');

        queue.ackMessage({ receiptHandle: sqs.receiptHandle }, (err) => {
            expect(err).toBeNull();
            expect(sqs.deleteMessage.mock.calls.length).toBe(1);
            expect(sqs.deleteMessage.mock.calls[0][0].QueueUrl).toBe('goodbyeworld');
            expect(sqs.deleteMessage.mock.calls[0][0].ReceiptHandle).toBe(sqs.receiptHandle);
            done();
        });
    });
});
