CREATE TABLE everyday.character_compile_requests (
    request_id uuid PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES everyday.users(id),
    input_hash varchar(64) NOT NULL,
    status varchar(16) NOT NULL CHECK(status IN ('pending','completed')),
    character_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(character_id,user_id) REFERENCES everyday.characters(id,user_id),
    CHECK((status='completed')=(character_id IS NOT NULL))
);
