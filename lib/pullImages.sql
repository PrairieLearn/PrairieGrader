-- BLOCK select_recent_images
SELECT *
FROM (
    VALUES
    ('alawini/cs411-neo4j'),
    ('cs125/quiz:latest'),
    ('eecarrier/c-and-python-v2'),
    ('nicknytko/cs199-grader:1.0.0'),
    ('prairielearn/centos7-cs225')
) AS q(external_grading_image);
