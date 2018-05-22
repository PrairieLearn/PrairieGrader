/* eslint-env jest */
const RabbitMqQueue = require('./rabbitMqQueue');

function randomString() {
    return Math.random().toString(36).slice(2);
}

function fakeRmqConnection(options = {}) {
    const consumerTag = randomString();

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

    const messageBuffer = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));

    const channel = {
        assertQueue: jest.fn(() => Promise.resolve()),
        prefetch: jest.fn(() => Promise.resolve()),
        consume: jest.fn((queueName, callback) => {
            const wrappedMessage = {
                content: messageBuffer,
                fields: {
                    consumerTag,
                }
            };
            callback(wrappedMessage);
            return Promise.resolve();
        }),
        cancel: jest.fn(() => Promise.resolve()),
        ack: jest.fn(),
    };

    return {
        createChannel: jest.fn(() => Promise.resolve(channel)),
        channel,
        message,
        messageBuffer,
        consumerTag
    };
}

describe('RabbitMqQueue', () => {
    it('correctly initialized the queue', async (done) => {
        const queue = new RabbitMqQueue('queue_name');
        const conn = fakeRmqConnection();
        await queue.init(conn);

        expect(conn.channel.assertQueue.mock.calls[0][0]).toBe('queue_name');
        expect(conn.channel.assertQueue.mock.calls[0][1].durable).toBe(true);
        expect(conn.channel.prefetch.mock.calls[0][0]).toBe(1);
        done();
    });

    it('parses message from JSON', async (done) => {
        const queue = new RabbitMqQueue('queue_name');
        const conn = fakeRmqConnection();
        await queue.init(conn);

        queue.receiveMessage((err, message) => {
            expect(err).toBeNull();
            expect(message.content).toEqual(conn.message);
            done();
        });
    });

    it('cancels this consumer after receiving', async (done) => {
        const queue = new RabbitMqQueue('queue_name');
        const conn = fakeRmqConnection();
        await queue.init(conn);

        queue.receiveMessage((err) => {
            expect(err).toBeNull();
            expect(conn.channel.cancel.mock.calls[0][0]).toBe(conn.consumerTag);
            done();
        });
    });

    it('rejects messages that aren\'t a valid json string', async (done) => {
        const queue = new RabbitMqQueue('queue_name');
        const conn = fakeRmqConnection({
            message: '{"oops, this is invalid json"'
        });
        await queue.init(conn);

        queue.receiveMessage((err) => {
            expect(err).not.toBeNull();
            done();
        });
    });

    it('acks messages successfully', async (done) => {
        const queue = new RabbitMqQueue('queue_name');
        const conn = fakeRmqConnection({
            message: '{"oops, this is invalid json"'
        });
        await queue.init(conn);

        queue.ackMessage({ message: 'mymessage' }, (err) => {
            expect(err).toBeNull();
            expect(conn.channel.ack.mock.calls[0][0]).toBe('mymessage');
            done();
        });
    });
});
