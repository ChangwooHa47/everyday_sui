-- Fictional examples compiled from author settings. Never populated from personal chat_messages.
CREATE TABLE everyday.character_examples (
    character_id bigint NOT NULL REFERENCES everyday.characters(id) ON DELETE CASCADE,
    example_order integer NOT NULL CHECK(example_order>=0 AND example_order<12),
    role varchar(16) NOT NULL CHECK(role IN ('user','assistant')),
    content varchar(2000) NOT NULL,
    PRIMARY KEY(character_id,example_order)
);
