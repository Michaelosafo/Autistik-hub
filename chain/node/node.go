// Package node wires the chain together: consensus, the transaction pool, peer-to-peer messages, catching up from
// peers, and the public HTTP API (RPC) that wallets, the explorer and the AUTISTIK admin panel use.
package node

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"autistik.io/chain/consensus"
	"autistik.io/chain/core"
)

type Config struct {
	Dir       string
	Listen    string   // e.g. ":26657"
	Peers     []string // other nodes' base URLs, e.g. https://val2.autistik.io
	PeerToken string   // shared secret for /p2p (stops strangers spamming consensus traffic; votes are signed anyway)
	TxRate    float64  // transactions per second allowed from one IP (burst 5x); 0 = no limit (test networks only)
	Consensus consensus.Config
}

type Node struct {
	cfg     Config
	genesis *core.Genesis
	store   *core.Store
	eng     *consensus.Engine
	client  *http.Client

	mu      sync.Mutex
	state   *core.State
	pool    map[string]core.Tx // hash -> tx
	order   []string           // arrival order
	recent  []Activity         // newest last, capped
	started time.Time
	syncing bool
	limits  map[string]*bucket // per-IP tx rate limit
}

// Activity: one line of the chain's activity feed (every transaction is an activity).
type Activity struct {
	Height uint64 `json:"height"`
	Time   int64  `json:"time"`
	Hash   string `json:"hash"`
	Type   string `json:"type"`
	Kind   string `json:"kind,omitempty"`
	From   string `json:"from"`
	To     string `json:"to,omitempty"`
	Amount uint64 `json:"amount,omitempty"`
	Fee    uint64 `json:"fee"`
	Data   string `json:"data,omitempty"`
}

const recentCap = 20000

func New(cfg Config, g *core.Genesis, key ed25519.PrivateKey) (*Node, error) {
	st, err := core.NewState(g)
	if err != nil {
		return nil, err
	}
	store, err := core.OpenStore(cfg.Dir)
	if err != nil {
		return nil, err
	}
	n := &Node{cfg: cfg, genesis: g, store: store, state: st, pool: map[string]core.Tx{}, started: time.Now(), limits: map[string]*bucket{},
		client: &http.Client{Timeout: 4 * time.Second}}
	// Rebuild the state by replaying every stored block and checking its commit (a tampered file is caught here).
	for _, b := range store.All() {
		hash := b.Block.Header.Hash()
		if err := core.VerifyCommit(n.state, &b.Commit, hash); err != nil {
			log.Printf("stored block %d has a bad commit (%v); dropping it and everything after", b.Block.Header.Height, err)
			store.Truncate(b.Block.Header.Height)
			break
		}
		next, err := n.state.ApplyBlock(&b.Block, 0)
		if err != nil {
			log.Printf("stored block %d does not replay (%v); dropping it and everything after", b.Block.Header.Height, err)
			store.Truncate(b.Block.Header.Height)
			break
		}
		n.state = next
		n.remember(b)
	}
	store.Reindex(g.ChainID)
	log.Printf("chain %s at height %d", g.ChainID, n.state.Height)
	eng, err := consensus.New(cfg.Consensus, consensus.Hooks{
		Broadcast: n.broadcast,
		Mempool:   n.pending,
		OnCommit:  n.onCommit,
		Now:       func() int64 { return time.Now().UnixMilli() },
	}, key, n.state, store, cfg.Dir)
	if err != nil {
		return nil, err
	}
	n.eng = eng
	return n, nil
}

func (n *Node) Start() error {
	n.eng.Start()
	go n.syncLoop()
	srv := &http.Server{Addr: n.cfg.Listen, Handler: n.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, MaxHeaderBytes: 1 << 16}
	log.Printf("RPC and P2P listening on %s", n.cfg.Listen)
	return srv.ListenAndServe()
}

// ---------------------------------------------------------------- mempool

func (n *Node) pending() []core.Tx {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := make([]core.Tx, 0, len(n.order))
	for _, h := range n.order {
		if t, ok := n.pool[h]; ok {
			out = append(out, t)
		}
	}
	// Each sender's transactions in nonce order (stable, so arrival order is kept otherwise).
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].PubKey == out[j].PubKey {
			return out[i].Nonce < out[j].Nonce
		}
		return false
	})
	return out
}

