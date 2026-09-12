ALTER TABLE everyday.characters ADD CONSTRAINT character_owner_pair UNIQUE(id,user_id);
ALTER TABLE everyday.photos ADD CONSTRAINT photo_character_pair UNIQUE(id,character_id);
CREATE TABLE everyday.photo_jobs (
    request_id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES everyday.users(id),
    character_id bigint NOT NULL REFERENCES everyday.characters(id),
    input_hash varchar(64) NOT NULL,
    context text NOT NULL,
    reference_url varchar(2048),
    concept varchar(255) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('pending','running','completed','failed')),
    photo_id bigint REFERENCES everyday.photos(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    FOREIGN KEY (character_id,user_id) REFERENCES everyday.characters(id,user_id),
    FOREIGN KEY (photo_id,character_id) REFERENCES everyday.photos(id,character_id)
);
CREATE INDEX photo_jobs_pending ON everyday.photo_jobs(updated_at) WHERE status IN ('pending','running');
