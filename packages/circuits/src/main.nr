use std::hash::poseidon::bn254::hash_1;
use std::hash::poseidon::bn254::hash_2;
use binary_merkle_root::binary_merkle_root;

fn main(
    nullifier_hash: pub Field,
    nullifier: Field,
    secret: Field,
    root: pub Field,
    vote: pub bool,
    depth: pub u32,
    index: Field,
    siblings: [Field; 16],
) {
    assert(hash_1([nullifier]) == nullifier_hash);
    let commitment = hash_2([nullifier, secret]);
    let mut siblings_num = 0;
    for i in 0..siblings.len() {
        if siblings[i] != 0 {
            siblings_num += 1;
        }
    }
    assert(depth <= siblings.len());
    let index_bits: [u1; 16] = index.to_le_bits();
    let computed_root = binary_merkle_root(hash_2, commitment, siblings_num, index_bits, siblings);
    assert(computed_root == root);
    let vote_field = vote as Field;
    assert((vote_field * vote_field) == vote_field);
}
