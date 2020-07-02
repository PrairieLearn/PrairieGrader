-- BLOCK select_recent_images
SELECT DISTINCT q.external_grading_image
FROM submissions AS s
JOIN variants AS v ON (v.id = s.variant_id)
JOIN questions AS q ON (q.id = v.question_id)
WHERE q.grading_method = 'External'
AND q.external_grading_image IS NOT NULL
AND s.date >= (NOW() - INTERVAL '1 hour');
