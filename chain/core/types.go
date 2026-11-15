// Package core holds the AUTISTIK Chain's data types (transactions, blocks), how they are signed and hashed, and the
// state machine that applies them. Everything here is deterministic: every node computes exactly the same result.
package core

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Decimals: balances are whole numbers of the smallest unit. 1 ATK = 1e9 units (like SOL's lamports).
const Decimals = 9
const Unit uint64 = 1_000_000_000

// Transaction types.
const (
	TxTransfer  = "transfer"  // move ATK
	TxMint      = "mint"      // create new ATK (owner only)
	TxBurn      = "burn"      // destroy your own ATK
	TxActivity  = "activity"  // an on-chain record of something done in AUTISTIK (game, buy, post, tip…), optionally paying someone
	TxName      = "name"      // claim a readable @name for your address
	TxValidator = "validator" // add / change / remove a validator (owner only)
	TxOwner     = "owner"     // hand the owner role to another address (owner only)
)

// ActivityKinds: what an activity record can describe.
var ActivityKinds = map[string]bool{"game": true, "buy": true, "sell": true, "post": true, "tip": true, "stake": true, "reward": true, "donate": true, "other": true}

// Limits that keep blocks small and nodes fast.
const (
	MaxDataBytes   = 512
	MaxTxPerBlock  = 5000
	MaxBlockBytes  = 4 << 20
	MaxMempool     = 50000
	NameMinLen     = 3
	NameMaxLen     = 20
)

// Tx is a signed transaction. Byte fields are hex in JSON so any language can build them.
type Tx struct {
	Type   string `json:"type"`
	PubKey string `json:"pubkey"`          // sender's ed25519 public key (hex, 32 bytes)
	Nonce  uint64 `json:"nonce"`           // sender's next nonce (stops replays)
	Fee    uint64 `json:"fee"`             // units paid: half to the AUTISTIK Fund, half to the block's proposer
	To     string `json:"to,omitempty"`    // receiving address
	Amount uint64 `json:"amount,omitempty"`
	Kind   string `json:"kind,omitempty"` // activity kind
	Data   string `json:"data,omitempty"` // activity note / name / validator pubkey
	Power  uint64 `json:"power,omitempty"`
	Sig    string `json:"sig"` // ed25519 signature of SignBytes (hex, 64 bytes)
}

// SignBytes is the exact text that gets signed. A plain line format (not JSON) so wallets in any language produce the
// same bytes. The chain id is part of it, so a testnet transaction can never be replayed on mainnet.
func (t *Tx) SignBytes(chainID string) []byte {
	return []byte(strings.Join([]string{
		"AUTISTIK-TX/1", chainID, t.Type, strings.ToLower(t.PubKey), strconv.FormatUint(t.Nonce, 10), strconv.FormatUint(t.Fee, 10),
		strings.ToLower(t.To), strconv.FormatUint(t.Amount, 10), t.Kind, hex.EncodeToString([]byte(t.Data)), strconv.FormatUint(t.Power, 10),
	}, "\n"))
}

// Hash identifies the transaction (signature included).
func (t *Tx) Hash(chainID string) string {
	h := sha256.Sum256(append(t.SignBytes(chainID), []byte("\n"+strings.ToLower(t.Sig))...))
	return hex.EncodeToString(h[:])
}

// From is the sender's address, derived from the public key.
func (t *Tx) From() (string, error) {
	pk, err := decodeKey(t.PubKey, ed25519.PublicKeySize)
	if err != nil {
		return "", err
	}
	return AddressOf(pk), nil
}

// VerifySig checks the signature and the basic shape of the transaction (not balances: that's the state's job).
func (t *Tx) VerifySig(chainID string) error {
	pk, err := decodeKey(t.PubKey, ed25519.PublicKeySize)
	if err != nil {
		return fmt.Errorf("bad pubkey: %w", err)
	}
	sig, err := decodeKey(t.Sig, ed25519.SignatureSize)
	if err != nil {
		return fmt.Errorf("bad signature: %w", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pk), t.SignBytes(chainID), sig) {
		return errors.New("signature does not match")
	}
	if len(t.Data) > MaxDataBytes {
		return errors.New("data too long")
	}
	if t.To != "" && !ValidAddress(t.To) {
		return errors.New("bad receiving address")
	}
	return nil
}

// Sign fills PubKey and Sig (used by tools, tests and the admin panel's server).
func (t *Tx) Sign(chainID string, key ed25519.PrivateKey) {
	t.PubKey = hex.EncodeToString(key.Public().(ed25519.PublicKey))
	t.Sig = hex.EncodeToString(ed25519.Sign(key, t.SignBytes(chainID)))
}

// AddressOf: "atk" + the first 20 bytes of sha256(public key), hex. Short, readable, can't be mistaken for an EVM address.
func AddressOf(pub []byte) string {
	h := sha256.Sum256(append([]byte("AUTISTIK-ADDR"), pub...))
	return "atk" + hex.EncodeToString(h[:20])
}

// ValidAddress: "atk" + 40 lowercase hex characters.
func ValidAddress(a string) bool {
	if len(a) != 43 || !strings.HasPrefix(a, "atk") {
		return false
	}
	_, err := hex.DecodeString(a[3:])
	return err == nil && strings.ToLower(a) == a
}

func decodeKey(h string, n int) ([]byte, error) {
	b, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(h), "0x"))
	if err != nil {
		return nil, err
	}
	if len(b) != n {
		return nil, fmt.Errorf("want %d bytes, got %d", n, len(b))
	}
	return b, nil
}

