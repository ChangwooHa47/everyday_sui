module everyday::market;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::{Self, Clock};
use sui::event;
use sui::sui::SUI;
use sui::table::{Self, Table};

const EOwner: u64 = 0;
const EInvalid: u64 = 1;
const ENotLive: u64 = 2;
const EPurchased: u64 = 3;
const EPayment: u64 = 4;
const EAccess: u64 = 5;
const EPolicy: u64 = 6;
const EReplay: u64 = 7;

public struct Admin has key { id: UID }
public struct Creator has key { id: UID, owner: address }
// No store or transfer function: this is a personal, non-exclusive use license.
public struct License has key { id: UID, listing: ID, buyer: address }
public struct Listing has key {
    id: UID,
    creator: address,
    operator: address,
    title: String,
    price: u64,
    agent_bps: u64,
    blob_id: String,
    content_hash: vector<u8>,
    end_epoch: u64,
    published: bool,
    active: bool,
    buyers: Table<address, bool>,
    treasury: Balance<SUI>,
    per_gift_limit: u64,
    daily_limit: u64,
    day: u64,
    spent: u64,
    allowed_gifts: vector<ID>,
    intents: Table<vector<u8>, bool>,
}
public struct GiftProduct has key {
    id: UID, title: String, merchant: address, price: u64, active: bool,
}
public struct GiftReceipt has key {
    id: UID, listing: ID, product: ID, recipient: address, price: u64,
}
public struct Listed has copy, drop { listing: ID, creator: address, operator: address }
public struct PackagePublished has copy, drop { listing: ID, blob_id: String, end_epoch: u64 }
public struct Purchased has copy, drop {
    listing: ID, license: ID, buyer: address, creator_amount: u64, agent_amount: u64,
}
public struct GiftSent has copy, drop {
    listing: ID, product: ID, recipient: address, receipt: ID, amount: u64, intent: vector<u8>,
}

fun init(ctx: &mut TxContext) { transfer::transfer(Admin { id: object::new(ctx) }, ctx.sender()); }
public fun register_creator(ctx: &mut TxContext) {
    transfer::transfer(Creator { id: object::new(ctx), owner: ctx.sender() }, ctx.sender());
}

// Create first, then encrypt with Seal identity = listing ID, then publish its immutable reference.
public fun create_listing(creator: &Creator, operator: address, title: String, price: u64,
    agent_bps: u64, per_gift_limit: u64, daily_limit: u64, allowed_gifts: vector<ID>, ctx: &mut TxContext) {
    assert!(creator.owner == ctx.sender(), EOwner);
    assert!(title.length() > 0 && title.length() <= 240 && price > 0 && agent_bps <= 10000, EInvalid);
    assert!(operator != @0x0 && per_gift_limit <= daily_limit && allowed_gifts.length() <= 20, EInvalid);
    let listing = Listing { id: object::new(ctx), creator: ctx.sender(), operator, title, price, agent_bps,
        blob_id: std::string::utf8(b""), content_hash: vector[], end_epoch: 0,
        published: false, active: false, buyers: table::new(ctx), treasury: balance::zero(),
        per_gift_limit, daily_limit, day: 0, spent: 0, allowed_gifts, intents: table::new(ctx) };
    event::emit(Listed { listing: object::id(&listing), creator: ctx.sender(), operator });
    transfer::share_object(listing);
}
public fun publish(listing: &mut Listing, blob_id: String, content_hash: vector<u8>, end_epoch: u64, ctx: &TxContext) {
    assert!(listing.creator == ctx.sender(), EOwner);
    // end_epoch is a Walrus storage epoch, not a Sui epoch. This is reference metadata;
    // storage availability is checked by the package reader, not by comparing unrelated clocks.
    assert!(!listing.published && blob_id.length() == 43 && content_hash.length() == 32 && end_epoch > 0, EInvalid);
    listing.blob_id = blob_id;
    listing.content_hash = content_hash;
    listing.end_epoch = end_epoch;
    listing.published = true;
    listing.active = true;
    event::emit(PackagePublished { listing: object::id(listing), blob_id, end_epoch });
}
// Retention can be extended without changing the purchased work or its Seal identity.
// A new edition of the character is a new Listing in the first version.
public fun extend_retention(listing: &mut Listing, end_epoch: u64, ctx: &TxContext) {
    assert!(listing.creator == ctx.sender(), EOwner);
    assert!(listing.published && end_epoch > listing.end_epoch, EInvalid);
    listing.end_epoch = end_epoch;
}
public fun set_active(listing: &mut Listing, active: bool, ctx: &TxContext) {
    assert!(listing.creator == ctx.sender(), EOwner);
    assert!(listing.published, ENotLive);
    listing.active = active;
}
public fun purchase(listing: &mut Listing, mut payment: Coin<SUI>, ctx: &mut TxContext) {
    assert!(listing.active && listing.published, ENotLive);
    let buyer = ctx.sender();
    assert!(!listing.buyers.contains(buyer), EPurchased);
    assert!(payment.value() == listing.price, EPayment);
    // u128 intermediate prevents overflow for valid u64 prices.
    let agent_amount = (((listing.price as u128) * (listing.agent_bps as u128) / 10000) as u64);
    listing.treasury.join(payment.split(agent_amount, ctx).into_balance());
    transfer::public_transfer(payment, listing.creator);
    listing.buyers.add(buyer, true);
    let license = License { id: object::new(ctx), listing: object::id(listing), buyer };
    event::emit(Purchased { listing: object::id(listing), license: object::id(&license), buyer,
        creator_amount: listing.price - agent_amount, agent_amount });
    transfer::transfer(license, buyer);
}
public fun tip(listing: &mut Listing, payment: Coin<SUI>) { listing.treasury.join(payment.into_balance()); }

