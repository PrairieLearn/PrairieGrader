/* eslint-env jest */
const receiveFromQueue = require('./receiveFromQueue');

function randomString() {
    return Math.random().toString(36).slice(2);
}

function fakeQueue(options = {}) {
    let message = options.message;
    if (!message) {
        message = {
            jobId: randomString(),
            image: randomString(),
            entrypoint: randomString(),
        };
    }
    if (typeof message === 'object' && options.mergeMessage) {
        message = {
            ...message,
            ...options.mergeMessage,
        };
    }

    const wrappedMessage = {
        content: message,
    };

    return {
        receiveMessage: jest.fn((callback) => callback(null, wrappedMessage)),
        updateMessageTtl: jest.fn((message, timeout, callback) => callback(null)),
        ackMessage: jest.fn((message, callback) => callback(null)),
        message,
        wrappedMessage,
    };
}

describe('receiveFromQueue', () => {
    it('receives a message', (done) => {
        const queue = fakeQueue();
        receiveFromQueue(queue, (msg, errCb, doneCb) => {
            expect(msg).toBe(queue.message);
            doneCb();
        }, (err) => {
            expect(err).toBe(null);
            expect(queue.receiveMessage.mock.calls.length).toBe(1);
            done();
        });
    });

    it('rejects a message that doesn\'t match the schema', (done) => {
        const queue = fakeQueue({
            message: {
                image: 1234,
                entrypoint: null,
            },
        });

        const receive = jest.fn((msg, errCb, doneCb) => doneCb());

        receiveFromQueue(queue, receive, (err) => {
            expect(err).not.toBe(null);
            expect(queue.receiveMessage.mock.calls.length).toBe(1);
            expect(receive.mock.calls.length).toBe(0);
            done();
        });
    });

    it('updates a message\'s time to live', (done) => {
        const queue = fakeQueue({
            mergeMessage: {
                timeout: 10,
            },
        });

        const receive = jest.fn((msg, errCb, doneCb) => doneCb());

        receiveFromQueue(queue, receive, (err) => {
            expect(err).toBe(null);
            expect(queue.updateMessageTtl.mock.calls.length).toBe(1);
            expect(queue.updateMessageTtl.mock.calls[0][0]).toEqual(queue.wrappedMessage);
            expect(queue.updateMessageTtl.mock.calls[0][1]).toBeGreaterThan(10),
            expect(receive.mock.calls.length).toBe(1);
            done();
        });
    });

    it('acks a message if job ran successfully', (done) => {
        const queue = fakeQueue();

        const receive = jest.fn((msg, errCb, doneCb) => doneCb());

        receiveFromQueue(queue, receive, (err) => {
            expect(err).toBe(null);
            expect(queue.ackMessage.mock.calls.length).toBe(1);
            done();
        });
    });

    it('does not ack a message if job did not run successfully', (done) => {
        const queue = fakeQueue();

        const receive = jest.fn((msg, errCb, _doneCb) => errCb(new Error()));

        receiveFromQueue(queue, receive, (err) => {
            expect(err).not.toBe(null);
            expect(queue.ackMessage.mock.calls.length).toBe(0);
            done();
        });
    });
});