// Header is everything about a block except its transactions' bodies.
type Header struct {
	ChainID   string `json:"chain_id"`
	Height    uint64 `json:"height"`
	Round     int    `json:"round"`
	Time      int64  `json:"time"` // unix milliseconds, set by the proposer
	PrevHash  string `json:"prev_hash"`
	TxRoot    string `json:"tx_root"`    // merkle root of the transaction hashes
	StateRoot string `json:"state_root"` // hash of the full state AFTER this block
	ValRoot   string `json:"val_root"`   // hash of the validator set that must sign the NEXT block
	Proposer  string `json:"proposer"`   // proposer's validator pubkey (hex)
	NumTxs    int    `json:"num_txs"`
}

// Hash of the header (and so of the block): what validators vote on.
func (h *Header) Hash() string {
	s := strings.Join([]string{"AUTISTIK-BLOCK/1", h.ChainID, strconv.FormatUint(h.Height, 10), strconv.Itoa(h.Round), strconv.FormatInt(h.Time, 10),
		h.PrevHash, h.TxRoot, h.StateRoot, h.ValRoot, strings.ToLower(h.Proposer), strconv.Itoa(h.NumTxs)}, "\n")
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// Block = header + transactions.
type Block struct {
	Header Header `json:"header"`
	Txs    []Tx   `json:"txs"`
}

// Commit proves a block is final: precommit signatures from validators holding more than 2/3 of the voting power.
type Commit struct {
	Height    uint64      `json:"height"`
	Round     int         `json:"round"`
	BlockHash string      `json:"block_hash"`
	Sigs      []CommitSig `json:"sigs"`
}

type CommitSig struct {
	Validator string `json:"validator"` // pubkey hex
	Sig       string `json:"sig"`
}

// MerkleRoot of hex hashes (pairs hashed upward; an odd one out is carried up as is). Empty = hash of "".
func MerkleRoot(hashes []string) string {
	if len(hashes) == 0 {
		s := sha256.Sum256(nil)
		return hex.EncodeToString(s[:])
	}
	level := make([][]byte, len(hashes))
	for i, h := range hashes {
		b, _ := hex.DecodeString(h)
		level[i] = b
	}
	for len(level) > 1 {
		var next [][]byte
		for i := 0; i < len(level); i += 2 {
			if i+1 == len(level) {
				next = append(next, level[i])
				continue
			}
			s := sha256.Sum256(append(append([]byte{1}, level[i]...), level[i+1]...)) // prefix stops second-preimage tricks
			next = append(next, s[:])
		}
		level = next
	}
	return hex.EncodeToString(level[0])
}

// VoteSignBytes: what a validator signs when it votes. The chain id, height, round and step are all in it, so a vote
// can never be reused somewhere else.
func VoteSignBytes(chainID string, height uint64, round int, step string, blockHash string) []byte {
	return []byte(strings.Join([]string{"AUTISTIK-VOTE/1", chainID, strconv.FormatUint(height, 10), strconv.Itoa(round), step, blockHash}, "\n"))
}

// ProposalSignBytes: what the round's proposer signs.
func ProposalSignBytes(chainID string, height uint64, round int, polRound int, blockHash string) []byte {
	return []byte(strings.Join([]string{"AUTISTIK-PROPOSAL/1", chainID, strconv.FormatUint(height, 10), strconv.Itoa(round), strconv.Itoa(polRound), blockHash}, "\n"))
}
