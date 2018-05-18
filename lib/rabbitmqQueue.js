const NAME = 'grading-jobs';

module.exports = function(conn) {
  const ch = conn.createChannel();
  ch.assertQueue(NAME, { durable: true });
  ch.consume(NAME, (msg) => {
    console.log(`got message: ${msg}`);
    ch.ack(msg);
  });
};