// Submit checks a transaction against the latest state (signature, nonce not already used, enough balance for
// at least the fee) and adds it to the pool. It is also passed on to peers so any validator can include it.
func (n *Node) Submit(t core.Tx, gossip bool) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := t.VerifySig(n.state.ChainID); err != nil {
		return "", err
	}
	if len(n.pool) >= core.MaxMempool {
		return "", errors.New("the network is busy; try again in a moment")
	}
	from, _ := t.From()
	acct := n.state.Accounts[from]
	var nonce, bal uint64
	if acct != nil {
		nonce, bal = acct.Nonce, acct.Balance
	}
	if t.Nonce < nonce {
		return "", fmt.Errorf("nonce %d already used (next is %d)", t.Nonce, nonce)
	}
	if t.Nonce > nonce+64 {
		return "", errors.New("nonce too far ahead")
	}
	if t.Fee < n.state.Params.MinFee || bal < t.Fee {
		return "", errors.New("fee too low or balance too low for the fee")
	}
	// Owner-only actions from anyone else are refused straight away (they could never be included anyway).
	if (t.Type == core.TxMint || t.Type == core.TxValidator || t.Type == core.TxOwner) && from != n.state.Params.Owner {
		return "", errors.New("only the chain owner can do that")
	}
	h := t.Hash(n.state.ChainID)
	if _, ok := n.pool[h]; ok {
		return h, nil
	}
	n.pool[h] = t
	n.order = append(n.order, h)
	if gossip {
		go n.sendAll("/p2p/tx", t)
	}
	return h, nil
}

// nextNonce: the nonce a new transaction from this address should use, counting ones still waiting in the pool
// (so several transactions can be sent back to back).
func (n *Node) nextNonce(addr string, base uint64) uint64 {
	n.mu.Lock()
	defer n.mu.Unlock()
	next := base
	for {
		found := false
		for _, t := range n.pool {
			if f, _ := t.From(); f == addr && t.Nonce == next {
				found = true
				break
			}
		}
		if !found {
			return next
		}
		next++
	}
}

func (n *Node) onCommit(st core.Stored, next *core.State) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.state = next
	for i := range st.Block.Txs {
		delete(n.pool, st.Block.Txs[i].Hash(next.ChainID))
	}
	// Drop pool entries whose nonce is now used.
	keep := n.order[:0]
	for _, h := range n.order {
		t, ok := n.pool[h]
		if !ok {
			continue
		}
		from, _ := t.From()
		if a := next.Accounts[from]; a != nil && t.Nonce < a.Nonce {
			delete(n.pool, h)
			continue
		}
		keep = append(keep, h)
	}
	n.order = keep
	n.remember(st)
	if st.Block.Header.NumTxs > 0 || st.Block.Header.Height%50 == 0 {
		log.Printf("✔ block %d final: %d txs, round %d", st.Block.Header.Height, st.Block.Header.NumTxs, st.Commit.Round)
	}
}

func (n *Node) remember(st core.Stored) {
	for i := range st.Block.Txs {
		t := &st.Block.Txs[i]
		from, _ := t.From()
		data := t.Data
		if t.Type == core.TxValidator {
			data = "validator " + t.Data[:12] + "… power " + strconv.FormatUint(t.Power, 10)
		}
		n.recent = append(n.recent, Activity{Height: st.Block.Header.Height, Time: st.Block.Header.Time, Hash: t.Hash(n.genesis.ChainID), Type: t.Type, Kind: t.Kind, From: from, To: t.To, Amount: t.Amount, Fee: t.Fee, Data: data})
	}
	if len(n.recent) > recentCap {
		n.recent = append([]Activity(nil), n.recent[len(n.recent)-recentCap:]...)
	}
}

// ---------------------------------------------------------------- peers

func (n *Node) broadcast(m consensus.Msg) { go n.sendAll("/p2p/msg", m) }

func (n *Node) sendAll(path string, v any) {
	b, _ := json.Marshal(v)
	for _, p := range n.cfg.Peers {
		go func(p string) {
			req, err := http.NewRequest("POST", strings.TrimRight(p, "/")+path, bytes.NewReader(b))
			if err != nil {
				return
			}
			req.Header.Set("content-type", "application/json")
			req.Header.Set("x-peer-token", n.cfg.PeerToken)
			res, err := n.client.Do(req)
			if err == nil {
				io.Copy(io.Discard, res.Body)
				res.Body.Close()
			}
		}(p)
	}
}

