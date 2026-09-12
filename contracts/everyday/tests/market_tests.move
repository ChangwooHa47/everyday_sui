#[test_only]
module everyday::market_tests;

use everyday::market::{Self, Admin, Creator, Listing, License, GiftProduct, GiftReceipt};
use sui::test_scenario::{Self, Scenario};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock;

fun setup(per_gift: u64, daily: u64, allow: bool): Scenario {
    let mut s = test_scenario::begin(@0xA);
    market::init_for_testing(s.ctx());
    market::register_creator(s.ctx());
    s.next_tx(@0xA);
    let admin = s.take_from_sender<Admin>();
    market::create_gift(&admin, std::string::utf8(b"Photo booth"), @0xD, 100, s.ctx());
    s.return_to_sender(admin);
    s.next_tx(@0xA);
    let gift = s.take_shared<GiftProduct>();
    let gifts = if (allow) vector[object::id(&gift)] else vector[];
    test_scenario::return_shared(gift);
    let creator = s.take_from_sender<Creator>();
    market::create_listing(&creator, @0xC, std::string::utf8(b"Everyday"), 1000, 2000, per_gift, daily, gifts, s.ctx());
    s.return_to_sender(creator);
    s.next_tx(@0xA);
    // Walrus storage epoch 100 must not be compared with Sui epoch 1000.
    s.skip_to_epoch(1000);
    let mut listing = s.take_shared<Listing>();
    market::publish(&mut listing, std::string::utf8(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), b"00000000000000000000000000000000", 100, s.ctx());
    test_scenario::return_shared(listing);
    s
}
fun buy(s: &mut Scenario, amount: u64) {
    s.next_tx(@0xB);
    let mut listing = s.take_shared<Listing>();
    market::purchase(&mut listing, coin::mint_for_testing<SUI>(amount, s.ctx()), s.ctx());
    test_scenario::return_shared(listing);
}
fun gift(s: &mut Scenario, sender: address, recipient: address, intent: vector<u8>, time: u64) {
    s.next_tx(sender);
    let mut listing = s.take_shared<Listing>();
    let product = s.take_shared<GiftProduct>();
    let mut clock = clock::create_for_testing(s.ctx());
    clock::increment_for_testing(&mut clock, time);
    market::send_gift(&mut listing, &product, recipient, intent, &clock, s.ctx());
    clock::destroy_for_testing(clock);
    test_scenario::return_shared(product);
    test_scenario::return_shared(listing);
}
#[test]
fun purchase_split_access_and_gift() {
    let mut s = setup(100, 100, true);
    buy(&mut s, 1000);
    s.next_tx(@0xB);
    let license = s.take_from_sender<License>();
    s.return_to_sender(license);
    let listing = s.take_shared<Listing>();
    assert!(market::treasury_value(&listing) == 200);
    market::seal_approve(std::bcs::to_bytes(&object::id(&listing)), &listing, s.ctx());
    test_scenario::return_shared(listing);
    s.next_tx(@0xA);
    let payout = s.take_from_sender<Coin<SUI>>();
    assert!(payout.value() == 800);
    coin::burn_for_testing(payout);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0);
    s.next_tx(@0xB);
    let receipt = s.take_from_sender<GiftReceipt>();
    s.return_to_sender(receipt);
    s.next_tx(@0xD);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(payment.value() == 100);
    coin::burn_for_testing(payment);
    // A new UTC day resets the budget. The treasury remains the funding source.
    gift(&mut s, @0xC, @0xB, b"22222222222222222222222222222222", 86400000);
    s.next_tx(@0xA);
    let listing = s.take_shared<Listing>();
    assert!(market::treasury_value(&listing) == 0);
    test_scenario::return_shared(listing);
    s.end();
}
#[test]
#[expected_failure(abort_code = 4, location = everyday::market)]
fun incorrect_payment() { let mut s = setup(100, 100, true); buy(&mut s, 999); s.end(); }
#[test]
#[expected_failure(abort_code = 3, location = everyday::market)]
fun duplicate_purchase() { let mut s = setup(100, 100, true); buy(&mut s, 1000); buy(&mut s, 1000); s.end(); }
#[test]
#[expected_failure(abort_code = 6, location = everyday::market)]
fun daily_budget_enforced() {
    let mut s = setup(100, 100, true); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0);
    gift(&mut s, @0xC, @0xB, b"22222222222222222222222222222222", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 7, location = everyday::market)]
