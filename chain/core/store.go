package core

import (
	"bufio"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// VerifyCommit checks that a commit carries valid precommit signatures from validators (of the state BEFORE the
// block) holding more than 2/3 of the voting power. This is what makes a block final: no node will ever accept a
// different block at the same height.
func VerifyCommit(prev *State, c *Commit, blockHash string) error {
	if c == nil || c.BlockHash != blockHash || c.Height != prev.Height+1 {
		return errors.New("commit is for a different block")
	}
	total, got := prev.TotalPower(), uint64(0)
	seen := map[string]bool{}
	msg := VoteSignBytes(prev.ChainID, c.Height, c.Round, "precommit", blockHash)
	for _, s := range c.Sigs {
		pk := strings.ToLower(s.Validator)
		if seen[pk] {
			continue
		}
		p := prev.Power(pk)
		if p == 0 {
			continue
		}
		pkb, err1 := hex.DecodeString(pk)
		sig, err2 := hex.DecodeString(s.Sig)
		if err1 != nil || err2 != nil || len(pkb) != 32 || !ed25519.Verify(pkb, msg, sig) {
			continue
		}
		seen[pk] = true
		got += p
	}
	if got*3 <= total*2 {
		return fmt.Errorf("commit has %d of %d voting power, needs more than 2/3", got, total)
	}
	return nil
}

// Stored: one final block with its commit, one per line in blocks.jsonl.
type Stored struct {
	Block  Block  `json:"block"`
	Commit Commit `json:"commit"`
}

// Store keeps the chain on disk (append-only, so a crash can at worst lose the last unfinished line) and in memory
// for fast reads, plus indexes for transactions and activity.
type Store struct {
	mu      sync.RWMutex
	dir     string
	f       *os.File
	blocks  []Stored          // index = height-1
	txIndex map[string][2]int // tx hash -> (height, position)
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, txIndex: map[string][2]int{}}
	path := filepath.Join(dir, "blocks.jsonl")
	if r, err := os.Open(path); err == nil {
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 1<<20), 64<<20)
		for sc.Scan() {
			var st Stored
			if err := json.Unmarshal(sc.Bytes(), &st); err != nil {
				break // a half-written last line after a crash: ignore it
			}
			s.blocks = append(s.blocks, st)
		}
		r.Close()
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	s.f = f
	return s, nil
}

// Blocks already on disk (used once at start to rebuild the state).
func (s *Store) All() []Stored { s.mu.RLock(); defer s.mu.RUnlock(); return s.blocks }

// Truncate drops blocks from height h on (used if a stored block fails to replay, e.g. a crash mid-write).
func (s *Store) Truncate(h uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if h == 0 || int(h-1) >= len(s.blocks) {
		return nil
	}
	s.blocks = s.blocks[:h-1]
	s.f.Close()
	path := filepath.Join(s.dir, "blocks.jsonl")
	tmp := path + ".tmp"
	w, err := os.Create(tmp)
	if err != nil {
		return err
	}
	for _, b := range s.blocks {
		j, _ := json.Marshal(b)
		w.Write(append(j, '\n'))
	}
	w.Sync()
	w.Close()
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	s.f, err = os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	return err
}

// Index builds the tx index for a block that's in memory (after replay or append).
func (s *Store) index(st *Stored, chainID string) {
	for i := range st.Block.Txs {
		s.txIndex[st.Block.Txs[i].Hash(chainID)] = [2]int{int(st.Block.Header.Height), i}
	}
}

func (s *Store) Reindex(chainID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.txIndex = map[string][2]int{}
	for i := range s.blocks {
		s.index(&s.blocks[i], chainID)
	}
}

// Append writes a final block to disk (fsync'd before it counts) and to memory.
func (s *Store) Append(st Stored, chainID string) error {
	j, err := json.Marshal(st)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if uint64(len(s.blocks)+1) != st.Block.Header.Height {
		return errors.New("store: height gap")
	}
	if _, err := s.f.Write(append(j, '\n')); err != nil {
		return err
	}
	if err := s.f.Sync(); err != nil {
		return err
	}
	s.blocks = append(s.blocks, st)
	s.index(&s.blocks[len(s.blocks)-1], chainID)
	return nil
}

func (s *Store) Height() uint64 { s.mu.RLock(); defer s.mu.RUnlock(); return uint64(len(s.blocks)) }

func (s *Store) Get(h uint64) (Stored, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if h == 0 || h > uint64(len(s.blocks)) {
		return Stored{}, false
	}
	return s.blocks[h-1], true
}

// Range returns up to n blocks ending at height `to` (newest first).
func (s *Store) Range(to uint64, n int) []Stored {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if to == 0 || to > uint64(len(s.blocks)) {
		to = uint64(len(s.blocks))
	}
	var out []Stored
	for h := to; h >= 1 && len(out) < n; h-- {
		out = append(out, s.blocks[h-1])
	}
	return out
}

// FindTx: the transaction, its block height and position.
func (s *Store) FindTx(hash string) (*Tx, uint64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	loc, ok := s.txIndex[strings.ToLower(hash)]
	if !ok {
		return nil, 0, false
	}
	t := s.blocks[loc[0]-1].Block.Txs[loc[1]]
	return &t, uint64(loc[0]), true
}

func (s *Store) Close() error { return s.f.Close() }