// syncLoop: every 2 seconds, if a peer is ahead, fetch the missing final blocks and check each one's commit.
func (n *Node) syncLoop() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for range t.C {
		n.catchUp()
	}
}

func (n *Node) catchUp() {
	n.mu.Lock()
	if n.syncing {
		n.mu.Unlock()
		return
	}
	n.syncing = true
	n.mu.Unlock()
	defer func() { n.mu.Lock(); n.syncing = false; n.mu.Unlock() }()
	for _, p := range n.cfg.Peers {
		var st struct {
			Height uint64 `json:"height"`
		}
		if err := n.getJSON(p+"/status", &st); err != nil {
			continue
		}
		for n.store.Height() < st.Height {
			var b core.Stored
			if err := n.getJSON(fmt.Sprintf("%s/block/%d", p, n.store.Height()+1), &b); err != nil {
				break
			}
			if err := n.eng.ApplySynced(b); err != nil {
				log.Printf("sync from %s stopped: %v", p, err)
				break
			}
		}
	}
}

func (n *Node) getJSON(url string, v any) error {
	res, err := n.client.Get(strings.TrimRight(url, "/"))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("%s: %d", url, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(v)
}

// ---------------------------------------------------------------- HTTP

type bucket struct {
	tokens float64
	at     time.Time
}

// allow: rate limit per IP (TxRate per second, bursts of 5x).
func (n *Node) allow(ip string) bool {
	if n.cfg.TxRate <= 0 {
		return true
	}
	rate, burst := n.cfg.TxRate, n.cfg.TxRate*5
	n.mu.Lock()
	defer n.mu.Unlock()
	b := n.limits[ip]
	now := time.Now()
	if b == nil {
		b = &bucket{tokens: burst, at: now}
		n.limits[ip] = b
	}
	b.tokens += now.Sub(b.at).Seconds() * rate
	if b.tokens > burst {
		b.tokens = burst
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	if len(n.limits) > 50000 {
		n.limits = map[string]*bucket{}
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) { writeJSON(w, code, map[string]string{"error": msg}) }

func clientIP(r *http.Request) string {
	if f := r.Header.Get("x-forwarded-for"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return h
}

func (n *Node) routes() http.Handler {
	mux := http.NewServeMux()
	peerOK := func(r *http.Request) bool { return n.cfg.PeerToken == "" || r.Header.Get("x-peer-token") == n.cfg.PeerToken }

	// --- peer-to-peer
	mux.HandleFunc("POST /p2p/msg", func(w http.ResponseWriter, r *http.Request) {
		if !peerOK(r) {
			fail(w, 403, "not a peer")
			return
		}
		var m consensus.Msg
		if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&m); err != nil {
			fail(w, 400, "bad message")
			return
		}
		if n.eng.Handle(m) {
			go n.catchUp()
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /p2p/tx", func(w http.ResponseWriter, r *http.Request) {
		if !peerOK(r) {
			fail(w, 403, "not a peer")
			return
		}
		var t core.Tx
		if json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&t) == nil {
			n.Submit(t, false)
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	// --- public RPC
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		h, round, step, st := n.eng.Status()
		n.mu.Lock()
		pool := len(n.pool)
		n.mu.Unlock()
		last, _ := n.store.Get(st.Height)
		writeJSON(w, 200, map[string]any{"chain_id": st.ChainID, "height": st.Height, "working_on": h, "round": round, "step": step,
			"last_hash": st.LastHash, "last_time": st.LastTime, "last_txs": last.Block.Header.NumTxs, "supply": st.Supply, "decimals": core.Decimals,
			"validators": len(st.Validators), "total_power": st.TotalPower(), "mempool": pool, "peers": len(n.cfg.Peers),
			"owner": st.Params.Owner, "fund": st.Params.Fund, "min_fee": st.Params.MinFee, "max_supply": st.Params.MaxSupply,
			"uptime_s": int(time.Since(n.started).Seconds())})
	})
	mux.HandleFunc("GET /block/{h}", func(w http.ResponseWriter, r *http.Request) {
		h, err := strconv.ParseUint(r.PathValue("h"), 10, 64)
		b, ok := n.store.Get(h)
		if err != nil || !ok {
			fail(w, 404, "no such block")
			return
		}
		writeJSON(w, 200, b)
	})
	mux.HandleFunc("GET /blocks", func(w http.ResponseWriter, r *http.Request) {
		to, _ := strconv.ParseUint(r.URL.Query().Get("to"), 10, 64)
		lim, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if lim <= 0 || lim > 100 {
			lim = 20
		}
		var out []map[string]any
		for _, b := range n.store.Range(to, lim) {
			out = append(out, map[string]any{"height": b.Block.Header.Height, "hash": b.Block.Header.Hash(), "time": b.Block.Header.Time, "txs": b.Block.Header.NumTxs,
				"proposer": b.Block.Header.Proposer, "round": b.Commit.Round, "signers": len(b.Commit.Sigs)})
		}
		writeJSON(w, 200, map[string]any{"blocks": out})
	})
	mux.HandleFunc("GET /tx/{hash}", func(w http.ResponseWriter, r *http.Request) {
		t, h, ok := n.store.FindTx(r.PathValue("hash"))
		if !ok {
			n.mu.Lock()
			_, pending := n.pool[strings.ToLower(r.PathValue("hash"))]
			n.mu.Unlock()
			if pending {
				writeJSON(w, 200, map[string]any{"status": "pending"})
				return
			}
			fail(w, 404, "not found")
			return
		}
		writeJSON(w, 200, map[string]any{"status": "final", "height": h, "tx": t})
	})
	mux.HandleFunc("GET /account/{addr}", func(w http.ResponseWriter, r *http.Request) {
		a := strings.ToLower(r.PathValue("addr"))
		n.mu.Lock()
		st := n.state
		n.mu.Unlock()
		if strings.HasPrefix(a, "@") {
			a = st.Names[strings.TrimPrefix(a, "@")]
		}
		if !core.ValidAddress(a) {
			fail(w, 400, "bad address")
			return
		}
		acct := st.Accounts[a]
		if acct == nil {
			acct = &core.Account{}
		}
		writeJSON(w, 200, map[string]any{"address": a, "balance": acct.Balance, "nonce": acct.Nonce, "next_nonce": n.nextNonce(a, acct.Nonce), "name": acct.Name})
	})
	mux.HandleFunc("GET /validators", func(w http.ResponseWriter, r *http.Request) {
		_, _, _, st := n.eng.Status()
		var out []map[string]any
		for _, v := range st.Validators {
			out = append(out, map[string]any{"pubkey": v.PubKey, "power": v.Power, "address": core.ProposerAddress(v.PubKey)})
		}
		writeJSON(w, 200, map[string]any{"validators": out, "total_power": st.TotalPower()})
	})
	mux.HandleFunc("GET /activity", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		kind, typ, addr := q.Get("kind"), q.Get("type"), strings.ToLower(q.Get("address"))
		lim, _ := strconv.Atoi(q.Get("limit"))
		if lim <= 0 || lim > 500 {
			lim = 50
		}
		n.mu.Lock()
		var out []Activity
		counts := map[string]int{}
		for i := len(n.recent) - 1; i >= 0; i-- {
			a := n.recent[i]
			k := a.Type
			if a.Kind != "" {
				k = a.Kind
			}
			counts[k]++
			if (kind == "" || a.Kind == kind) && (typ == "" || a.Type == typ) && (addr == "" || a.From == addr || a.To == addr) && len(out) < lim {
				out = append(out, a)
			}
		}
		n.mu.Unlock()
		writeJSON(w, 200, map[string]any{"activity": out, "counts": counts})
	})
	mux.HandleFunc("POST /tx", func(w http.ResponseWriter, r *http.Request) {
		if !n.allow(clientIP(r)) {
			fail(w, 429, "too many transactions from this address; slow down")
			return
		}
		var t core.Tx
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&t); err != nil {
			fail(w, 400, "bad transaction")
			return
		}
		h, err := n.Submit(t, true)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"hash": h})
	})
	mux.HandleFunc("OPTIONS /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("access-control-allow-origin", "*")
		w.Header().Set("access-control-allow-headers", "content-type")
		w.WriteHeader(204)
	})
	return mux
}

// PubHex is a helper for tools.
func PubHex(k ed25519.PrivateKey) string { return hex.EncodeToString(k.Public().(ed25519.PublicKey)) }
