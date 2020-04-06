const ERR = require('async-stacktrace');
const AWS = require('aws-sdk');
const Docker = require('dockerode');
const _ = require('lodash');
const debug = require('debug')('PrairieGrader:dockerUtil');
const config = require('./config').config;
const logger = require('./logger');

const docker = new Docker();

module.exports.setupDockerAuth = function(callback) {

	const ecr = new AWS.ECR();
	ecr.getAuthorizationToken({}, (err, data) => {
		if(ERR(err, callback)) return;
		//debug(data);
		let buff = Buffer.from(data.authorizationData[0].authorizationToken, 'base64');
		let authString = buff.toString('ascii');
		let authArray = authString.split(':');

		var auth = {
			username: authArray[0],
			password: authArray[1],
		};
		//debug(auth);
		return callback(null, auth);
	});
};

/*********************************************************************
 * Borrowed from https://github.com/apocas/dockerode/blob/master/lib/util.js
 * but turned into an object to manipulate which part of the docker image name
 * we need
 *********************************************************************/
module.exports.DockerName = function(name) {
	this.original = name;
	this.registry = undefined;
	this.repository = name;
	this.tag = undefined;

	// Parse name into the object parts
	var separatorPos;
	var digestPos = name.indexOf('@');
	var colonPos = name.lastIndexOf(':');

	// @ symbol is more important
	if (digestPos >= 0) {
		separatorPos = digestPos;
	} else if (colonPos >= 0) {
		separatorPos = colonPos;
	}

	if (separatorPos) {
        // last colon is either the tag (or part of a port designation)
        var tag = name.slice(separatorPos + 1);

        // if it contains a / its not a tag and is part of the url
        if (tag.indexOf('/') === -1) {
            this.repository = name.slice(0, separatorPos);
            this.tag = tag;
        }
    }

	var slashes = this.repository.split('/');
	if (slashes.length > 2) {
        this.registry = slashes.slice(0, -2).join('/');
        this.repository = slashes.slice(-2).join('/');
	}

	////////////////////////////////////////////////////////////////////////

	this.getRepository = function() { return this.repository; };
	this.getTag = function() { return this.tag; };
	this.getRegistryRepo = function() {
		var combined = '';

		if (typeof(this.registry) !== 'undefined') {
            combined = this.registry + '/';
		}
		combined += this.repository;
		return combined;
	};

	this.getCombined = function(latestTag=false) {
		var combined = '';

		if (typeof(this.registry) !== 'undefined') {
            combined = this.registry + '/';
		}
		combined += this.repository;
		if (this.tag) {
			combined += ':' + this.tag;
		} else if (latestTag) {
			combined += ':latest';
		}
		return combined;
	};
}; // end DockerName

function locateImage(image, callback) {
	debug('locateImage');
	docker.listImages(function(err, list) {
	if (ERR(err, callback)) return;
		debug(list);
	for (var i = 0, len = list.length; i < len; i++) {

	if (list[i].RepoTags && list[i].RepoTags.indexOf(image) !== -1) {
	return callback(null, docker.getImage(list[i].Id));
	}
	}

	return callback();
	});
}

function confirmOrCreateECRRepo(repo, callback) {
	const ecr = new AWS.ECR();
	ecr.describeRepositories({}, (err, data) => {
	if (ERR(err, callback)) return;

		var repository_found = _.find(data.repositories, ['repositoryName', repo]);
		if (!repository_found) {

			var params = {
				repositoryName: repo,
			};
			logger.info('ECR: Creating repo ' + repo);
			ecr.createRepository(params, (err) => {
				if (ERR(err, callback)) return;
				callback(null);
			});
		} else {
			// Already exists, nothing to do
			callback(null);
		}
	});
}

module.exports.pullAndPushToECR = function(image, dockerAuth, callback) {
	logger.info(`pullAndPushtoECR for ${image}`);

	var repository = new module.exports.DockerName(image);
	const params = {
		fromImage: repository.getRepository(),
		tag: repository.getTag() || 'latest'
	};
	logger.info(`Pulling ${repository.getCombined()}`);
	docker.createImage({}, params, (err, stream) => {
		if (ERR(err, callback)) return;

	//stream.pipe(process.stdout);
	stream.resume();
	stream.on('end', () => {
			logger.info('Pull complete');

			// Find the image we just downloaded
			locateImage(repository.getCombined(true), (err, localImage) => {
				if (ERR(err, callback)) return;

				// Tag the image to add the new registry
				repository.registry = config.forcedRegistry;

				var options = {
					repo: repository.getCombined(),
				};

				localImage.tag(options, (err) => {
					if (ERR(err, callback)) return;

					confirmOrCreateECRRepo(repository.getRepository(), (err) => {
						if (ERR(err, callback)) return;

						// Create a new docker image instance with the new registry name
						// localImage isn't specific enough to the ECR repo
						var pushImage = new Docker.Image(docker.modem, repository.getCombined());

						logger.info(`Pushing ${repository.getCombined()}`);
						pushImage.push({}, (err, stream) => {
							if (ERR(err, callback)) return;
							//stream.pipe(process.stdout);
							stream.resume();
							stream.on('end', () => {
								logger.info('Push complete');
								callback(null);
							});
						}, dockerAuth);
					});
				});
			});
		});
	});
};
