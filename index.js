const ERR = require('async-stacktrace');
const fs = require('fs-extra');
const async = require('async');
const tmp = require('tmp');
const Docker = require('dockerode');
const { exec } = require('child_process');
const path = require('path');
const request = require('request');
const byline = require('byline');
const { sqldb } = require('@prairielearn/prairielib');
const sanitizeObject = require('@prairielearn/prairielib').util.sanitizeObject;

const globalLogger = require('./lib/logger');
const jobLogger = require('./lib/jobLogger');
const configManager = require('./lib/config');
const config = require('./lib/config').config;
const healthCheck = require('./lib/healthCheck');
const pullImages = require('./lib/pullImages');
const queueProvider = require('./lib/queue/queueProvider');
const fileStoreProvider = require('./lib/fileStore/fileStoreProvider');
const receiveFromQueue = require('./lib/receiveFromQueue');
const timeReporter = require('./lib/timeReporter');
const util = require('./lib/util');
const load = require('./lib/load');

async.series([
    (callback) => {
        configManager.loadConfig((err) => {
            if (ERR(err, callback)) return;
            globalLogger.verbose(JSON.stringify(config, null, 2));
            globalLogger.info('Loaded config; initializing...');
            callback(null);
        });
    },
    (callback) => {
        if (!config.useDatabase) return callback(null);
        var pgConfig = {
            host: config.postgresqlHost,
            database: config.postgresqlDatabase,
            user: config.postgresqlUser,
            password: config.postgresqlPassword,
            max: 2,
            idleTimeoutMillis: 30000,
        };
        globalLogger.verbose('Connecting to database ' + pgConfig.user + '@' + pgConfig.host + ':' + pgConfig.database);
        var idleErrorHandler = (err) => {
            globalLogger.error('idle client error', err);
        };
        sqldb.init(pgConfig, idleErrorHandler, (err) => {
            if (ERR(err, callback)) return;
            globalLogger.verbose('Successfully connected to database');
            callback(null);
        });
    },
    (callback) => {
        queueProvider.init((err) => {
          if (ERR(err, callback)) return;
          callback(null);
      });
    },
    (callback) => {
        if (!config.useDatabase || !config.reportLoad) return callback(null);
        load.init(config.maxConcurrentJobs);
        callback(null);
    },
    (callback) => {
        if (!config.useHealthCheck) return callback(null);
        healthCheck.init((err) => {
            if (ERR(err, callback)) return;
            callback(null);
        });
    },
    (callback) => {
        if (!config.useDatabase || !config.useImagePreloading) return callback(null);
        pullImages((err) => {
            if (ERR(err, callback)) return;
            callback(null);
        });
    },
    (callback) => {
        globalLogger.info('Initialization complete; beginning to process jobs');
        for (let i = 0; i < config.maxConcurrentJobs; i++) {
            queueProvider.provideQueue((err, queue) => {
                if (ERR(err, callback)) return;
                async.forever((next) => {
                    receiveFromQueue(queue, (job, fail, success) => {
                        handleJob(job, (err) => {
                            if (ERR(err, fail)) return;
                            success();
                        });
                    }, (err) => {
                        if (ERR(err, (err) => globalLogger.error(err)));
                        next();
                    });
                });
            });
        }
    }
], (err) => {
    globalLogger.error(err);
    process.exit(1);
});

function handleJob(job, done) {
    load.startJob();

    const fileStore = fileStoreProvider.provideFileStore(job);

    const logger = jobLogger(fileStore);
    globalLogger.verbose(`Logging job ${job.jobId} to output.log in ${fileStore.getName()}`);

    const info = {
        docker: new Docker(),
        fileStore,
        logger,
        job,
    };

    logger.info(`Running job ${job.jobId}`);
    logger.verbose(job);

    async.auto({
        context: (callback) => context(info, callback),
        reportReceived: ['context', reportReceived],
        initDocker: ['context', initDocker],
        initFiles: ['context', initFiles],
        runJob: ['initDocker', 'initFiles', runJob],
        storeResults: ['runJob', storeResults],
        storeArchive: ['runJob', storeArchive],
        cleanup: ['uploadResults', 'uploadArchive', (results, callback) => {
            logger.info('Removing temporary directories');
            results.initFiles.tempDirCleanup();
            callback(null);
        }]
    }, (err) => {
        load.endJob();
        if (ERR(err, done)) return;
        done(null);
    });
}

