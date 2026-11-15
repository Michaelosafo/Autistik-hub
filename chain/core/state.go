package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Account: balance and the next nonce it must use.
type Account struct {
	Balance uint64 `json:"balance"`
	Nonce   uint64 `json:"nonce"`
	Name    string `json:"name,omitempty"`
}

// Params are the chain's rules. Only the owner can change validators or hand over the owner role.
type Params struct {
	Owner   string `json:"owner"`    // address allowed to mint and manage validators
	Fund    string `json:"fund"`     // the AUTISTIK Fund: receives half of every fee, on-chain and public
	MinFee  uint64 `json:"min_fee"`  // smallest fee accepted (units)
	NameFee uint64 `json:"name_fee"` // cost of claiming an @name (goes to the Fund)
	MaxSupply uint64 `json:"max_supply"` // hard cap on total ATK units; minting can never pass it (0 = no cap)
}

// Validator: a node allowed to propose and vote, and its voting power.
type Validator struct {
	PubKey string `json:"pubkey"`
	Power  uint64 `json:"power"`
}

// State is the whole ledger at one height.
type State struct {
	ChainID    string              `json:"chain_id"`
	Height     uint64              `json:"height"`
	LastHash   string              `json:"last_hash"`
	LastTime   int64               `json:"last_time"`
	Supply     uint64              `json:"supply"`
	Params     Params              `json:"params"`
	Accounts   map[string]*Account `json:"accounts"`
	Names      map[string]string   `json:"names"` // @name -> address
	Validators []Validator         `json:"validators"`
}

// Genesis: the chain's first state, identical on every node.
type Genesis struct {
	ChainID    string            `json:"chain_id"`
	Time       int64             `json:"genesis_time"`
	Params     Params            `json:"params"`
	Balances   map[string]uint64 `json:"balances"`
	Validators []Validator       `json:"validators"`
}

func NewState(g *Genesis) (*State, error) {
	if g.ChainID == "" || !ValidAddress(g.Params.Owner) || !ValidAddress(g.Params.Fund) {
		return nil, errors.New("genesis needs chain_id, owner and fund addresses")
	}
	if len(g.Validators) == 0 {
		return nil, errors.New("genesis needs at least one validator")
	}
	s := &State{ChainID: g.ChainID, LastTime: g.Time, Params: g.Params, Accounts: map[string]*Account{}, Names: map[string]string{}}
	for a, b := range g.Balances {
		if !ValidAddress(a) {
			return nil, fmt.Errorf("bad genesis address %s", a)
		}
		s.Accounts[a] = &Account{Balance: b}
		s.Supply += b
	}
	if s.Params.MaxSupply > 0 && s.Supply > s.Params.MaxSupply {
		return nil, errors.New("genesis balances are above the max supply")
	}
	for _, v := range g.Validators {
		if _, err := decodeKey(v.PubKey, 32); err != nil || v.Power == 0 {
			return nil, fmt.Errorf("bad genesis validator %s", v.PubKey)
		}
	}
	s.Validators = sortVals(g.Validators)
	return s, nil
}

// Copy makes an independent copy (blocks are tried on a copy first, so a bad block never touches the real state).
func (s *State) Copy() *State {
	c := *s
	c.Accounts = make(map[string]*Account, len(s.Accounts))
	for k, v := range s.Accounts {
		a := *v
		c.Accounts[k] = &a
	}
	c.Names = make(map[string]string, len(s.Names))
	for k, v := range s.Names {
		c.Names[k] = v
	}
	c.Validators = append([]Validator(nil), s.Validators...)
	return &c
}

func (s *State) acct(a string) *Account {
	x := s.Accounts[a]
	if x == nil {
		x = &Account{}
		s.Accounts[a] = x
	}
	return x
}

// TotalPower of the current validator set.
func (s *State) TotalPower() uint64 {
	var t uint64
	for _, v := range s.Validators {
		t += v.Power
	}
	return t
}

func (s *State) Power(pub string) uint64 {
	for _, v := range s.Validators {
		if v.PubKey == strings.ToLower(pub) {
			return v.Power
		}
	}
	return 0
}

// Proposer for a height and round: weighted round robin over the validator set, the same on every node.
func (s *State) Proposer(height uint64, round int) string {
	total := s.TotalPower()
	if total == 0 {
		return ""
	}
	slot := (height + uint64(round)) % total
	for _, v := range s.Validators {
		if slot < v.Power {
			return v.PubKey
		}
		slot -= v.Power
	}
	return s.Validators[0].PubKey
}

var nameRe = regexp.MustCompile(`^[a-z0-9_]+$`)

// ErrSkip marks a transaction that is simply invalid right now (the block builder leaves it out).
var ErrSkip = errors.New("invalid transaction")

