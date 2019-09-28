-- BLOCK insert_load
INSERT INTO grader_loads
    ( instance_id, date,   queue_name,  average_jobs,  max_jobs,  lifecycle_state,  healthy)
VALUES
    ($instance_id, now(), $queue_name, $average_jobs, $max_jobs, $lifecycle_state, $healthy)
ON CONFLICT (instance_id) DO UPDATE
SET
    date = now(),
    queue_name = EXCLUDED.queue_name,
    average_jobs = EXCLUDED.average_jobs,
    max_jobs = EXCLUDED.max_jobs,
    lifecycle_state = EXCLUDED.lifecycle_state,
    healthy = EXCLUDED.healthy;

-- BLOCK insert_config
INSERT INTO grader_loads
    ( instance_id,  config, started_at)
VALUES
    ($instance_id, $config, now())
ON CONFLICT (instance_id) DO UPDATE
SET
    config = EXCLUDED.config,
    started_at = now();
