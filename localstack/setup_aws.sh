#! /bin/sh

# Needed for localstack to start up
echo "Sleeping for 30 while localstack starts up"
sleep 30

aws sqs create-queue --endpoint-url=http://localstack:4566 --queue-name grading_jobs_dev
aws sqs create-queue --endpoint-url=http://localstack:4566 --queue-name grading_results_dev
aws s3api create-bucket --endpoint-url=http://localstack:4566 --bucket prairielearn.dev.grading --region localstack
