// Package consensus is the AUTISTIK Chain's Byzantine-fault-tolerant consensus: a Tendermint-style protocol
// (propose → prevote → precommit, with locking). With n validators it stays safe while fewer than 1/3 of the voting
// power is faulty or malicious, and a block is FINAL the moment it's committed: no reorgs, no waiting for
// confirmations.
package consensus

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"autistik.io/chain/core"
)

const (
	StepPropose   = 0
	StepPrevote   = 1
	StepPrecommit = 2
)

var stepName = map[int]string{StepPrevote: "prevote", StepPrecommit: "precommit"}

type Proposal struct {
	Height   uint64     `json:"height"`
	Round    int        `json:"round"`
	POLRound int        `json:"pol_round"` // -1, or the round where this block got 2/3 prevotes (re-proposal)
	Block    core.Block `json:"block"`
	Sig      string     `json:"sig"`
}

type Vote struct {
	Height    uint64 `json:"height"`
	Round     int    `json:"round"`
	Step      string `json:"step"`       // "prevote" | "precommit"
	BlockHash string `json:"block_hash"` // "" = nil vote
	Validator string `json:"validator"`
	Sig       string `json:"sig"`
}

type Msg struct {
	Proposal *Proposal `json:"proposal,omitempty"`
	Vote     *Vote     `json:"vote,omitempty"`
}

// Config: timings. Defaults give ~1 second blocks on a healthy network.
type Config struct {
	ProposeTimeout   time.Duration
	VoteTimeout      time.Duration
	BlockInterval    time.Duration // pause after a commit before the next height
	EmptyBlocks      bool          // make blocks even with no transactions (keeps time moving; on by default)
}

func DefaultConfig() Config {
	return Config{ProposeTimeout: 1200 * time.Millisecond, VoteTimeout: 600 * time.Millisecond, BlockInterval: 800 * time.Millisecond, EmptyBlocks: true}
}

// Hooks: how the engine talks to the node around it.
type Hooks struct {
	Broadcast func(Msg)                              // send to all peers
	Mempool   func() []core.Tx                       // pending transactions, in order
	OnCommit  func(st core.Stored, next *core.State) // a block became final
	Now       func() int64                           // unix ms
}

type Engine struct {
	mu    sync.Mutex
	cfg   Config
	hooks Hooks
	key   ed25519.PrivateKey
	pub   string // "" if this node is not a validator (it still follows and syncs)
	store *core.Store
	state *core.State // last committed state
	dir   string

	height      uint64
	round       int
	step        int
	lockedRound int
	lockedBlock *core.Block
	validRound  int
	validBlock  *core.Block

	proposals map[int]*Proposal                   // round -> proposal (current height)
	blocks    map[string]*core.Block              // hash -> block seen this height
	verdict   map[string]error                    // hash -> validation result (cached)
	votes     map[int]map[string]map[string]*Vote // round -> step -> validator -> vote
	fired     map[string]bool                     // timeouts already scheduled
	mine      []Msg                               // my messages this height (re-sent so a lost packet doesn't stall)

	last   signed // anti double-sign record, kept on disk
	closed bool
}

type signed struct {
	Height uint64 `json:"height"`
	Round  int    `json:"round"`
	Step   int    `json:"step"`
	Hash   string `json:"hash"`
}

func New(cfg Config, h Hooks, key ed25519.PrivateKey, st *core.State, store *core.Store, dir string) (*Engine, error) {
	e := &Engine{cfg: cfg, hooks: h, key: key, store: store, state: st, dir: dir}
	if key != nil {
		e.pub = hex.EncodeToString(key.Public().(ed25519.PublicKey))
	}
	if b, err := os.ReadFile(filepath.Join(dir, "signed.json")); err == nil {
		if err := json.Unmarshal(b, &e.last); err != nil {
			return nil, fmt.Errorf("signed.json is damaged; refusing to start so the validator can't double-sign: %w", err)
		}
	}
	e.resetHeight()
	return e, nil
}

// Start begins (or resumes) consensus at the next height.
func (e *Engine) Start() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.startRound(0)
	go e.resendLoop()
}

func (e *Engine) Stop() { e.mu.Lock(); e.closed = true; e.mu.Unlock() }

func (e *Engine) resetHeight() {
	e.height = e.state.Height + 1
	e.round, e.step = 0, StepPropose
	e.lockedRound, e.lockedBlock, e.validRound, e.validBlock = -1, nil, -1, nil
	e.proposals = map[int]*Proposal{}
	e.blocks = map[string]*core.Block{}
	e.verdict = map[string]error{}
	e.votes = map[int]map[string]map[string]*Vote{}
	e.fired = map[string]bool{}
	e.mine = nil
}

