class RabbitMqQueue {
    constructor(name) {
        this.name = name;
    }

    async init(conn) {
        this.ch = await conn.createChannel();
        await this.ch.assertQueue(this.name, { durable: true });
        await this.ch.prefetch(1);
    }

    receiveMessage(callback) {
        this.ch.consume(this.name, async (msg) => {
            await this.ch.cancel(msg.fields.consumerTag);
            let message;
            try {
                message = {
                    message: msg,
                    content: JSON.parse(msg.content.toString()),
                };
            } catch (e) {
                return callback(e);
            }
            callback(null, message);
        }).catch(callback);
    }

    extendMessageTtl(message, timeout, callback) {
        // Need to figure out how to support this with RabbitMQ
        callback(null);
    }

    ackMessage(message, callback) {
        this.ch.ack(message.message);
        callback(null);
    }
}

module.exports = RabbitMqQueue;
