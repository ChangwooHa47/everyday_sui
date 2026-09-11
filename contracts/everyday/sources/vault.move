module everyday::vault;

use std::string::String;

const EOwner: u64 = 0;
const EPolicy: u64 = 1;
const ERevision: u64 = 2;
const EReference: u64 = 3;

// No store ability and no transfer entry point: personal history does not follow a Character transfer.
public struct UserVault has key {
    id: UID,
    owner: address,
    schema_version: u64,
    revision: u64,
    blob_id: String,
    content_hash: vector<u8>,
    end_epoch: u64,
}

public fun create(ctx: &mut TxContext) {
    let value = UserVault { id: object::new(ctx), owner: ctx.sender(), schema_version: 1,
        revision: 0, blob_id: std::string::utf8(b""), content_hash: vector[], end_epoch: 0 };
    transfer::transfer(value, ctx.sender());
}

public fun update(value: &mut UserVault, expected_revision: u64, blob_id: String, content_hash: vector<u8>, end_epoch: u64, ctx: &TxContext) {
    assert!(value.owner == ctx.sender(), EOwner);
    assert!(value.revision == expected_revision, ERevision);
    assert!(blob_id.length() == 43 && content_hash.length() == 32, EReference);
    value.revision = value.revision + 1;
    value.blob_id = blob_id;
    value.content_hash = content_hash;
    value.end_epoch = end_epoch;
}

// Seal identity is precisely the BCS vault object ID; no arbitrary identity can reuse this proof.
public fun seal_approve(id: vector<u8>, vault: &UserVault, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), EOwner);
    assert!(id == std::bcs::to_bytes(&object::id(vault)), EPolicy);
}
