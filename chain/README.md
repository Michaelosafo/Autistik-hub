# AUTISTIK Chain

AUTISTIK's own blockchain, written from scratch in Go using only Go's standard library, so it has no outside
packages to trust. Its native coin is **ATK** (9 decimals).

## What makes it different

- **Instant finality.** It uses Byzantine-fault-tolerant consensus (Tendermint style: propose, prevote, precommit,
  with locking). A block is final the moment it's committed: no reorgs, and no "wait for 12 confirmations".
- **The AUTISTIK Fund is built into the protocol.** Half of every fee goes on-chain to the Fund, where anyone can
  see it. The other half goes to the validator that made the block.
- **Activity is a first-class transaction.** Games, purchases, posts, tips, stakes, rewards and donations are recorded
  as typed, readable activity, which gives AUTISTIK a public, live feed of everything happening on the chain.
- **Readable names.** Anyone can claim an `@name` for their `atk…` address. The fee goes to the Fund.
- **A hard supply cap.** Minting can never pass `max_supply`, which is set in the genesis file.

## Security built in

- Every transaction is signed with ed25519. The chain id is part of what's signed, so a testnet transaction can't be
  replayed on mainnet. A per-account nonce stops replays and overflow checks guard every balance change.
- Every block carries precommit signatures from validators holding more than 2/3 of the voting power. Nodes check
  those signatures when catching up and on every restart, so a tampered data file or a fake peer is rejected.
- **Double-signing is prevented.** A validator writes down what it is about to sign (fsync'd to disk) before the
  signature leaves the node, so even a crash can't make it sign two different blocks at the same height.
- The chain stays safe while fewer than 1/3 of the voting power is faulty or malicious. If too many validators go
  offline, the chain **pauses** rather than forking, and resumes when they return.
- Owner-only actions (mint, validators, owner hand-over) are checked by every node.
- The RPC has a per-IP transaction rate limit, size limits on every request and a capped mempool. Peer traffic needs
  a shared token.

**Before real money goes on it:** get an independent security audit of this code, run at least 4 validators on
different providers, and run a public testnet for a few weeks.

## Tested (localnet, 4 validators on one machine)

- **Throughput:** 15,000 transactions from 300 accounts were final in 18 seconds, about 830 transactions a second.
  Separate servers will differ.
- **One validator down:** the chain kept going.
- **Two of four down:** the chain paused with no fork, and resumed when they came back. Nodes that had been off
  caught up to the identical block hash.
- **Rejected:** replayed, tampered, cross-chain and non-owner transactions.

## Build

```bash
cd chain
go build -o autd ./cmd/autd      # Go 1.22+ only, nothing to download
go test ./...
```

## Try it on one computer

```bash
./autd localnet /tmp/ln 4
for i in 0 1 2 3; do ./autd start /tmp/ln/node$i & done
curl localhost:26701/status
./autd bench http://127.0.0.1:26701 /tmp/ln/owner.key 100 50
```

## Mainnet on your servers

You need **4 servers** (more is better), ideally from different providers and countries. For example: Hetzner
CX32, DigitalOcean 4 GB or AWS t3.medium. Each needs Ubuntu 24.04, 2–4 CPUs, 4–8 GB of RAM and a 80 GB SSD.

1. **Keys.** Make these on your own computer, offline if you can:
   ```bash
   ./autd keygen owner.key      # the OWNER: can mint and manage validators. Keep it offline and backed up.
   ./autd keygen fund.key       # the AUTISTIK Fund's account
   ./autd keygen validator.key  # one per server, made on that server
   ```
2. **Genesis.** One file, identical on every server:
   ```bash
   ./autd init home --chain-id autistik-1 --owner atk…(owner) --fund atk…(fund) \
     --validator PUBKEY1:10 --validator PUBKEY2:10 --validator PUBKEY3:10 --validator PUBKEY4:10 \
     --alloc atk…(owner):100000000 --max-supply 1000000000
   ```
3. **On each server:** copy `autd`, `genesis.json` and that server's own `validator.key` into `/var/lib/autistik`.
   Then edit `config.json`:
   ```json
   { "listen": ":26657", "peers": ["https://val2.autistik.io", "https://val3.autistik.io", "https://val4.autistik.io"],
     "peer_token": "a long random secret, the same on all 4", "block_ms": 800, "tx_rate_per_ip": 20 }
   ```
4. **Run it as a service.** Create `/etc/systemd/system/autd.service`:
   ```ini
   [Service]
   ExecStart=/usr/local/bin/autd start /var/lib/autistik
   Restart=always
   User=autistik
   LimitNOFILE=65535
   [Install]
   WantedBy=multi-user.target
   ```
   Then run `systemctl enable --now autd`.
5. **HTTPS.** Put Caddy in front: `rpc.autistik.io { reverse_proxy localhost:26657 }`. Open only ports 443 and 22
   in the firewall, and allow SSH by key only.
6. **Connect the site.** In Vercel add `CHAIN_RPC_URL=https://rpc.autistik.io` and `CHAIN_OWNER_KEY=<owner seed>`.
   Then open **Admin → AUTISTIK Chain**.

## RPC

| Call | What it returns |
|---|---|
| `GET /status` | height, validators, supply, Fund, mempool |
| `GET /block/{h}` | a final block and its commit |
| `GET /blocks?limit=20` | the latest blocks |
| `GET /tx/{hash}` | `pending` or `final` |
| `GET /account/{atk…\|@name}` | balance, nonce, next_nonce, name |
| `GET /validators` | the validator set |
| `GET /activity?kind=game&address=atk…&limit=50` | the live activity feed |
| `POST /tx` | submit a signed transaction (see `core/types.go`, `SignBytes`) |

## Next steps

- **Bridge:** BNB and Solana lock contracts, multi-signer, with caps and an emergency pause. Audit before launch.
- **Explorer:** a public explorer page on autistik.io.
- **Wallet:** the ATK wallet inside the AUTISTIK app.
- **Faster state commitment:** an incremental Merkle tree, for very large account counts.
