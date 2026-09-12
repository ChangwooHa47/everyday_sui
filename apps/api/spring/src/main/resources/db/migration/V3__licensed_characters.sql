CREATE TABLE licensed_characters (
 character_id bigint PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
 listing_id varchar(66) NOT NULL CHECK(listing_id ~ '^0x[0-9a-f]{64}$'),
 license_id varchar(66) NOT NULL UNIQUE CHECK(license_id ~ '^0x[0-9a-f]{64}$'),
 base_prompt text NOT NULL
);
CREATE INDEX licensed_characters_listing ON licensed_characters(listing_id);
