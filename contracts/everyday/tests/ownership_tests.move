#[test_only]
module everyday::ownership_tests;

use everyday::character;
use everyday::vault;
use sui::test_scenario;

#[test]
fun character_transfer_and_private_vault() {
    let a = @0xA;
    let b = @0xB;
    let mut scenario = test_scenario::begin(a);
    vault::create(scenario.ctx());
    let c = character::create(std::string::utf8(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), b"00000000000000000000000000000000", 100, scenario.ctx());
    transfer::public_transfer(c, a);
    scenario.next_tx(a);
    let c = scenario.take_from_sender<character::Character>();
    transfer::public_transfer(c, b);
    let v = scenario.take_from_sender<vault::UserVault>();
    vault::seal_approve(std::bcs::to_bytes(&object::id(&v)), &v, scenario.ctx());
    scenario.return_to_sender(v);
    scenario.next_tx(b);
    let mut c = scenario.take_from_sender<character::Character>();
    character::update(&mut c, 0, std::string::utf8(b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), b"11111111111111111111111111111111", 101, scenario.ctx());
    assert!(character::revision(&c) == 1);
    scenario.return_to_sender(c);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 1, location = everyday::vault)]
fun wrong_seal_identity_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    vault::create(scenario.ctx());
    scenario.next_tx(@0xA);
    let v = scenario.take_from_sender<vault::UserVault>();
    vault::seal_approve(b"wrong identity", &v, scenario.ctx());
    scenario.return_to_sender(v);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0, location = everyday::character)]
fun stale_revision_rejected() {
    let mut scenario = test_scenario::begin(@0xA);
    let mut c = character::create(std::string::utf8(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), b"00000000000000000000000000000000", 100, scenario.ctx());
    character::update(&mut c, 1, std::string::utf8(b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), b"11111111111111111111111111111111", 101, scenario.ctx());
    transfer::public_transfer(c, @0xA);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0, location = everyday::vault)]
fun different_wallet_cannot_decrypt() {
    let mut scenario = test_scenario::begin(@0xA);
    vault::create(scenario.ctx());
    scenario.next_tx(@0xB);
    // The test harness can borrow an object from another address; the policy still rejects B.
    let v = scenario.take_from_address<vault::UserVault>(@0xA);
    vault::seal_approve(std::bcs::to_bytes(&object::id(&v)), &v, scenario.ctx());
    test_scenario::return_to_address(@0xA, v);
    scenario.end();
}
