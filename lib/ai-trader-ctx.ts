/**
 * Which AI trader the current request or schedule run is working for (server only).
 *
 * Every admin has their own trader: their own settings, wallet, Telegram / X logins, followed sources, positions,
 * signals and log. The owner's trader is id 1 (it kept all the history from before). Code runs inside
 * withTrader(id, …), and tq(table) gives a query on one of the per-trader tables already limited to that trader
 * (and stamps trader_id on inserts), so one admin can never read or touch another's trades.
 */
import { AsyncLocalStorage } from "async_hooks";
import { supabaseService } from "@/lib/supabase/server";

const als = new AsyncLocalStorage<number>();

export const withTrader = <R>(id: number, fn: () => Promise<R>): Promise<R> => als.run(id, fn);

/** The trader being worked on. Throws if code forgot to choose one, rather than guessing. */
export function T(): number {
  const id = als.getStore();
  if (!id) throw new Error("No AI trader selected.");
  return id;
}

type Table = "ai_trader_positions" | "ai_trader_log" | "ai_trader_signals" | "ai_trader_sources";
const stamp = (v: any) => (Array.isArray(v) ? v.map((r) => ({ ...r, trader_id: T() })) : { ...v, trader_id: T() });

/** A query on a per-trader table, limited to the current trader. */
export function tq(table: Table) {
  const sb = supabaseService();
  return {
    select: (cols = "*", opts?: any): any => sb.from(table).select(cols, opts).eq("trader_id", T()),
    update: (v: Record<string, unknown>): any => sb.from(table).update(v).eq("trader_id", T()),
    delete: (): any => sb.from(table).delete().eq("trader_id", T()),
    insert: (v: any): any => sb.from(table).insert(stamp(v)),
    upsert: (v: any, opts?: any): any => sb.from(table).upsert(stamp(v), opts),
  };
}

/** The current trader's settings row. */
export const settingsRow = () => supabaseService().from("ai_trader_settings");
