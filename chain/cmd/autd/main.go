// autd: the AUTISTIK Chain node and its tools.
//
//	autd keygen [file]                     new key (saved to file, mode 600); prints public key and address
//	autd init <home> --chain-id ID --owner ADDR --fund ADDR --validator PUB[:power]... [--alloc ADDR:ATK]...
//	autd start <home>                      run a node (reads home/config.json, genesis.json, validator.key)
//	autd send <rpc> <keyfile> <type> [to] [amount ATK] [kind] [data]   sign and send a transaction
//	autd localnet <dir> [n]                make an n-validator test network on this machine (default 4)
package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"autistik.io/chain/consensus"
	"autistik.io/chain/core"
	"autistik.io/chain/node"
)

type fileConfig struct {
	Listen    string   `json:"listen"`
	Peers     []string `json:"peers"`
	PeerToken string   `json:"peer_token"`
	BlockMs   int      `json:"block_ms"`
	TxRate    *float64 `json:"tx_rate_per_ip"` // default 20; 0 turns the limit off (test networks only)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("autd ")
	if len(os.Args) < 2 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "keygen":
		err = keygen(os.Args[2:])
	case "init":
		err = initHome(os.Args[2:])
	case "start":
		err = start(os.Args[2:])
	case "send":
		err = send(os.Args[2:])
	case "localnet":
		err = localnet(os.Args[2:])
	case "bench":
		err = bench(os.Args[2:])
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: autd keygen|init|start|send|localnet  (see the top of cmd/autd/main.go or chain/README.md)")
	os.Exit(2)
}

func newKey() ed25519.PrivateKey {
	_, k, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return k
}

func saveKey(path string, k ed25519.PrivateKey) error {
	return os.WriteFile(path, []byte(hex.EncodeToString(k.Seed())+"\n"), 0o600)
}