// ApplyTx runs one transaction. On error nothing has changed.
func (s *State) ApplyTx(t *Tx, proposerAddr string) error {
	if err := t.VerifySig(s.ChainID); err != nil {
		return fmt.Errorf("%w: %v", ErrSkip, err)
	}
	from, _ := t.From()
	a := s.acct(from)
	if t.Nonce != a.Nonce {
		return fmt.Errorf("%w: nonce %d, expected %d", ErrSkip, t.Nonce, a.Nonce)
	}
	if t.Fee < s.Params.MinFee {
		return fmt.Errorf("%w: fee below %d", ErrSkip, s.Params.MinFee)
	}
	need := t.Fee
	switch t.Type {
	case TxTransfer, TxBurn:
		if t.Amount == 0 {
			return fmt.Errorf("%w: amount is 0", ErrSkip)
		}
		need += t.Amount
	case TxActivity:
		if !ActivityKinds[t.Kind] {
			return fmt.Errorf("%w: unknown activity kind", ErrSkip)
		}
		need += t.Amount
	case TxName:
		need += s.Params.NameFee
	}
	if need < t.Fee || a.Balance < need { // first check catches overflow
		return fmt.Errorf("%w: balance %d, needs %d", ErrSkip, a.Balance, need)
	}
	owner := from == s.Params.Owner

	switch t.Type {
	case TxTransfer:
		if t.To == "" {
			return fmt.Errorf("%w: no receiver", ErrSkip)
		}
	case TxBurn:
	case TxActivity:
		if t.Amount > 0 && t.To == "" {
			return fmt.Errorf("%w: payment needs a receiver", ErrSkip)
		}
	case TxMint:
		if !owner {
			return fmt.Errorf("%w: only the owner can mint", ErrSkip)
		}
		if t.To == "" || t.Amount == 0 || s.Supply+t.Amount < s.Supply {
			return fmt.Errorf("%w: bad mint", ErrSkip)
		}
		if s.Params.MaxSupply > 0 && s.Supply+t.Amount > s.Params.MaxSupply {
			return fmt.Errorf("%w: would pass the max supply", ErrSkip)
		}
	case TxName:
		n := strings.ToLower(t.Data)
		if len(n) < NameMinLen || len(n) > NameMaxLen || !nameRe.MatchString(n) {
			return fmt.Errorf("%w: names are 3-20 of a-z, 0-9, _", ErrSkip)
		}
		if s.Names[n] != "" {
			return fmt.Errorf("%w: @%s is taken", ErrSkip, n)
		}
	case TxValidator:
		if !owner {
			return fmt.Errorf("%w: only the owner can change validators", ErrSkip)
		}
		if _, err := decodeKey(t.Data, 32); err != nil {
			return fmt.Errorf("%w: bad validator key", ErrSkip)
		}
		if t.Power == 0 && len(s.Validators) <= 1 {
			return fmt.Errorf("%w: can't remove the last validator", ErrSkip)
		}
	case TxOwner:
		if !owner || !ValidAddress(t.To) {
			return fmt.Errorf("%w: only the owner can hand over the owner role", ErrSkip)
		}
	default:
		return fmt.Errorf("%w: unknown type %q", ErrSkip, t.Type)
	}

	// Checks passed: apply.
	a.Nonce++
	a.Balance -= t.Fee
	half := t.Fee / 2
	s.acct(s.Params.Fund).Balance += t.Fee - half
	if proposerAddr != "" {
		s.acct(proposerAddr).Balance += half
	} else {
		s.acct(s.Params.Fund).Balance += half
	}
	switch t.Type {
	case TxTransfer:
		a.Balance -= t.Amount
		s.acct(t.To).Balance += t.Amount
	case TxBurn:
		a.Balance -= t.Amount
		s.Supply -= t.Amount
	case TxActivity:
		if t.Amount > 0 {
			a.Balance -= t.Amount
			s.acct(t.To).Balance += t.Amount
		}
	case TxMint:
		s.acct(t.To).Balance += t.Amount
		s.Supply += t.Amount
	case TxName:
		n := strings.ToLower(t.Data)
		a.Balance -= s.Params.NameFee
		s.acct(s.Params.Fund).Balance += s.Params.NameFee
		if a.Name != "" {
			delete(s.Names, a.Name)
		}
		a.Name = n
		s.Names[n] = from
	case TxValidator:
		pk := strings.ToLower(t.Data)
		vals := s.Validators[:0:0]
		found := false
		for _, v := range s.Validators {
			if v.PubKey == pk {
				found = true
				if t.Power > 0 {
					vals = append(vals, Validator{pk, t.Power})
				}
				continue
			}
			vals = append(vals, v)
		}
		if !found && t.Power > 0 {
			vals = append(vals, Validator{pk, t.Power})
		}
		s.Validators = sortVals(vals)
	case TxOwner:
		s.Params.Owner = t.To
	}
	return nil
}

