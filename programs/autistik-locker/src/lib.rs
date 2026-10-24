//! AUTISTIK Solana Locker: holds a creator's Raydium LP tokens until a date, then only that creator can take them back.
//!
//! Safe by construction:
//!  - No admin and no team key: nobody can release a lock early, change its date, or send the tokens anywhere else.
//!  - Tokens only ever go back to the wallet that locked them, and only after the unlock date.
//!  - Each lock has its own vault, so one lock can never touch another lock's tokens.
//!  - After deploying, the upgrade authority is removed (`--final`), so this code can never be changed either.
//!    The Hub refuses to offer Solana locks until it sees that.
//!
//! Built with Anchor 0.29+. To deploy: open beta.solpg.io, paste this file as src/lib.rs, Build, Deploy, then make it final
//! (see GO-LIVE.md, "Solana Locker").
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

// Solana Playground replaces this with the program's own address when you build.
declare_id!("11111111111111111111111111111111");

/// The longest lock allowed (10 years), so a typo can't lock liquidity for centuries.
pub const MAX_LOCK_SECONDS: i64 = 10 * 366 * 24 * 60 * 60;

#[program]
pub mod autistik_locker {
    use super::*;

    /// Moves `amount` tokens from the owner's account into a new vault until `unlock_at` (unix seconds).
    /// `id` lets one wallet lock the same token more than once; the Hub's launches use 0.
    pub fn lock(ctx: Context<Lock>, id: u64, amount: u64, unlock_at: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(amount > 0, LockerError::ZeroAmount);
        require!(unlock_at > now, LockerError::UnlockInPast);
        require!(unlock_at - now <= MAX_LOCK_SECONDS, LockerError::TooLong);

        let lock = &mut ctx.accounts.lock;
        lock.owner = ctx.accounts.owner.key();
        lock.mint = ctx.accounts.mint.key();
        lock.id = id;
        lock.amount = amount;
        lock.locked_at = now;
        lock.unlock_at = unlock_at;
        lock.bump = ctx.bumps.lock;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_tokens.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(Locked { lock: lock.key(), owner: lock.owner, mint: lock.mint, id, amount, unlock_at });
        Ok(())
    }

    /// After the unlock date, sends everything in the vault back to the owner and closes the lock.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let lock = &ctx.accounts.lock;
        require!(now >= lock.unlock_at, LockerError::StillLocked);

        let mint = lock.mint;
        let owner = lock.owner;
        let id = lock.id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"lock", mint.as_ref(), owner.as_ref(), id.as_ref(), &[lock.bump]];
        let signer = &[seeds];

        let amount = ctx.accounts.vault.amount;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_tokens.to_account_info(),
                    authority: ctx.accounts.lock.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.lock.to_account_info(),
            },
            signer,
        ))?;

        emit!(Claimed { lock: ctx.accounts.lock.key(), owner, mint, amount });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Lock<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + TokenLock::SIZE,
        seeds = [b"lock", mint.key().as_ref(), owner.key().as_ref(), id.to_le_bytes().as_ref()],
        bump
    )]
    pub lock: Account<'info, TokenLock>,
    #[account(
        init,
        payer = owner,
        seeds = [b"vault", lock.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = lock
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        close = owner,
        has_one = owner,
        has_one = mint,
        seeds = [b"lock", mint.key().as_ref(), owner.key().as_ref(), lock.id.to_le_bytes().as_ref()],
        bump = lock.bump
    )]
    pub lock: Account<'info, TokenLock>,
    #[account(mut, seeds = [b"vault", lock.key().as_ref()], bump, token::mint = mint, token::authority = lock)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct TokenLock {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub locked_at: i64,
    pub unlock_at: i64,
    pub bump: u8,
}

impl TokenLock {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 1;
}

#[event]
pub struct Locked {
    pub lock: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub unlock_at: i64,
}

#[event]
pub struct Claimed {
    pub lock: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum LockerError {
    #[msg("Lock an amount above zero.")]
    ZeroAmount,
    #[msg("The unlock date must be in the future.")]
    UnlockInPast,
    #[msg("Locks can be at most 10 years.")]
    TooLong,
    #[msg("This lock hasn't ended yet.")]
    StillLocked,
}