// Status for the RPC.
func (e *Engine) Status() (height uint64, round int, step int, state *core.State) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.height, e.round, e.step, e.state
}

// ---------------------------------------------------------------- signing (never twice for the same slot)

func stepOrder(h uint64, r int, s int) [3]int64 { return [3]int64{int64(h), int64(r), int64(s)} }

func less(a, b [3]int64) bool {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

// sign signs msg for (height, round, step) only if this validator has never signed something different there.
// The record is written to disk BEFORE the signature leaves the node, so even a crash can't cause a double-sign.
func (e *Engine) sign(h uint64, r int, step int, hash string, msg []byte) (string, error) {
	if e.key == nil {
		return "", errors.New("not a validator")
	}
	cur, prev := stepOrder(h, r, step), stepOrder(e.last.Height, e.last.Round, e.last.Step)
	if less(cur, prev) || (cur == prev && e.last.Hash != hash) {
		return "", fmt.Errorf("refusing to double-sign at %d/%d/%d", h, r, step)
	}
	e.last = signed{h, r, step, hash}
	b, _ := json.Marshal(e.last)
	tmp := filepath.Join(e.dir, "signed.json.tmp")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	f.Write(b)
	f.Sync()
	f.Close()
	if err := os.Rename(tmp, filepath.Join(e.dir, "signed.json")); err != nil {
		return "", err
	}
	return hex.EncodeToString(ed25519.Sign(e.key, msg)), nil
}

// ---------------------------------------------------------------- rounds

func (e *Engine) proposeTimeout(r int) time.Duration {
	return e.cfg.ProposeTimeout + time.Duration(r)*e.cfg.ProposeTimeout/2
}
func (e *Engine) voteTimeout(r int) time.Duration {
	return e.cfg.VoteTimeout + time.Duration(r)*e.cfg.VoteTimeout/2
}

func (e *Engine) after(d time.Duration, h uint64, r int, step int) {
	time.AfterFunc(d, func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		if e.closed || h != e.height {
			return
		}
		e.onTimeout(r, step)
	})
}

func (e *Engine) startRound(r int) {
	e.round, e.step = r, StepPropose
	h := e.height
	if e.pub != "" && e.state.Proposer(h, r) == e.pub {
		var b *core.Block
		pol := -1
		if e.validBlock != nil {
			b, pol = e.validBlock, e.validRound
		} else {
			txs := e.hooks.Mempool()
			b, _ = e.state.BuildBlock(r, e.pub, e.hooks.Now(), txs)
		}
		hash := b.Header.Hash()
		sig, err := e.sign(h, r, StepPropose, hash, core.ProposalSignBytes(e.state.ChainID, h, r, pol, hash))
		if err == nil {
			p := &Proposal{Height: h, Round: r, POLRound: pol, Block: *b, Sig: sig}
			e.mine = append(e.mine, Msg{Proposal: p})
			e.hooks.Broadcast(Msg{Proposal: p})
			e.addProposal(p)
		} else {
			log.Printf("propose: %v", err)
		}
	}
	e.after(e.proposeTimeout(r), h, r, StepPropose)
	e.process()
}

func (e *Engine) onTimeout(r int, step int) {
	if r != e.round {
		return
	}
	switch {
	case step == StepPropose && e.step == StepPropose:
		e.castVote(r, StepPrevote, "")
		e.step = StepPrevote
	case step == StepPrevote && e.step == StepPrevote:
		e.castVote(r, StepPrecommit, "")
		e.step = StepPrecommit
	case step == StepPrecommit:
		e.startRound(r + 1)
		return
	}
	e.process()
}

func (e *Engine) castVote(r int, step int, hash string) {
	if e.pub == "" || e.state.Power(e.pub) == 0 {
		return
	}
	sig, err := e.sign(e.height, r, step, hash, core.VoteSignBytes(e.state.ChainID, e.height, r, stepName[step], hash))
	if err != nil {
		log.Printf("vote: %v", err)
		return
	}
	v := &Vote{Height: e.height, Round: r, Step: stepName[step], BlockHash: hash, Validator: e.pub, Sig: sig}
	e.mine = append(e.mine, Msg{Vote: v})
	e.hooks.Broadcast(Msg{Vote: v})
	e.addVote(v)
}

// ---------------------------------------------------------------- incoming messages

