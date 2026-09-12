CREATE TABLE portrait_jobs (
 character_id bigint PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
 image_prompt text NOT NULL,
 image_count integer NOT NULL CHECK(image_count BETWEEN 1 AND 4),
 status varchar(16) NOT NULL CHECK(status IN ('draft','pending','running','completed','failed','unknown')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portrait_jobs_pending ON portrait_jobs(updated_at) WHERE status='pending';
