# Running an emulated-production environment

## Localstack

Localstack is a local AWS cloud stack that enables development and testing
using AWS-like services on local resources. PrairieGrader uses localstack to
emulate a PrairieLearn / PrairieGrader environment that mimics the AWS
production model for processing external grading requests. It uses SQS queues
and S3 buckets to pass grader jobs back and forth.

https://github.com/localstack/localstack

## Docker-Compose

Docker Compose is a tool for multi-docker container service architecture. One
configuration file controls bringing up and down docker services that co-exist.

The file that controls this in PG is under `./localstack/docker-compose.yml`.

https://docs.docker.com/compose/

## Running PrairieGrader and PrairieLearn with localstack

You must set these environment variables:

* `HOST_JOBS_DIR=/hostJobs` - An absolute path that describes where job folders
are to be launched from PG
* `PG_DIR=~/git/PrairieGrader` - An absolute path to the checkout of PG's repo
* `TMPDIR=~/git/PrairieGrader/localstack/tmp` - An absolute path for Localstack
to use for its (persistent) storage

```cd PrairieGrader/localstack
docker-compose up
```

You will see postgres and localstack start up, while PrairieGrader and PrairieLearn
wait 30-45 seconds for those services to start before launching. There you can use
PrairieLearn like normal, but externally graded questions will be routed through
PrairieGrader for processing.

To end, You can press Control-C in the terminal running docker-compose. You may
resume it with `docker-compose up`

When you are done with the stack and want it removed, run `docker-compose down`.




### TODOs

* Use Docker volumes to work around needing to define a host path for mounting
into grader containers. This uses a Docker-calling-Docker method borrowed from
PL for running grader jobs from PG (which is itself a container). Can we do all
of that file mounting manipulation in the docker space?

* Investigate persistence and either remove it cross-invocations or document
the methods for cleanup. In some cases you might want the jobs folders kept and
accessible for debugging -- in other cases, those details don't need to persist.

* Incorporate a CI chain that does localstack testing to test PG and PL externally
graded questions.

* Create a PrairieGrader method for testing question folders that can emulate
a job lifecycle from the command line. (Pass in a course folder and some parameters
on question and submission data and have it run the grader and display the output.)
This is started in PL `tools/question-container-debugging.sh` and
`run-question-in-container.sh` but it might make more sense to wrap an interface
around PG and docker-compose to support this?
