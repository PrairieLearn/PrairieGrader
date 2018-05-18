#!/usr/bin/env node

var amqp = require('amqplib');

const NAME = 'grading_jobs';

(async () => {
  const conn = await amqp.connect('amqp://localhost');
  const ch = await conn.createChannel();
  const msg = {
    jobId: 182,
    image: 'prairielearn/centos7-python',
    entrypoint: '/grade/serverFilesCourse/python_autograder/run.sh',
    s3Bucket: 'prairielearn.dev.grading',
    s3RootKey: 'job_182',
    webhookUrl: 'http://localhost:3000/pl/webhooks/grading',
    csrfToken: 'ZWM3OGQzZWUwMGQyOWVjOWUzMjQyNzBjMzc3Mjk2ZjA2MjNlODdhNWY2ZTMyNzY5NjQyZTFmZTUxNDVlNTUwNA.jhcgivhx.eyJ1cmwiOiIvcGwvd2ViaG9va3MvZ3JhZGluZyJ9',
    timeout: 5,
    enableNetworking: false
  };

  await ch.assertQueue(NAME, {durable: true});
  ch.sendToQueue(NAME, new Buffer(JSON.stringify(msg)), {persistent: true});
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.log('Sent message!');
    conn.close();
  }, 500);
})();