func loadKey(path string) (ed25519.PrivateKey, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	seed, err := hex.DecodeString(strings.TrimSpace(string(b)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, errors.New("key file must hold a 32-byte hex seed")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

func describe(k ed25519.PrivateKey) string {
	pub := k.Public().(ed25519.PublicKey)
	return fmt.Sprintf("public key: %s\naddress:    %s", hex.EncodeToString(pub), core.AddressOf(pub))
}

func keygen(args []string) error {
	k := newKey()
	if len(args) > 0 {
		if _, err := os.Stat(args[0]); err == nil {
			return errors.New("that file already exists; not overwriting a key")
		}
		if err := saveKey(args[0], k); err != nil {
			return err
		}
		fmt.Println("saved to", args[0], "(keep it secret, back it up offline)")
	} else {
		fmt.Println("seed:      ", hex.EncodeToString(k.Seed()), " ← SECRET")
	}
	fmt.Println(describe(k))
	return nil
}

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(v string) error { *m = append(*m, v); return nil }

func atk(s string) (uint64, error) {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 || f > float64(math.MaxUint64)/float64(core.Unit) {
		return 0, fmt.Errorf("bad amount %q", s)
	}
	return uint64(math.Round(f * float64(core.Unit))), nil
}

func initHome(args []string) error {
	if len(args) < 1 {
		return errors.New("init <home> ...")
	}
	home := args[0]
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	chainID := fs.String("chain-id", "autistik-1", "")
	owner := fs.String("owner", "", "owner address")
	fund := fs.String("fund", "", "AUTISTIK Fund address")
	maxSupply := fs.String("max-supply", "1000000000", "hard cap in ATK (0 = none)")
	var vals, allocs multi
	fs.Var(&vals, "validator", "PUBKEY[:power]")
	fs.Var(&allocs, "alloc", "ADDR:ATK")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	ms, err := atk(*maxSupply)
	if err != nil {
		return err
	}
	g := core.Genesis{ChainID: *chainID, Time: time.Now().UnixMilli(), Params: core.Params{Owner: *owner, Fund: *fund, MinFee: 1000, NameFee: core.Unit, MaxSupply: ms}, Balances: map[string]uint64{}}
	for _, v := range vals {
		p := strings.SplitN(v, ":", 2)
		power := uint64(10)
		if len(p) == 2 {
			power, _ = strconv.ParseUint(p[1], 10, 64)
		}
		g.Validators = append(g.Validators, core.Validator{PubKey: p[0], Power: power})
	}
	for _, a := range allocs {
		p := strings.SplitN(a, ":", 2)
		if len(p) != 2 {
			return fmt.Errorf("bad --alloc %q", a)
		}
		amt, err := atk(p[1])
		if err != nil {
			return err
		}
		g.Balances[p[0]] = amt
	}
	if _, err := core.NewState(&g); err != nil {
		return err
	}
	os.MkdirAll(home, 0o700)
	b, _ := json.MarshalIndent(g, "", "  ")
	if err := os.WriteFile(filepath.Join(home, "genesis.json"), b, 0o644); err != nil {
		return err
	}
	cfg, _ := json.MarshalIndent(fileConfig{Listen: ":26657", Peers: []string{}, BlockMs: 800}, "", "  ")
	if _, err := os.Stat(filepath.Join(home, "config.json")); err != nil {
		os.WriteFile(filepath.Join(home, "config.json"), cfg, 0o600)
	}
	fmt.Println("genesis written to", filepath.Join(home, "genesis.json"), "- copy the SAME file to every node")
	return nil
}

func start(args []string) error {
	if len(args) < 1 {
		return errors.New("start <home>")
	}
	home := args[0]
	var g core.Genesis
	b, err := os.ReadFile(filepath.Join(home, "genesis.json"))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, &g); err != nil {
		return err
	}
	var fc fileConfig
	if b, err := os.ReadFile(filepath.Join(home, "config.json")); err == nil {
		json.Unmarshal(b, &fc)
	}
	if fc.Listen == "" {
		fc.Listen = ":26657"
	}
	var key ed25519.PrivateKey
	if k, err := loadKey(filepath.Join(home, "validator.key")); err == nil {
		key = k
		log.Printf("validator %s", node.PubHex(k)[:16])
	} else {
		log.Printf("no validator.key: running as a follower (RPC) node")
	}
	cc := consensus.DefaultConfig()
	if fc.BlockMs > 0 {
		cc.BlockInterval = time.Duration(fc.BlockMs) * time.Millisecond
	}
	rate := 20.0
	if fc.TxRate != nil {
		rate = *fc.TxRate
	}
	n, err := node.New(node.Config{Dir: filepath.Join(home, "data"), Listen: fc.Listen, Peers: fc.Peers, PeerToken: fc.PeerToken, TxRate: rate, Consensus: cc}, &g, key)
	if err != nil {
		return err
	}
	return n.Start()
}

func send(args []string) error {
	if len(args) < 3 {
		return errors.New("send <rpc> <keyfile> <type> [to] [amount] [kind] [data]")
	}
	rpc, kf, typ := strings.TrimRight(args[0], "/"), args[1], args[2]
	k, err := loadKey(kf)
	if err != nil {
		return err
	}
	pub := k.Public().(ed25519.PublicKey)
	var st struct {
		ChainID string `json:"chain_id"`
		MinFee  uint64 `json:"min_fee"`
	}
	if err := getJSON(rpc+"/status", &st); err != nil {
		return err
	}
	var acct struct {
		Nonce uint64 `json:"next_nonce"`
	}
	if err := getJSON(rpc+"/account/"+core.AddressOf(pub), &acct); err != nil {
		return err
	}
	t := core.Tx{Type: typ, Nonce: acct.Nonce, Fee: st.MinFee}
	if len(args) > 3 {
		t.To = args[3]
	}
	if len(args) > 4 {
		if t.Amount, err = atk(args[4]); err != nil {
			return err
		}
	}
	if len(args) > 5 {
		t.Kind = args[5]
	}
	if len(args) > 6 {
		t.Data = args[6]
	}
	if typ == core.TxValidator { // send <rpc> <owner.key> validator <validator-pubkey> <power>
		t.Data, t.To = t.To, ""
		t.Power = t.Amount / core.Unit
		t.Amount = 0
	}
	if typ == core.TxName {
		t.Data, t.To = t.To, ""
	}
	t.Sign(st.ChainID, k)
	body, _ := json.Marshal(t)
	res, err := http.Post(rpc+"/tx", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var out map[string]string
	json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != 200 {
		return errors.New(out["error"])
	}
	fmt.Println("sent:", out["hash"])
	return nil
}

func getJSON(url string, v any) error {
	c := &http.Client{Timeout: 5 * time.Second}
	res, err := c.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", url, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(v)
}

// localnet: n validators on ports 26701.. on this machine, all sharing one genesis. For testing only.
func localnet(args []string) error {
	if len(args) < 1 {
		return errors.New("localnet <dir> [n]")
	}
	dir := args[0]
	n := 4
	if len(args) > 1 {
		n, _ = strconv.Atoi(args[1])
	}
	owner, fund := newKey(), newKey()
	os.MkdirAll(dir, 0o700)
	saveKey(filepath.Join(dir, "owner.key"), owner)
	saveKey(filepath.Join(dir, "fund.key"), fund)
	ownerAddr := core.AddressOf(owner.Public().(ed25519.PublicKey))
	g := core.Genesis{ChainID: "autistik-localnet", Time: time.Now().UnixMilli(),
		Params:   core.Params{Owner: ownerAddr, Fund: core.AddressOf(fund.Public().(ed25519.PublicKey)), MinFee: 1000, NameFee: core.Unit, MaxSupply: 1_000_000_000 * core.Unit},
		Balances: map[string]uint64{ownerAddr: 100_000_000 * core.Unit}}
	keys := make([]ed25519.PrivateKey, n)
	for i := range keys {
		keys[i] = newKey()
		g.Validators = append(g.Validators, core.Validator{PubKey: node.PubHex(keys[i]), Power: 10})
	}
	gb, _ := json.MarshalIndent(g, "", "  ")
	for i := 0; i < n; i++ {
		home := filepath.Join(dir, fmt.Sprintf("node%d", i))
		os.MkdirAll(home, 0o700)
		os.WriteFile(filepath.Join(home, "genesis.json"), gb, 0o644)
		saveKey(filepath.Join(home, "validator.key"), keys[i])
		var peers []string
		for j := 0; j < n; j++ {
			if j != i {
				peers = append(peers, fmt.Sprintf("http://127.0.0.1:%d", 26701+j))
			}
		}
		off := 0.0
		cfg, _ := json.MarshalIndent(fileConfig{Listen: fmt.Sprintf("127.0.0.1:%d", 26701+i), Peers: peers, PeerToken: "localnet", BlockMs: 500, TxRate: &off}, "", "  ")
		os.WriteFile(filepath.Join(home, "config.json"), cfg, 0o600)
	}
	fmt.Printf("localnet with %d validators in %s (owner key: %s/owner.key)\n", n, dir, dir)
	return nil
}

// bench <rpc> <owner-keyfile> <senders> [per-sender]: funds <senders> fresh accounts from the owner, then each sends
// [per-sender] (default 50) small activity transactions at once, like many members using the app together. Reports
// how fast the network made them all final. For test networks only.
func bench(args []string) error {
	if len(args) < 3 {
		return errors.New("bench <rpc> <owner-keyfile> <senders> [per-sender]")
	}
	rpc := strings.TrimRight(args[0], "/")
	owner, err := loadKey(args[1])
	if err != nil {
		return err
	}
	senders, _ := strconv.Atoi(args[2])
	per := 50
	if len(args) > 3 {
		per, _ = strconv.Atoi(args[3])
	}
	if per > 60 {
		per = 60
	}
	var st struct {
		ChainID string `json:"chain_id"`
		MinFee  uint64 `json:"min_fee"`
		Height  uint64 `json:"height"`
	}
	if err := getJSON(rpc+"/status", &st); err != nil {
		return err
	}
	post := func(t core.Tx) error {
		body, _ := json.Marshal(t)
		res, err := http.Post(rpc+"/tx", "application/json", bytes.NewReader(body))
		if err != nil {
			return err
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			return fmt.Errorf("HTTP %d", res.StatusCode)
		}
		return nil
	}
	nonceOf := func(addr string) uint64 {
		var a struct{ Nonce uint64 `json:"nonce"` }
		getJSON(rpc+"/account/"+addr, &a)
		return a.Nonce
	}
	ownerAddr := core.AddressOf(owner.Public().(ed25519.PublicKey))
	keys := make([]ed25519.PrivateKey, senders)
	base := nonceOf(ownerAddr)
	for i := range keys { // fund in batches of 60 (the per-sender pending limit)
		keys[i] = newKey()
		t := core.Tx{Type: core.TxTransfer, To: core.AddressOf(keys[i].Public().(ed25519.PublicKey)), Amount: 10 * core.Unit, Nonce: base + uint64(i), Fee: st.MinFee}
		t.Sign(st.ChainID, owner)
		if err := post(t); err != nil {
			return fmt.Errorf("funding: %v", err)
		}
		if (i+1)%60 == 0 {
			for nonceOf(ownerAddr) < base+uint64(i+1) {
				time.Sleep(50 * time.Millisecond)
			}
		}
	}
	for nonceOf(ownerAddr) < base+uint64(senders) {
		time.Sleep(50 * time.Millisecond)
	}
	fmt.Printf("funded %d accounts; sending %d transactions…\n", senders, senders*per)
	getJSON(rpc+"/status", &st)
	startH := st.Height
	start := time.Now()
	var errs int64
	done := make(chan struct{})
	for _, k := range keys {
		go func(k ed25519.PrivateKey) {
			for j := 0; j < per; j++ {
				t := core.Tx{Type: core.TxActivity, Kind: "game", Data: "bench", Nonce: uint64(j), Fee: st.MinFee}
				t.Sign(st.ChainID, k)
				if post(t) != nil {
					errs++
				}
			}
			done <- struct{}{}
		}(k)
	}
	for range keys {
		<-done
	}
	sent := time.Since(start)
	want := senders * per
	got := 0
	for t0 := time.Now(); time.Since(t0) < 3*time.Minute && got < want; time.Sleep(200 * time.Millisecond) {
		got = 0
		var bl struct {
			Blocks []struct {
				Height uint64 `json:"height"`
				Txs    int    `json:"txs"`
			} `json:"blocks"`
		}
		getJSON(rpc+"/blocks?limit=100", &bl)
		for _, b := range bl.Blocks {
			if b.Height > startH {
				got += b.Txs
			}
		}
	}
	d := time.Since(start)
	getJSON(rpc+"/status", &st)
	fmt.Printf("%d of %d transactions final in %.1fs → %.0f tx/s (sending took %.1fs; %d blocks; %d send errors)\n", got, want, d.Seconds(), float64(got)/d.Seconds(), sent.Seconds(), st.Height-startH, errs)
	return nil
}