function context(info, callback) {
    const {
        job: {
            jobId,
        },
    } = info;

    timeReporter.reportReceivedTime(jobId, (err, time) => {
        if (ERR(err, callback)) return;
        const context = {
            ...info,
            receivedTime: time,
        };
        callback(null, context);
    });
}

function reportReceived(info, callback) {
    const {
        context: {
            job,
            receivedTime,
            logger,
        }
    } = info;
    logger.verbose('Pinging webhook to acknowledge that job was received');
    const data = {
        received_time: receivedTime,
    };
    sendWebhookEvent(job, 'job_received', data, (err) => {
        // We don't want to fail the job if this notification fails
        if (ERR(err, (err) => logger.error(err)));
        callback(null);
    });
}

function initDocker(info, callback) {
    const {
        context: {
            logger,
            docker,
            job: {
                image
            }
        }
    } = info;

    async.series([
        (callback) => {
            logger.verbose('Pinging docker');
            docker.ping((err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            logger.info(`Pulling latest version of "${image}" image`);
            const repository = util.parseRepositoryTag(image);
            const params = {
                fromImage: repository.repository,
                tag: repository.tag || 'latest'
            };

            docker.createImage(params, (err, stream) => {
                if (err) {
                    logger.warn(`Error pulling "${image}" image; attempting to fall back to cached version`);
                    logger.warn(err);
                }

                docker.modem.followProgress(stream, (err) => {
                    if (ERR(err, callback)) return;
                    callback(null);
                }, (output) => {
                    logger.info(output);
                });
            });
        },
    ], (err) => {
        if (ERR(err, callback)) return;
        callback(null);
    });
}

function initFiles(info, callback) {
    const {
        context: {
            logger,
            fileStore,
            job: {
                jobId,
                entrypoint
            }
        }
    } = info;

    let jobArchiveFile, jobArchiveFileCleanup;
    const files = {};

    async.series([
        (callback) => {
            logger.verbose('Setting up temp file');
            tmp.file((err, file, fd, cleanup) => {
                if (ERR(err, callback)) return;
                jobArchiveFile = file;
                jobArchiveFileCleanup = cleanup;
                callback(null);
            });
        },
        (callback) => {
            if (config.jobFilesVolumeName && config.jobFilesVolumePath) {
                logger.verbose(`Emptying job files directory: ${config.jobFilesVolumePath}`);
                fs.emptyDir(config.jobFilesVolumePath, (err) => {
                    if (ERR(err, callback)) return;
                    files.tempDir = config.jobFilesVolumePath;
                    files.tempDirCleanup = () => {}; // NOOP
                    callback(null);
                });
            } else {
                logger.verbose('Setting up temp dir');
                tmp.dir({
                    prefix: `job_${jobId}_`,
                    unsafeCleanup: true,
                }, (err, dir, cleanup) => {
                    if (ERR(err, callback)) return;
                    files.tempDir = dir;
                    files.tempDirCleanup = cleanup;
                    callback(null);
                });
            }
        },
        (callback) => {
            logger.verbose('Loading job files');
            const stream = fs.createWriteStream(jobArchiveFile);
            fileStore.getFile('job.tar.gz', stream, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            logger.verbose('Unzipping files');
            exec(`tar -xf ${jobArchiveFile} -C ${files.tempDir}`, (err) => {
                if (ERR(err, callback)) return;
                jobArchiveFileCleanup();
                callback(null);
            });
        },
        (callback) => {
            logger.verbose('Making entrypoint executable');
            exec(`chmod +x ${path.join(files.tempDir, entrypoint.slice(6))}`, (err) => {
                if (err) {
                    logger.error('Could not make file executable; continuing execution anyways');
                }
                callback(null);
            });
        }
    ], (err) => {
        if (ERR(err, callback)) return;
        callback(null, files);
    });
}

function runJob(info, callback) {
    const {
        context: {
            docker,
            logger,
            receivedTime,
            job: {
                jobId,
                image,
                entrypoint,
                timeout,
                enableNetworking,
            }
        },
        initFiles: {
            tempDir
        }
    } = info;

    let results = {};
    let jobTimeout = timeout || 30;
    let globalJobTimeout = jobTimeout * 2;
    let jobEnableNetworking = enableNetworking || false;

    let jobFailed = false;
    const globalJobTimeoutId = setTimeout(() => {
        jobFailed = true;
        healthCheck.flagUnhealthy('Job timeout exceeded; Docker presumed dead.');
        return callback(new Error(`Job timeout of ${globalJobTimeout}s exceeded.`));
    }, globalJobTimeout * 1000);

    logger.info('Launching Docker container to run grading job');

    async.waterfall([
        (callback) => {
            let bind;
            if (config.jobFilesVolumeName && config.jobFilesVolumePath) {
                bind = `${config.jobFilesVolumeName}:/grade`;
            } else {
                bind = `${tempDir}:/grade`;
            }
            docker.createContainer({
                Image: image,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                NetworkDisabled: !jobEnableNetworking,
                HostConfig: {
                    Binds: [ bind ],
                    Memory: 1 << 30, // 1 GiB
                    MemorySwap: 1 << 30, // same as Memory, so no access to swap
                    KernelMemory: 1 << 29, // 512 MiB
                    DiskQuota: 1 << 30, // 1 GiB
                    IpcMode: 'private',
                    CpuPeriod: 100000, // microseconds
                    CpuQuota: 90000, // portion of the CpuPeriod for this container
                    PidsLimit: 1024,
                },
                Entrypoint: entrypoint.split(' ')
            }, (err, container) => {
                if (ERR(err, callback)) return;
                callback(null, container);
            });
        },
        (container, callback) => {
            container.attach({
                stream: true,
                stdout: true,
                stderr: true,
            }, (err, stream) => {
                if (ERR(err, callback)) return;
                const out = byline(stream);
                out.on('data', (line) => {
                    logger.info(`container> ${line.toString('utf8')}`);
                });
                callback(null, container);
            });
        },
        (container, callback) => {
            container.start((err) => {
                if (ERR(err, callback)) return;
                logger.verbose('Started container');
                callback(null, container);
            });
        },
        (container, callback) => {
            timeReporter.reportStartTime(jobId, (err, time) => {
                if (ERR(err, callback)) return;
                results.start_time = time;
                callback(null, container);
            });
        },
        (container, callback) => {
            const timeoutId = setTimeout(() => {
                results.timedOut = true;
                container.kill();
            }, jobTimeout * 1000);
            logger.info('Waiting for container to complete...');
            container.wait((err) => {
                clearTimeout(timeoutId);
                if (ERR(err, callback)) return;
                callback(null, container);
            });
        },
        (container, callback) => {
            timeReporter.reportEndTime(jobId, (err, time) => {
                if (ERR(err, callback)) return;
                results.end_time = time;
                callback(null, container);
            });
        },
        (container, callback) => {
            container.inspect((err, data) => {
                if (ERR(err, callback)) return;
                if (results.timedOut) {
                    logger.info('Container timed out');
                } else {
                    logger.info(`Container exited with exit code ${data.State.ExitCode}`);
                }
                results.succeeded = (!results.timedOut && data.State.ExitCode == 0);
                callback(null, container);
            });
        },
        (container, callback) => {
            container.remove((err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            logger.verbose('Reading course results');
            // Now that the job has completed, let's extract the results
            // First up: results.json
            if (results.succeeded) {
                fs.readFile(path.join(tempDir, 'results', 'results.json'), (err, data) => {
                    if (err) {
                        logger.error('Could not read results.json');
                        results.succeeded = false;
                        results.message = 'Could not read grading results.';
                    } else {
                        if (Buffer.byteLength(data) > 100 * 1024) {
                            // Cap output at 100 KiB
                            results.succeeded = false;
                            results.message = 'The grading results were larger than 100 KiB. ' +
                            'Try removing print statements from your code to reduce the output size. ' +
                            'If the problem persists, please contact course staff or a proctor.';
                            return callback(null);
                        }

                        try {
                            const parsedResults = JSON.parse(data);
                            results.results = sanitizeObject(parsedResults);
                            results.succeeded = true;
                        } catch (e) {
                            logger.error('Could not parse results.json');
                            logger.error(e);
                            results.succeeded = false;
                            results.message = 'Could not parse the grading results.';
                        }

                        callback(null);
                    }
                });
            } else {
                if (results.timedOut) {
                    results.message = `Grading timed out after ${timeout} seconds.`;
                }
                results.results = null;
                callback(null);
            }
        }
    ], (err) => {
        // We made it throught the Docker danger zone!
        clearTimeout(globalJobTimeoutId);

        if (ERR(err, (err) => logger.error(err)));

        // If we somehow eventually get here after exceeding the global tieout,
        // we should avoid calling the callback again
        if (jobFailed) {
            return;
        }

        results.job_id = jobId;
        results.received_time = receivedTime;

        if (err) {
            results.succeeded = false;
            results.message = err.toString();
            return callback(null, results);
        } else {
            return callback(null, results);
        }
    });
}

function storeResults(info, callback) {
    const {
        context: {
            logger,
            fileStore,
            job,
        },
        runJob: results
    } = info;

    async.series([
        (callback) => {
            // Now we can write the results back to the file store
            logger.verbose('Storing results.json to file store');
            const buffer = new Buffer(JSON.stringify(results, null, '  '), 'binary');
            fileStore.putFileBuffer('results.json', buffer, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            if (!job.webhookUrl) return callback(null);
            // Let's send the results back to PrairieLearn now; the archive will
            // be stored
            logger.verbose('Pinging webhook with results');
            sendWebhookEvent(job, 'grading_result', results, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        }
    ], (err) => {
        if (ERR(err, callback)) return;
        callback(null);
    });
}

function storeArchive(results, callback) {
    const {
        context: {
            logger,
            fileStore,
        },
        initFiles: {
            tempDir
        }
    } = results;

    let tempArchive, tempArchiveCleanup;
    async.series([
        // Now we can store the archive of the /grade directory
        (callback) => {
            logger.verbose('Creating temp file for archive');
            tmp.file((err, file, fd, cleanup) => {
                if (ERR(err, callback)) return;
                tempArchive = file;
                tempArchiveCleanup = cleanup;
                callback(null);
            });
        },
        (callback) => {
            logger.verbose('Building archive');
            exec(`tar -zcf ${tempArchive} ${tempDir}`, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            logger.verbose('Storing archive.tar.gz to file store');
            const stream = fs.createReadStream(tempArchive);
            fileStore.putFileReadStream('archive.tar.gz', stream, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
    ], (err) => {
        if (ERR(err, callback)) return;
        tempArchiveCleanup && tempArchiveCleanup();
        callback(null);
    });
}

function sendWebhookEvent(job, event, data, callback) {
    const {
        jobId,
        webhookUrl,
        csrfToken
    } = job;
    const webhookData = {
        data,
        event,
        job_id: jobId,
        __csrf_token: csrfToken,
    };
    request.post({method: 'POST', url: webhookUrl, json: true, body: webhookData}, (err) => {
        if (ERR(err, callback)) return;
        callback(null);
    });
}
