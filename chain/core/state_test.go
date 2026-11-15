package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func key(t *testing.T) (ed25519.PrivateKey, string) {
	_, k, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k, AddressOf(k.Public().(ed25519.PublicKey))
}

func setup(t *testing.T) (*State, ed25519.PrivateKey, string, ed25519.PrivateKey) {
	owner, oa := key(t)
	_, fund := key(t)
	val, _ := key(t)
	g := &Genesis{ChainID: "autistik-test", Time: 1, Params: Params{Owner: oa, Fund: fund, MinFee: 10, NameFee: 1000, MaxSupply: 1_000_000 * Unit},
		Balances: map[string]uint64{oa: 1000 * Unit}, Validators: []Validator{{hex.EncodeToString(val.Public().(ed25519.PublicKey)), 1}}}
	s, err := NewState(g)
	if err != nil {
		t.Fatal(err)
	}
	return s, owner, oa, val
}

func TestTransferFeeSplitAndNonce(t *testing.T) {
	s, owner, oa, val := setup(t)
	_, bob := key(t)
	tx := Tx{Type: TxTransfer, Nonce: 0, Fee: 100, To: bob, Amount: 5 * Unit}
	tx.Sign(s.ChainID, owner)
	pa := ProposerAddress(hex.EncodeToString(val.Public().(ed25519.PublicKey)))
	if err := s.ApplyTx(&tx, pa); err != nil {
		t.Fatal(err)
	}
	if s.Accounts[bob].Balance != 5*Unit || s.Accounts[oa].Balance != 1000*Unit-5*Unit-100 {
		t.Fatal("balances wrong")
	}
	if s.Accounts[s.Params.Fund].Balance != 50 || s.Accounts[pa].Balance != 50 {
		t.Fatal("fee split wrong")
	}
	if err := s.ApplyTx(&tx, pa); err == nil {
		t.Fatal("replayed transaction was accepted")
	}
}

func TestOnlyOwnerMintsAndCap(t *testing.T) {
	s, owner, _, _ := setup(t)
	bobKey, bob := key(t)
	m := Tx{Type: TxMint, Nonce: 0, Fee: 10, To: bob, Amount: 10 * Unit}
	m.Sign(s.ChainID, bobKey)
	if err := s.ApplyTx(&m, ""); err == nil {
		t.Fatal("non-owner minted")
	}
	m2 := Tx{Type: TxMint, Nonce: 0, Fee: 10, To: bob, Amount: 2_000_000 * Unit}
	m2.Sign(s.ChainID, owner)
	if err := s.ApplyTx(&m2, ""); err == nil {
		t.Fatal("minted past the max supply")
	}
	m3 := Tx{Type: TxMint, Nonce: 0, Fee: 10, To: bob, Amount: 10 * Unit}
	m3.Sign(s.ChainID, owner)
	if err := s.ApplyTx(&m3, ""); err != nil || s.Supply != 1010*Unit {
		t.Fatal("owner mint failed", err)
	}
}

func TestTamperedSignatureRejected(t *testing.T) {
	s, owner, _, _ := setup(t)
	_, bob := key(t)
	tx := Tx{Type: TxTransfer, Nonce: 0, Fee: 10, To: bob, Amount: 1}
	tx.Sign(s.ChainID, owner)
	tx.Amount = 999 * Unit // changed after signing
	if err := s.ApplyTx(&tx, ""); err == nil {
		t.Fatal("tampered transaction accepted")
	}
	tx2 := Tx{Type: TxTransfer, Nonce: 0, Fee: 10, To: bob, Amount: 1}
	tx2.Sign("autistik-other", owner) // signed for another chain
	if err := s.ApplyTx(&tx2, ""); err == nil {
		t.Fatal("transaction from another chain accepted")
	}
}

func TestOverflowAndNames(t *testing.T) {
	s, owner, _, _ := setup(t)
	_, bob := key(t)
	tx := Tx{Type: TxTransfer, Nonce: 0, Fee: ^uint64(0), To: bob, Amount: 2}
	tx.Sign(s.ChainID, owner)
	if err := s.ApplyTx(&tx, ""); err == nil {
		t.Fatal("overflowing fee accepted")
	}
	n := Tx{Type: TxName, Nonce: 0, Fee: 10, Data: "believer"}
	n.Sign(s.ChainID, owner)
	if err := s.ApplyTx(&n, ""); err != nil || s.Names["believer"] == "" {
		t.Fatal("name claim failed", err)
	}
}

func TestBlockRoundTrip(t *testing.T) {
	s, owner, _, val := setup(t)
	_, bob := key(t)
	var txs []Tx
	for i := 0; i < 50; i++ {
		tx := Tx{Type: TxActivity, Kind: "game", Data: "won a race", Nonce: uint64(i), Fee: 10, To: bob, Amount: 1}
		tx.Sign(s.ChainID, owner)
		txs = append(txs, tx)
	}
	pub := hex.EncodeToString(val.Public().(ed25519.PublicKey))
	b, bad := s.BuildBlock(0, pub, 100, txs)
	if len(bad) != 0 || b.Header.NumTxs != 50 {
		t.Fatalf("build: %d bad", len(bad))
	}
	n, err := s.ApplyBlock(b, 100)
	if err != nil {
		t.Fatal(err)
	}
	if n.Height != 1 || n.Accounts[bob].Balance != 50 {
		t.Fatal("block not applied")
	}
	b.Txs[3].Data = "changed"
	if _, err := s.ApplyBlock(b, 100); err == nil {
		t.Fatal("tampered block accepted")
	}
}