// Handle a message from a peer. Returns true if the sender is ahead of us (the node should sync).
func (e *Engine) Handle(m Msg) (ahead bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return false
	}
	switch {
	case m.Proposal != nil:
		if m.Proposal.Height > e.height {
			return true
		}
		if m.Proposal.Height == e.height && e.checkProposal(m.Proposal) == nil {
			e.addProposal(m.Proposal)
		}
	case m.Vote != nil:
		if m.Vote.Height > e.height {
			return true
		}
		if m.Vote.Height == e.height && e.checkVote(m.Vote) == nil {
			e.addVote(m.Vote)
		}
	}
	e.process()
	return false
}

func (e *Engine) checkProposal(p *Proposal) error {
	want := e.state.Proposer(p.Height, p.Round)
	if want == "" || p.Round < 0 || p.POLRound >= p.Round {
		return errors.New("bad proposal")
	}
	pk, err := hex.DecodeString(want)
	sig, err2 := hex.DecodeString(p.Sig)
	if err != nil || err2 != nil {
		return errors.New("bad proposal encoding")
	}
	if !ed25519.Verify(pk, core.ProposalSignBytes(e.state.ChainID, p.Height, p.Round, p.POLRound, p.Block.Header.Hash()), sig) {
		return errors.New("proposal not signed by this round's proposer")
	}
	return nil
}

func (e *Engine) checkVote(v *Vote) error {
	if v.Step != "prevote" && v.Step != "precommit" {
		return errors.New("bad step")
	}
	if e.state.Power(v.Validator) == 0 {
		return errors.New("not a validator")
	}
	pk, err := hex.DecodeString(strings.ToLower(v.Validator))
	sig, err2 := hex.DecodeString(v.Sig)
	if err != nil || err2 != nil || len(pk) != 32 {
		return errors.New("bad vote encoding")
	}
	if !ed25519.Verify(pk, core.VoteSignBytes(e.state.ChainID, v.Height, v.Round, v.Step, v.BlockHash), sig) {
		return errors.New("bad vote signature")
	}
	return nil
}

func (e *Engine) addProposal(p *Proposal) {
	if _, ok := e.proposals[p.Round]; ok {
		return
	}
	e.proposals[p.Round] = p
	b := p.Block
	e.blocks[b.Header.Hash()] = &b
}

func (e *Engine) addVote(v *Vote) {
	byStep := e.votes[v.Round]
	if byStep == nil {
		byStep = map[string]map[string]*Vote{}
		e.votes[v.Round] = byStep
	}
	m := byStep[v.Step]
	if m == nil {
		m = map[string]*Vote{}
		byStep[v.Step] = m
	}
	if old, ok := m[strings.ToLower(v.Validator)]; ok {
		if old.BlockHash != v.BlockHash {
			log.Printf("⚠ equivocation: validator %s voted twice at %d/%d %s", v.Validator[:12], v.Height, v.Round, v.Step)
		}
		return
	}
	m[strings.ToLower(v.Validator)] = v
}

// tally: power voting for each hash at (round, step), and the total.
func (e *Engine) tally(r int, step string) (map[string]uint64, uint64) {
	out := map[string]uint64{}
	var all uint64
	for val, v := range e.votes[r][step] {
		p := e.state.Power(val)
		out[v.BlockHash] += p
		all += p
	}
	return out, all
}

func (e *Engine) twoThirds(p uint64) bool { return p*3 > e.state.TotalPower()*2 }
func (e *Engine) oneThird(p uint64) bool  { return p*3 > e.state.TotalPower() }

func (e *Engine) valid(hash string) bool {
	if err, ok := e.verdict[hash]; ok {
		return err == nil
	}
	b := e.blocks[hash]
	if b == nil {
		return false
	}
	if !e.cfg.EmptyBlocks && len(b.Txs) == 0 {
		// still valid; the option only affects what this node proposes
	}
	_, err := e.state.ApplyBlock(b, e.hooks.Now())
	e.verdict[hash] = err
	if err != nil {
		log.Printf("rejecting block %s at %d: %v", hash[:12], e.height, err)
	}
	return err == nil
}

// process applies the consensus rules until nothing more changes.
func (e *Engine) process() {
	for i := 0; i < 8; i++ {
		if !e.step1() {
			return
		}
	}
}