fun intent_cannot_replay() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 86400000); s.end();
}
#[test]
#[expected_failure(abort_code = 6, location = everyday::market)]
fun per_gift_budget_enforced() {
    let mut s = setup(99, 200, true); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 6, location = everyday::market)]
fun allowlist_enforced() {
    let mut s = setup(100, 200, false); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 0, location = everyday::market)]
fun operator_required() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    gift(&mut s, @0xB, @0xB, b"11111111111111111111111111111111", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 5, location = everyday::market)]
fun recipient_must_be_buyer() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xE, b"11111111111111111111111111111111", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 5, location = everyday::market)]
fun stranger_cannot_decrypt() {
    let mut s = setup(100, 200, true);
    s.next_tx(@0xE);
    let listing = s.take_shared<Listing>();
    market::seal_approve(std::bcs::to_bytes(&object::id(&listing)), &listing, s.ctx());
    test_scenario::return_shared(listing); s.end();
}
#[test]
#[expected_failure(abort_code = 5, location = everyday::market)]
fun wrong_identity_cannot_decrypt() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    s.next_tx(@0xB);
    let listing = s.take_shared<Listing>();
    market::seal_approve(b"wrong", &listing, s.ctx());
    test_scenario::return_shared(listing); s.end();
}
#[test]
fun delisting_preserves_buyer_access_and_retention_can_extend() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    s.next_tx(@0xA);
    let mut listing = s.take_shared<Listing>();
    market::set_active(&mut listing, false, s.ctx());
    market::extend_retention(&mut listing, 200, s.ctx());
    test_scenario::return_shared(listing);
    s.next_tx(@0xB);
    let listing = s.take_shared<Listing>();
    market::seal_approve(std::bcs::to_bytes(&object::id(&listing)), &listing, s.ctx());
    test_scenario::return_shared(listing); s.end();
}

#[test]
#[expected_failure(abort_code = 2, location = everyday::market)]
fun delisted_cannot_be_purchased() {
    let mut s = setup(100, 200, true);
    s.next_tx(@0xA);
    let mut listing = s.take_shared<Listing>();
    market::set_active(&mut listing, false, s.ctx());
    test_scenario::return_shared(listing);
    buy(&mut s, 1000); s.end();
}
#[test]
#[expected_failure(abort_code = 4, location = everyday::market)]
fun treasury_cannot_be_overdrawn() {
    let mut s = setup(100, 300, true); buy(&mut s, 1000);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0);
    gift(&mut s, @0xC, @0xB, b"22222222222222222222222222222222", 0);
    gift(&mut s, @0xC, @0xB, b"33333333333333333333333333333333", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 6, location = everyday::market)]
fun disabled_gift_cannot_be_bought() {
    let mut s = setup(100, 200, true); buy(&mut s, 1000);
    s.next_tx(@0xA);
    let admin = s.take_from_sender<Admin>();
    let mut product = s.take_shared<GiftProduct>();
    market::set_gift_active(&admin, &mut product, false);
    s.return_to_sender(admin);
    test_scenario::return_shared(product);
    gift(&mut s, @0xC, @0xB, b"11111111111111111111111111111111", 0); s.end();
}
#[test]
#[expected_failure(abort_code = 1, location = everyday::market)]
fun published_package_cannot_be_replaced() {
    let mut s = setup(100, 200, true);
    s.next_tx(@0xA);
    let mut listing = s.take_shared<Listing>();
    market::publish(&mut listing, std::string::utf8(b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), b"11111111111111111111111111111111", 200, s.ctx());
    test_scenario::return_shared(listing); s.end();
}
