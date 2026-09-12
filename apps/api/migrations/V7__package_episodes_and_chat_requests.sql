-- Authored package episodes are shared content; character_episodes remains per-user progress.
CREATE TABLE everyday.market_episode_templates (
    listing_id varchar(66) NOT NULL CHECK(listing_id ~ '^0x[0-9a-f]{64}$'),
    package_episode_id varchar(80) NOT NULL,
    episode_id bigint NOT NULL UNIQUE REFERENCES everyday.episodes(id),
    PRIMARY KEY(listing_id,package_episode_id)
);
ALTER TABLE everyday.chat_messages ADD CONSTRAINT message_character_pair UNIQUE(id,character_id);
CREATE TABLE everyday.chat_turn_requests (
    request_id uuid PRIMARY KEY,
    character_id bigint NOT NULL REFERENCES everyday.characters(id),
    character_episode_id bigint,
    input_hash varchar(64) NOT NULL,
    status varchar(16) NOT NULL CHECK(status IN ('pending','running','completed')),
    ai_message_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(character_episode_id,character_id) REFERENCES everyday.character_episodes(id,character_id),
    FOREIGN KEY(ai_message_id,character_id) REFERENCES everyday.chat_messages(id,character_id),
    CHECK((status='completed')=(ai_message_id IS NOT NULL))
);
