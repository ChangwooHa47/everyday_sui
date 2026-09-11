module everyday::character;

use std::string::String;
use sui::event;

const ERevision: u64 = 0;
const EReference: u64 = 1;

public struct Character has key, store {
    id: UID,
    schema_version: u64,
    revision: u64,
    blob_id: String,
    content_hash: vector<u8>,
    end_epoch: u64,
}

public struct Published has copy, drop {
    id: ID,
    actor: address,
    revision: u64,
    blob_id: String,
}

public fun create(blob_id: String, content_hash: vector<u8>, end_epoch: u64, ctx: &mut TxContext): Character {
    validate(&blob_id, &content_hash);
    let value = Character { id: object::new(ctx), schema_version: 1, revision: 0, blob_id, content_hash, end_epoch };
    event::emit(Published { id: object::id(&value), actor: ctx.sender(), revision: 0, blob_id });
    value
}

public fun update(value: &mut Character, expected_revision: u64, blob_id: String, content_hash: vector<u8>, end_epoch: u64, ctx: &TxContext) {
    assert!(value.revision == expected_revision, ERevision);
    validate(&blob_id, &content_hash);
    value.revision = value.revision + 1;
    value.blob_id = blob_id;
    value.content_hash = content_hash;
    value.end_epoch = end_epoch;
    event::emit(Published { id: object::id(value), actor: ctx.sender(), revision: value.revision, blob_id });
}

fun validate(blob_id: &String, content_hash: &vector<u8>) {
    assert!(blob_id.length() == 43 && content_hash.length() == 32, EReference);
}

#[test_only]
public fun revision(value: &Character): u64 { value.revision }