// Root: one hash of the whole state, so every node can prove it has exactly the same ledger.
func (s *State) Root() string {
	h := sha256.New()
	w := func(parts ...string) { h.Write([]byte(strings.Join(parts, "|") + "\n")) }
	w("chain", s.ChainID, strconv.FormatUint(s.Height, 10), strconv.FormatUint(s.Supply, 10))
	p, _ := json.Marshal(s.Params)
	w("params", string(p))
	keys := make([]string, 0, len(s.Accounts))
	for k, v := range s.Accounts {
		if v.Balance != 0 || v.Nonce != 0 || v.Name != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		a := s.Accounts[k]
		w("acct", k, strconv.FormatUint(a.Balance, 10), strconv.FormatUint(a.Nonce, 10), a.Name)
	}
	w("vals", ValRoot(s.Validators))
	return hex.EncodeToString(h.Sum(nil))
}

// ValRoot: hash of a validator set.
func ValRoot(vals []Validator) string {
	h := sha256.New()
	for _, v := range vals {
		h.Write([]byte(v.PubKey + ":" + strconv.FormatUint(v.Power, 10) + "\n"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func sortVals(v []Validator) []Validator {
	out := make([]Validator, len(v))
	for i, x := range v {
		out[i] = Validator{strings.ToLower(x.PubKey), x.Power}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PubKey < out[j].PubKey })
	return out
}

// ProposerAddress: where a validator's half of the fees goes (the address of its own key).
func ProposerAddress(pub string) string {
	b, err := decodeKey(pub, 32)
	if err != nil {
		return ""
	}
	return AddressOf(b)
}

// ApplyBlock checks and applies a whole block to a COPY of the state and returns the new state. The block is
// rejected if anything is off: wrong height or parent, a time going backwards, an invalid transaction, or roots that
// don't match what this node computes.
func (s *State) ApplyBlock(b *Block, nowMs int64) (*State, error) {
	h := &b.Header
	if h.ChainID != s.ChainID || h.Height != s.Height+1 || h.PrevHash != s.LastHash {
		return nil, errors.New("block does not follow this chain")
	}
	if h.Time <= s.LastTime || (nowMs > 0 && h.Time > nowMs+5000) {
		return nil, errors.New("block time out of range")
	}
	if len(b.Txs) != h.NumTxs || len(b.Txs) > MaxTxPerBlock {
		return nil, errors.New("wrong number of transactions")
	}
	if s.Proposer(h.Height, h.Round) != strings.ToLower(h.Proposer) {
		return nil, errors.New("not this round's proposer")
	}
	hashes := make([]string, len(b.Txs))
	for i := range b.Txs {
		hashes[i] = b.Txs[i].Hash(s.ChainID)
	}
	if MerkleRoot(hashes) != h.TxRoot {
		return nil, errors.New("tx root mismatch")
	}
	n := s.Copy()
	pa := ProposerAddress(h.Proposer)
	for i := range b.Txs {
		if err := n.ApplyTx(&b.Txs[i], pa); err != nil {
			return nil, fmt.Errorf("tx %d: %v", i, err)
		}
	}
	n.Height = h.Height
	n.LastHash = h.Hash()
	n.LastTime = h.Time
	if h.ValRoot != ValRoot(n.Validators) {
		return nil, errors.New("validator root mismatch")
	}
	if n.Root() != h.StateRoot {
		return nil, errors.New("state root mismatch")
	}
	return n, nil
}

// BuildBlock: the proposer packs valid transactions from the mempool into a new block on top of this state.
func (s *State) BuildBlock(round int, proposer string, nowMs int64, txs []Tx) (*Block, []Tx) {
	n := s.Copy()
	pa := ProposerAddress(proposer)
	var in, bad []Tx
	size := 0
	for _, t := range txs {
		if len(in) >= MaxTxPerBlock || size > MaxBlockBytes {
			break
		}
		t := t
		if err := n.ApplyTx(&t, pa); err != nil {
			bad = append(bad, t)
			continue
		}
		in = append(in, t)
		size += len(t.Data) + 300
	}
	tm := nowMs
	if tm <= s.LastTime {
		tm = s.LastTime + 1
	}
	hashes := make([]string, len(in))
	for i := range in {
		hashes[i] = in[i].Hash(s.ChainID)
	}
	n.Height = s.Height + 1
	h := Header{ChainID: s.ChainID, Height: s.Height + 1, Round: round, Time: tm, PrevHash: s.LastHash, TxRoot: MerkleRoot(hashes),
		ValRoot: ValRoot(n.Validators), Proposer: strings.ToLower(proposer), NumTxs: len(in)}
	n.LastHash = h.Hash() // not used for the root; set for completeness
	h.StateRoot = n.Root()
	if in == nil {
		in = []Tx{}
	}
	return &Block{Header: h, Txs: in}, bad
}
