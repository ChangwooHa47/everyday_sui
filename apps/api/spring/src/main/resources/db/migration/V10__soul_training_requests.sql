CREATE TABLE everyday.soul_training_requests (
    character_id bigint PRIMARY KEY REFERENCES everyday.characters(id),
    input_hash varchar(64) NOT NULL,
    status varchar(16) NOT NULL CHECK(status IN ('pending','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
