-- Receiving a provider ID means registration, not completed training.
ALTER TABLE everyday.characters ADD COLUMN soul_ready boolean NOT NULL DEFAULT false;
ALTER TABLE everyday.photo_jobs ADD COLUMN soul_id varchar(255);
