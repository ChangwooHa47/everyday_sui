CREATE TABLE everyday.episode_starter_requests (
    character_episode_id bigint PRIMARY KEY REFERENCES everyday.character_episodes(id),
    status varchar(16) NOT NULL CHECK(status IN ('pending','completed')),
    starters jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((status='completed')=(starters IS NOT NULL)),
    CHECK(starters IS NULL OR jsonb_typeof(starters)='array')
);
