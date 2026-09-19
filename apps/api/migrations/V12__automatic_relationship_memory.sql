-- Private automatic memory remains scoped to one product user and one licensed character.
-- Raw conversation messages stay in everyday.chat_messages and are never copied to a public contract.
CREATE TABLE everyday.automatic_memory_extractions (
    source_ai_message_id bigint PRIMARY KEY,
    user_id bigint NOT NULL,
    character_id bigint NOT NULL,
    source_user_message_id bigint NOT NULL,
    status varchar(16) NOT NULL CHECK(status IN ('pending','running','completed','failed','unknown','skipped')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(character_id,user_id) REFERENCES everyday.characters(id,user_id) ON DELETE CASCADE,
    FOREIGN KEY(source_user_message_id,character_id) REFERENCES everyday.chat_messages(id,character_id) ON DELETE CASCADE,
    FOREIGN KEY(source_ai_message_id,character_id) REFERENCES everyday.chat_messages(id,character_id) ON DELETE CASCADE,
    CHECK(source_user_message_id<>source_ai_message_id)
);
CREATE INDEX automatic_memory_extractions_pending
    ON everyday.automatic_memory_extractions(updated_at,source_ai_message_id) WHERE status='pending';

CREATE TABLE everyday.automatic_memories (
    id uuid PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE,
    user_id bigint NOT NULL,
    character_id bigint NOT NULL,
    listing_id varchar(66) NOT NULL CHECK(listing_id ~ '^0x[0-9a-f]{64}$'),
    source_user_message_id bigint NOT NULL,
    source_ai_message_id bigint NOT NULL,
    kind varchar(32) NOT NULL CHECK(kind IN ('preference','promise','shared_experience','anniversary','relationship_change')),
    summary varchar(500) NOT NULL CHECK(char_length(trim(summary))>0),
    fingerprint varchar(64) NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
    confidence smallint NOT NULL CHECK(confidence BETWEEN 0 AND 100),
    event_date date,
    promise_status varchar(16) CHECK(promise_status IN ('planned','completed','cancelled')),
    supersedes_id uuid REFERENCES everyday.automatic_memories(id) ON DELETE SET NULL,
    status varchar(16) NOT NULL CHECK(status IN ('pending','submitting','submitted','checking','stored','failed','unknown','superseded','filtered')),
    provider_job_id varchar(256),
    provider_blob_id varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(character_id,user_id) REFERENCES everyday.characters(id,user_id) ON DELETE CASCADE,
    FOREIGN KEY(source_user_message_id,character_id) REFERENCES everyday.chat_messages(id,character_id) ON DELETE CASCADE,
    FOREIGN KEY(source_ai_message_id,character_id) REFERENCES everyday.chat_messages(id,character_id) ON DELETE CASCADE,
    UNIQUE(user_id,character_id,fingerprint),
    CHECK((kind='promise')=(promise_status IS NOT NULL)),
    CHECK(supersedes_id IS NULL OR supersedes_id<>id),
    CHECK(status NOT IN ('submitted','checking','stored') OR provider_job_id IS NOT NULL),
    CHECK(status<>'stored' OR provider_blob_id IS NOT NULL)
);
CREATE INDEX automatic_memories_context
    ON everyday.automatic_memories(user_id,character_id,status,created_at DESC);
CREATE INDEX automatic_memories_submission
    ON everyday.automatic_memories(updated_at,id) WHERE status IN ('pending','submitted');

-- Confirmed relationship facts are projected here later from stored memories,
-- confirmed gifts and completed experiences. Pending extraction never creates an event.
CREATE TABLE everyday.relationship_events (
    id uuid PRIMARY KEY,
    user_id bigint NOT NULL,
    character_id bigint NOT NULL,
    event_type varchar(32) NOT NULL CHECK(event_type IN ('memory','promise','gift','shared_experience','relationship_change')),
    source_kind varchar(32) NOT NULL CHECK(source_kind IN ('automatic_memory','gift','photo','episode')),
    source_id varchar(256) NOT NULL,
    summary varchar(500) NOT NULL CHECK(char_length(trim(summary))>0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(character_id,user_id) REFERENCES everyday.characters(id,user_id) ON DELETE CASCADE,
    UNIQUE(user_id,character_id,source_kind,source_id,event_type)
);
CREATE INDEX relationship_events_timeline
    ON everyday.relationship_events(user_id,character_id,occurred_at DESC,id);