func (e *Engine) step1() bool {
	r := e.round
	// Commit: 2/3+ precommits for a block we have, in any round.
	for round := range e.votes {
		t, _ := e.tally(round, "precommit")
		for hash, p := range t {
			if hash != "" && e.twoThirds(p) && e.blocks[hash] != nil && e.valid(hash) {
				e.commit(round, hash)
				return false
			}
		}
	}
	// Jump ahead: more than 1/3 of the power is already in a later round.
	for round := range e.votes {
		if round > r {
			_, a := e.tally(round, "prevote")
			_, b := e.tally(round, "precommit")
			if e.oneThird(a + b) {
				e.startRound(round)
				return true
			}
		}
	}
	prop := e.proposals[r]
	// Prevote on this round's proposal.
	if e.step == StepPropose && prop != nil {
		hash := prop.Block.Header.Hash()
		vote := ""
		if prop.POLRound < 0 {
			if e.valid(hash) && (e.lockedRound < 0 || e.lockedBlock.Header.Hash() == hash) {
				vote = hash
			}
		} else {
			t, _ := e.tally(prop.POLRound, "prevote")
			if e.twoThirds(t[hash]) && e.valid(hash) && (e.lockedRound <= prop.POLRound || e.lockedBlock.Header.Hash() == hash) {
				vote = hash
			}
		}
		e.castVote(r, StepPrevote, vote)
		e.step = StepPrevote
		return true
	}
	t, all := e.tally(r, "prevote")
	if e.step >= StepPrevote && e.twoThirds(all) && !e.fired[fmt.Sprint("pv", r)] {
		e.fired[fmt.Sprint("pv", r)] = true
		e.after(e.voteTimeout(r), e.height, r, StepPrevote)
	}
	// 2/3 prevotes for this round's block: lock it and precommit.
	if prop != nil && e.step >= StepPrevote {
		hash := prop.Block.Header.Hash()
		if e.twoThirds(t[hash]) && e.valid(hash) && !e.fired[fmt.Sprint("lock", r)] {
			e.fired[fmt.Sprint("lock", r)] = true
			b := prop.Block
			if e.step == StepPrevote {
				e.lockedRound, e.lockedBlock = r, &b
				e.castVote(r, StepPrecommit, hash)
				e.step = StepPrecommit
			}
			e.validRound, e.validBlock = r, &b
			return true
		}
	}
	// 2/3 prevotes for nil: precommit nil.
	if e.step == StepPrevote && e.twoThirds(t[""]) {
		e.castVote(r, StepPrecommit, "")
		e.step = StepPrecommit
		return true
	}
	_, pcAll := e.tally(r, "precommit")
	if e.twoThirds(pcAll) && !e.fired[fmt.Sprint("pc", r)] {
		e.fired[fmt.Sprint("pc", r)] = true
		e.after(e.voteTimeout(r), e.height, r, StepPrecommit)
	}
	return false
}

func (e *Engine) commit(round int, hash string) {
	b := e.blocks[hash]
	next, err := e.state.ApplyBlock(b, 0)
	if err != nil {
		log.Printf("commit failed (should not happen): %v", err)
		return
	}
	c := core.Commit{Height: e.height, Round: round, BlockHash: hash}
	keys := make([]string, 0)
	for val, v := range e.votes[round]["precommit"] {
		if v.BlockHash == hash {
			keys = append(keys, val)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		c.Sigs = append(c.Sigs, core.CommitSig{Validator: k, Sig: e.votes[round]["precommit"][k].Sig})
	}
	st := core.Stored{Block: *b, Commit: c}
	if err := e.store.Append(st, e.state.ChainID); err != nil {
		log.Printf("could not save block %d: %v", e.height, err)
		return
	}
	e.state = next
	e.hooks.OnCommit(st, next)
	e.resetHeight()
	h := e.height
	time.AfterFunc(e.cfg.BlockInterval, func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		if !e.closed && e.height == h && e.round == 0 && e.step == StepPropose && len(e.proposals) == 0 {
			e.startRound(0)
		} else if !e.closed && e.height == h {
			e.process()
		}
	})
}

// ApplySynced adds a final block fetched from a peer (catching up). Its commit is checked against our current
// validator set, so a peer can't feed us a fake chain.
func (e *Engine) ApplySynced(st core.Stored) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if st.Block.Header.Height != e.state.Height+1 {
		return errors.New("not the next block")
	}
	hash := st.Block.Header.Hash()
	if err := core.VerifyCommit(e.state, &st.Commit, hash); err != nil {
		return err
	}
	next, err := e.state.ApplyBlock(&st.Block, 0)
	if err != nil {
		return err
	}
	if err := e.store.Append(st, e.state.ChainID); err != nil {
		return err
	}
	e.state = next
	e.hooks.OnCommit(st, next)
	e.resetHeight()
	e.startRound(0)
	return nil
}

// resendLoop re-broadcasts this node's own messages for the current height every second, so one lost packet can
// never stall the chain.
func (e *Engine) resendLoop() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		e.mu.Lock()
		if e.closed {
			e.mu.Unlock()
			return
		}
		msgs := append([]Msg(nil), e.mine...)
		e.mu.Unlock()
		for _, m := range msgs {
			e.hooks.Broadcast(m)
		}
	}
}
