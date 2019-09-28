const util = require('util');
const assert = require('assert');
const AWS = require('aws-sdk');

const logger = require('./logger');
const config = require('./config').config;

/**
 * Stores our current state. We do one-way transitions:
 *    null -> Wait -> InService
 * or
 *    null -> Wait -> AbandonLaunch
 */
let lifecycleState = null;

module.exports.init = async () => {
    if (config.autoScalingGroupName == null) {
        logger.info('lifecycle.init(): not running in AutoScalingGroup');
        return;
    }

    assert.equal(lifecycleState, null);
    lifecycleState = 'Wait';
    logger.info(`lifecycle.init(): changing to state ${lifecycleState}`);
    heartbeat();
};

module.exports.inService = async () => {
    if (config.autoScalingGroupName == null) {
        logger.info('lifecycle.inService(): not running in AutoScalingGroup');
        return;
    }

    assert.equal(lifecycleState, 'Wait');
    lifecycleState = 'InService';
    logger.info(`lifecycle.inService(): changing to state ${lifecycleState}`);

    const autoscaling = new AWS.AutoScaling();
    const params = {
        AutoScalingGroupName: config.autoScalingGroupName, 
        LifecycleActionResult: 'CONTINUE', 
        LifecycleHookName: 'launching',
        InstanceId: config.instanceId,
    };
    await autoscaling.completeLifecycleAction(params).promise();
    logger.info('lifecycle.inService(): action sent', params);
};

module.exports.abandonLaunch = async () => {
    if (config.autoScalingGroupName == null) {
        logger.info('lifecycle.abandonLaunch(): not running in AutoScalingGroup');
        return;
    }

    if (lifecycleState == 'Wait') {
        lifecycleState = 'AbandonLaunch';
        logger.info(`lifecycle.abandonLaunch(): changing to state ${lifecycleState}`);

        const autoscaling = new AWS.AutoScaling();
        const params = {
            AutoScalingGroupName: config.autoScalingGroupName, 
            LifecycleActionResult: 'ABANDON', 
            LifecycleHookName: 'launching',
            InstanceId: config.instanceId,
        };
        await autoscaling.completeLifecycleAction(params).promise();
        logger.info('lifecycle.abandonLaunch(): action sent', params);
    } else {
        logger.info(`lifecycle.abandonLaunch(): in state ${lifecycleState}, taking no action`);
    }
};

function heartbeat() {
    if (lifecycleState == 'Wait') {
        logger.info('lifecycle.heartbeat(): sending heartbeat...');
        const autoscaling = new AWS.AutoScaling();
        const params = {
            AutoScalingGroupName: config.autoScalingGroupName, 
            InstanceId: config.instanceId,
            LifecycleHookName: 'launching',
        };
        autoscaling.recordLifecycleActionHeartbeat(params, (err, _data) => {
            if (err) return logger.error('lifecycle.heartbeat(): ERROR', err);
            setTimeout(heartbeat, config.lifecycleHeartbeatIntervalMS);
        });
    } else {
        logger.info(`lifecycle.heartbeat(): in state ${lifecycleState}, not sending heartbeat`);
    }
}
