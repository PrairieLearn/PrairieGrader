const ERR = require('async-stacktrace');
const async = require('async');
const Docker = require('dockerode');
const { sqldb, sqlLoader } = require('@prairielearn/prairielib');

const logger = require('./logger');
const dockerUtil = require('./dockerUtil');
const sql = sqlLoader.loadSqlEquiv(__filename);
const config = require('./config').config;

module.exports = function(callback) {
    const docker = new Docker();
    var dockerAuth = {};

    async.waterfall([
        (callback) => {
            logger.info('Pinging docker');
            docker.ping((err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        },
        (callback) => {
            if (config.forcedRegistry) {
                logger.info('Authenticating to docker');
                dockerUtil.setupDockerAuth((err, auth) => {
                    if (ERR(err, callback)) return;
                    dockerAuth = auth;
                    callback(null);
                });
            } else {
                callback(null);
            }
        },
        (callback) => {
            logger.info('Querying for recent images');
            sqldb.query(sql.select_test_images, [], (err, results) => {
                if (ERR(err, callback)) return;
                const images = results.rows.map(row => row.external_grading_image);
                callback(null, images);
            });
        },
        (images, callback) => {
            logger.info(`Need to pull ${images.length} images`);
            async.each(images, (image, callback) => {
                logger.info(`Pulling latest version of "${image}" image from ${config.forcedRegistry}`);
                var repository = new dockerUtil.DockerName(image);
                repository.registry = config.forcedRegistry;
                const params = {
                    fromImage: repository.getRegistryRepo(),
                    tag: repository.getTag() || 'latest'
                };

                docker.createImage(dockerAuth, params, (err, stream) => {
                    if (err && err.statusCode == 404) {
                      logger.info(`Missing image at ${params.fromImage}:${params.tag}, registry needs updating`);
                      return dockerUtil.pullAndPushToECR(image, dockerAuth, (err) => {
                          if (ERR(err, callback)) return;
                          callback(null);
                      });
                    }
                    if (ERR(err, callback)) return;

                    docker.modem.followProgress(stream, (err) => {
                        if (ERR(err, callback)) return;
                        callback(null);
                    }, (output) => {
                        logger.info('docker output:', output);
                    });
                });
            }, (err) => {
                if (ERR(err, callback)) return;
                callback(null);
            });
        }
    ], (err) => {
        if (ERR(err, callback)) return;
        callback(null);
    });
};