// The service operator needs plaintext to run preview/chat; buyers can decrypt in another client.
public fun seal_approve(id: vector<u8>, listing: &Listing, ctx: &TxContext) {
    assert!(id == std::bcs::to_bytes(&object::id(listing)), EAccess);
    assert!(ctx.sender() == listing.creator || ctx.sender() == listing.operator || listing.buyers.contains(ctx.sender()), EAccess);
}
public fun create_gift(_: &Admin, title: String, merchant: address, price: u64, ctx: &mut TxContext) {
    assert!(price > 0 && merchant != @0x0 && title.length() > 0 && title.length() <= 240, EInvalid);
    transfer::share_object(GiftProduct { id: object::new(ctx), title, merchant, price, active: true });
}
public fun set_gift_active(_: &Admin, gift: &mut GiftProduct, active: bool) { gift.active = active; }
// There is deliberately no unrestricted withdrawal, merchant override, or limit-raising entry point.
public fun send_gift(listing: &mut Listing, gift: &GiftProduct, recipient: address,
    intent: vector<u8>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == listing.operator, EOwner);
    assert!(listing.buyers.contains(recipient), EAccess);
    assert!(intent.length() == 32 && !listing.intents.contains(intent), EReplay);
    assert!(gift.active && listing.allowed_gifts.contains(&object::id(gift)), EPolicy);
    let day = clock::timestamp_ms(clock) / 86400000;
    if (day > listing.day) { listing.day = day; listing.spent = 0; };
    assert!(gift.price <= listing.per_gift_limit && gift.price <= listing.daily_limit - listing.spent, EPolicy);
    assert!(gift.price <= listing.treasury.value(), EPayment);
    listing.spent = listing.spent + gift.price;
    listing.intents.add(intent, true);
    let payment = coin::from_balance(listing.treasury.split(gift.price), ctx);
    transfer::public_transfer(payment, gift.merchant);
    let receipt = GiftReceipt { id: object::new(ctx), listing: object::id(listing), product: object::id(gift), recipient, price: gift.price };
    event::emit(GiftSent { listing: object::id(listing), product: object::id(gift), recipient,
        receipt: object::id(&receipt), amount: gift.price, intent });
    transfer::transfer(receipt, recipient);
}
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
#[test_only]
public fun treasury_value(listing: &Listing): u64 { listing.treasury.value() }
