/**
 * Double-Entry Ledger for MnemoPay
 *
 * Every financial operation records two entries (debit + credit) that always
 * balance to zero. This is the accounting standard required by regulators,
 * bank partners, and auditors.
 *
 * Account types:
 *   - agent:{agentId}        → Agent wallet (available funds)
 *   - escrow:{agentId}       → Funds held in escrow pending settlement
 *   - platform:revenue       → Platform fee income
 *   - platform:float         → Funds in transit / settlement buffer
 *   - counterparty:{agentId} → Funds owed to/from counterparty agents
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Metadata entry appended to serialize() output so running totals survive a roundtrip */
export interface LedgerSummaryEntry {
  _isSummary: true;
  totalDebits: number;
  totalCredits: number;
  totalEntryCount: number;
  accountBalances: Record<string, number>;
  /** Hash of the last entry dropped by compact(); anchors the first surviving entry's prevEntryHash. */
  baseHash?: string;
  /** Hash of the newest entry at serialize time; lets a reload detect tail truncation/edits. */
  headHash?: string;
  /** True when high-throughput mode (no per-entry audit trail) was on. */
  highThroughput?: boolean;
}

export type AccountType =
  | "agent"         // Agent's available balance
  | "escrow"        // Funds held pending settlement
  | "revenue"       // Platform fee revenue
  | "float"         // Settlement buffer
  | "counterparty"; // Inter-agent settlement

export type EntryDirection = "debit" | "credit";

export type Currency = "USD" | "USDC" | "BTC" | "EUR" | "NGN";

export interface LedgerEntry {
  id: string;
  /** Links debit+credit pair */
  txRef: string;
  /** Full account identifier (e.g., "agent:agent-123") */
  account: string;
  /** Account type for querying */
  accountType: AccountType;
  /** Debit amount (money going out of this account) */
  debit: number;
  /** Credit amount (money coming into this account) */
  credit: number;
  /** Currency code */
  currency: Currency;
  /** Human-readable description */
  description: string;
  /** Related MnemoPay transaction ID */
  relatedTxId?: string;
  /** Counterparty account for cross-referencing */
  counterAccount?: string;
  /** ISO timestamp */
  createdAt: string;
  /** Sequence number for ordering (monotonically increasing) */
  seq: number;
  /** SHA-256 hash of the previous entry for tamper-evident chain (undefined for genesis entry) */
  prevEntryHash?: string;
  /** Hash formula version. 2 = covers every field; absent = legacy 8-field formula. */
  hashVersion?: 2;
}

export interface AccountBalance {
  account: string;
  accountType: AccountType;
  currency: Currency;
  /** Total credits minus total debits */
  balance: number;
  /** Sum of all credits */
  totalCredits: number;
  /** Sum of all debits */
  totalDebits: number;
  /** Number of entries */
  entryCount: number;
}

export interface LedgerSummary {
  /** Total debits across all accounts (should equal totalCredits) */
  totalDebits: number;
  /** Total credits across all accounts (should equal totalCredits) */
  totalCredits: number;
  /** Must be zero if ledger is balanced */
  imbalance: number;
  /** Whether the ledger balances */
  balanced: boolean;
  /** Number of entries */
  entryCount: number;
  /** All account balances */
  accounts: AccountBalance[];
  /** Whether the hash chain is valid (undefined if no chained entries exist) */
  chainValid?: boolean;
  /** Ratio of valid chain links (0.0–1.0, undefined if no chained entries) */
  chainIntegrity?: number;
  /**
   * How much per-entry detail backs the totals:
   *  - "complete":  every entry since genesis is present
   *  - "compacted": older entries were dropped (totals and chain link survive; detail does not)
   *  - "disabled":  high-throughput mode, entries are NOT being recorded
   */
  auditTrail: "complete" | "compacted" | "disabled";
  /** Running balances match a recomputation from entries. undefined when entries can't prove it (compacted/disabled). */
  reconciled?: boolean;
}

export interface TransferResult {
  entries: [LedgerEntry, LedgerEntry];
  txRef: string;
}

// ─── Hash Chain ─────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of a ledger entry's critical fields.
 * Used to build a tamper-evident chain across entries.
 */
export function hashEntry(entry: LedgerEntry): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  if (entry.hashVersion === 2) {
    // v2 covers every field (JSON array, so a "|" in a description can't forge a collision).
    const payload = JSON.stringify([
      2,
      entry.id,
      entry.txRef,
      entry.account,
      entry.accountType,
      entry.debit,
      entry.credit,
      entry.currency,
      entry.description,
      entry.relatedTxId ?? "",
      entry.counterAccount ?? "",
      entry.createdAt,
      entry.seq,
      entry.prevEntryHash ?? "",
    ]);
    return createHash("sha256").update(payload).digest("hex");
  }
  // Legacy formula: kept only so ledgers persisted before v2 still verify.
  const payload = [
    entry.id,
    entry.txRef,
    entry.account,
    String(entry.debit),
    String(entry.credit),
    entry.currency,
    String(entry.seq),
    entry.prevEntryHash ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

// ─── Ledger ─────────────────────────────────────────────────────────────────

export class Ledger {
  private entries: LedgerEntry[] = [];
  private seq = 0;
  private lastEntryHash: string | undefined;
  /** Running balance per "account:currency" key — O(1) lookups, survives compaction */
  private _accountBalances = new Map<string, number>();
  /** Running totals for fast verify() — maintained across compaction */
  private _totalDebits = 0;
  private _totalCredits = 0;
  /** Lifetime entry count (includes compacted-away entries) */
  private _totalEntryCount = 0;
  /**
   * High-throughput mode: skip LedgerEntry object creation and hash computation.
   * Enabled automatically when compact() is called with maxEntries <= 100.
   * Running totals (_accountBalances, _totalDebits, _totalCredits) remain correct.
   */
  private _skipEntries = false;
  /** Hash of the last entry dropped by compact(); the surviving first entry must link to it. */
  private _baseHash: string | undefined;
  /** Head hash recorded by a previous serialize(); checked against the recomputed head. */
  private _declaredHead: string | undefined;

  constructor(existingEntries?: (LedgerEntry | LedgerSummaryEntry)[]) {
    if (!existingEntries || existingEntries.length === 0) return;

    // Check for a summary entry (last element) from a previous serialize()
    const last = existingEntries[existingEntries.length - 1] as any;
    const hasSummary = last?._isSummary === true;

    if (hasSummary) {
      // Restore running totals from summary instead of re-scanning all entries
      this._totalDebits = last.totalDebits ?? 0;
      this._totalCredits = last.totalCredits ?? 0;
      this._totalEntryCount = last.totalEntryCount ?? 0;
      this._baseHash = last.baseHash;
      this._declaredHead = last.headHash;
      this._skipEntries = last.highThroughput === true;
      if (last.accountBalances) {
        for (const [k, v] of Object.entries(last.accountBalances as Record<string, number>)) {
          this._accountBalances.set(k, v);
        }
      }
      existingEntries = existingEntries.slice(0, -1) as LedgerEntry[];
    }

    const validated = (existingEntries as LedgerEntry[]).map(e => {
      const debit = Number(e.debit);
      const credit = Number(e.credit);
      if (!Number.isFinite(debit) || debit < 0) throw new Error(`Ledger entry ${e.id}: debit must be a non-negative finite number`);
      if (!Number.isFinite(credit) || credit < 0) throw new Error(`Ledger entry ${e.id}: credit must be a non-negative finite number`);
      if (!Number.isFinite(e.seq) || e.seq < 0) throw new Error(`Ledger entry ${e.id}: seq must be a non-negative number`);
      return { ...e, debit, credit };
    });

    if (!hasSummary) {
      // No summary: rebuild running totals from all provided entries
      for (const e of validated) {
        this._totalDebits += e.debit;
        this._totalCredits += e.credit;
        this._totalEntryCount += (e.debit > 0 || e.credit > 0) ? 1 : 0;
        const key = `${e.account}:${e.currency}`;
        this._accountBalances.set(key, (this._accountBalances.get(key) ?? 0) + e.credit - e.debit);
      }
      this._totalEntryCount = validated.length;
    }

    this.entries = validated;
    this.seq = validated.length > 0
      ? Math.max(...validated.map(e => e.seq)) + 1
      : 0;
    if (this.entries.length > 0) {
      this.lastEntryHash = hashEntry(this.entries[this.entries.length - 1]);
    }
  }

  // ── Core: Double-Entry Transfer ──────────────────────────────────────────

  /**
   * Record a double-entry transfer. Debits one account, credits another.
   * The ledger always balances: every debit has an equal credit.
   */
  transfer(
    fromAccount: string,
    toAccount: string,
    amount: number,
    currency: Currency,
    description: string,
    relatedTxId?: string,
  ): TransferResult {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Ledger transfer amount must be a positive finite number");
    if (!fromAccount || !toAccount) throw new Error("Both fromAccount and toAccount are required");
    if (fromAccount === toAccount) throw new Error("Cannot transfer to the same account");

    // Update running totals and account balances (O(1), survives compaction)
    this._totalDebits += amount;
    this._totalCredits += amount;
    this._totalEntryCount += 2;
    this.seq += 2;
    const debitKey = `${fromAccount}:${currency}`;
    const creditKey = `${toAccount}:${currency}`;
    this._accountBalances.set(debitKey, (this._accountBalances.get(debitKey) ?? 0) - amount);
    this._accountBalances.set(creditKey, (this._accountBalances.get(creditKey) ?? 0) + amount);

    // High-throughput mode: skip LedgerEntry object + hash creation entirely.
    // Running totals above are sufficient for balance() and verifyLedger().
    if (this._skipEntries) {
      return { entries: [] as any, txRef: "" };
    }

    const txRef = crypto.randomUUID();
    const now = new Date().toISOString();

    const debitEntry: LedgerEntry = {
      id: crypto.randomUUID(),
      txRef,
      account: fromAccount,
      accountType: this.parseAccountType(fromAccount),
      debit: amount,
      credit: 0,
      currency,
      description,
      relatedTxId,
      counterAccount: toAccount,
      createdAt: now,
      seq: this.seq - 2,
      prevEntryHash: this.lastEntryHash,
      hashVersion: 2,
    };

    const debitHash = hashEntry(debitEntry);

    const creditEntry: LedgerEntry = {
      id: crypto.randomUUID(),
      txRef,
      account: toAccount,
      accountType: this.parseAccountType(toAccount),
      debit: 0,
      credit: amount,
      currency,
      description,
      relatedTxId,
      counterAccount: fromAccount,
      createdAt: now,
      seq: this.seq - 1,
      prevEntryHash: debitHash,
      hashVersion: 2,
    };

    this.entries.push(debitEntry, creditEntry);
    this.lastEntryHash = hashEntry(creditEntry);

    return { entries: [debitEntry, creditEntry], txRef };
  }

  /**
   * Compact the ledger by dropping oldest entries while preserving running totals
   * AND the hash-chain link: the hash of the last dropped entry is kept so the
   * first surviving entry can still be verified. Returns the dropped entries so
   * the caller can archive them (compaction itself discards detail).
   *
   * This never disables entry recording. (It used to: any maxEntries <= 100
   * silently switched the ledger into a mode that recorded no entries at all,
   * and the SDK compacts to 50.) Use setHighThroughput(true) to opt out of the
   * audit trail explicitly.
   */
  compact(maxEntries: number): LedgerEntry[] {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("compact maxEntries must be a positive integer");
    }
    if (this.entries.length <= maxEntries) return [];
    const dropped = this.entries.splice(0, this.entries.length - maxEntries);
    this._baseHash = hashEntry(dropped[dropped.length - 1]);
    this.archiveSink?.(dropped);
    return dropped;
  }

  /** Optional hook that receives entries dropped by compact() (e.g. append to durable storage). */
  archiveSink?: (dropped: LedgerEntry[]) => void;

  /**
   * Opt out of per-entry recording for throughput. Running totals stay correct but
   * NO audit trail is kept; verify().auditTrail reports "disabled". Explicit only.
   */
  setHighThroughput(enabled: boolean): void {
    this._skipEntries = enabled;
  }

  /** Hash of the newest entry. Anchor this externally (log, chain, notary) to detect later truncation. */
  get headHash(): string | undefined {
    return this.lastEntryHash;
  }

  // ── Payment Flow Methods ─────────────────────────────────────────────────

  /**
   * CHARGE: Move funds from agent's available balance into escrow.
   * Debit agent → Credit escrow
   */
  recordCharge(agentId: string, amount: number, txId: string, currency: Currency = "USD"): TransferResult {
    return this.transfer(
      `agent:${agentId}`,
      `escrow:${agentId}`,
      amount,
      currency,
      `Hold for pending charge`,
      txId,
    );
  }

  /**
   * SETTLE: Release escrow, deduct platform fee, credit counterparty.
   * Returns 2-3 transfer results (escrow→float, float→revenue for fee, float→counterparty for net).
   */
  recordSettlement(
    agentId: string,
    txId: string,
    grossAmount: number,
    feeAmount: number,
    netAmount: number,
    counterpartyId?: string,
    currency: Currency = "USD",
  ): TransferResult[] {
    // Validate everything BEFORE the first transfer: the three legs must apply together
    // or not at all, otherwise a bad fee/net leaves gross stranded in platform:float.
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) throw new Error("Settlement gross amount must be a positive finite number");
    if (!Number.isFinite(feeAmount) || feeAmount < 0) throw new Error("Settlement fee must be a non-negative finite number");
    if (!Number.isFinite(netAmount) || netAmount <= 0) throw new Error("Settlement net amount must be a positive finite number");
    if (Math.abs(feeAmount + netAmount - grossAmount) > 0.01) {
      throw new Error(`Settlement fee (${feeAmount}) + net (${netAmount}) must equal gross (${grossAmount})`);
    }
    const results: TransferResult[] = [];

    // 1. Escrow → Platform float (full gross amount)
    results.push(this.transfer(
      `escrow:${agentId}`,
      `platform:float`,
      grossAmount,
      currency,
      `Settlement release from escrow`,
      txId,
    ));

    // 2. Platform float → Platform revenue (fee portion)
    if (feeAmount > 0) {
      results.push(this.transfer(
        `platform:float`,
        `platform:revenue`,
        feeAmount,
        currency,
        `Platform fee (${((feeAmount / grossAmount) * 100).toFixed(1)}%)`,
        txId,
      ));
    }

    // 3. Platform float → Counterparty or back to agent (net amount)
    const destination = counterpartyId
      ? `counterparty:${counterpartyId}`
      : `agent:${agentId}`;
    results.push(this.transfer(
      `platform:float`,
      destination,
      netAmount,
      currency,
      `Net settlement payout`,
      txId,
    ));

    return results;
  }

  /**
   * REFUND: Reverse a completed transaction.
   * Credits back the agent, debits counterparty/revenue.
   */
  recordRefund(
    agentId: string,
    txId: string,
    netAmount: number,
    counterpartyId?: string,
    currency: Currency = "USD",
  ): TransferResult[] {
    const results: TransferResult[] = [];

    if (counterpartyId) {
      // Reverse: counterparty returns net to agent
      results.push(this.transfer(
        `counterparty:${counterpartyId}`,
        `agent:${agentId}`,
        netAmount,
        currency,
        `Refund — reversal of net settlement`,
        txId,
      ));
    } else {
      // No counterparty: reverse the float→agent payout from settlement
      results.push(this.transfer(
        `agent:${agentId}`,
        `platform:float`,
        netAmount,
        currency,
        `Refund — reversal of net settlement`,
        txId,
      ));
    }

    return results;
  }

  /**
   * CANCEL: Release escrow back to agent (charge was never settled).
   */
  recordCancellation(agentId: string, amount: number, txId: string, currency: Currency = "USD"): TransferResult {
    return this.transfer(
      `escrow:${agentId}`,
      `agent:${agentId}`,
      amount,
      currency,
      `Cancelled — escrow released`,
      txId,
    );
  }

  /**
   * FUND: External funds coming into an agent's wallet (top-up, deposit).
   */
  recordFunding(agentId: string, amount: number, source: string, currency: Currency = "USD"): TransferResult {
    return this.transfer(
      `platform:float`,
      `agent:${agentId}`,
      amount,
      currency,
      `Wallet funding from ${source}`,
    );
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /**
   * Get balance for a specific account.
   * Balance = SUM(credits) - SUM(debits)
   */
  getBalance(account: string, currency: Currency = "USD"): number {
    const key = `${account}:${currency}`;
    const balance = this._accountBalances.get(key) ?? 0;
    const precision = (currency === "BTC") ? 1e8 : 100;
    return Math.round(balance * precision) / precision;
  }

  /**
   * Get detailed balance info for an account.
   */
  getAccountBalance(account: string, currency: Currency = "USD"): AccountBalance {
    const key = `${account}:${currency}`;
    const balance = this._accountBalances.get(key) ?? 0;
    // For detailed debit/credit breakdown, scan remaining entries only
    let totalCredits = 0;
    let totalDebits = 0;
    let entryCount = 0;
    for (const entry of this.entries) {
      if (entry.account === account && entry.currency === currency) {
        totalCredits += entry.credit;
        totalDebits += entry.debit;
        entryCount++;
      }
    }
    return {
      account,
      accountType: this.parseAccountType(account),
      currency,
      balance: Math.round(balance * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalDebits: Math.round(totalDebits * 100) / 100,
      entryCount,
    };
  }

  /**
   * Get all entries for a specific transaction.
   */
  getEntriesForTransaction(txId: string): LedgerEntry[] {
    return this.entries.filter(e => e.relatedTxId === txId);
  }

  /**
   * Get all entries for a specific account, optionally filtered by date range.
   */
  getAccountHistory(account: string, limit = 50, offset = 0): LedgerEntry[] {
    return this.entries
      .filter(e => e.account === account)
      .sort((a, b) => b.seq - a.seq)
      .slice(offset, offset + limit);
  }

  /**
   * Verify the entire ledger balances (total debits = total credits).
   */
  verify(): LedgerSummary {
    // Use running totals (O(1)) — maintained across compaction
    const totalDebits = Math.round(this._totalDebits * 100) / 100;
    const totalCredits = Math.round(this._totalCredits * 100) / 100;
    const imbalance = Math.round((this._totalDebits - this._totalCredits) * 100) / 100;

    // Build account summary from running balance map
    const accountMap = new Map<string, AccountBalance>();
    for (const [key, balance] of this._accountBalances) {
      const colonIdx = key.lastIndexOf(':');
      const account = key.slice(0, colonIdx);
      const currency = key.slice(colonIdx + 1) as Currency;
      accountMap.set(key, {
        account,
        accountType: this.parseAccountType(account),
        currency,
        balance: Math.round(balance * 100) / 100,
        totalCredits: 0, // per-account credits not tracked post-compaction
        totalDebits: 0,
        entryCount: 0,
      });
    }

    const chainResult = this.verifyChain();
    const rec = this.reconcile();
    const auditTrail: LedgerSummary["auditTrail"] = this._skipEntries
      ? "disabled"
      : this._totalEntryCount > this.entries.length ? "compacted" : "complete";

    return {
      totalDebits,
      totalCredits,
      imbalance,
      balanced: imbalance === 0,
      entryCount: this._totalEntryCount, // lifetime count (survives compaction)
      accounts: Array.from(accountMap.values()),
      chainValid: chainResult.valid,
      chainIntegrity: chainResult.chainIntegrity,
      auditTrail,
      ...(rec.checked ? { reconciled: rec.consistent } : {}),
    };
  }

  /**
   * Recompute balances from the entries and compare them with the running totals.
   * Only possible while every entry is still present; after compaction the running
   * totals are the sole record, so this reports checked:false instead of a false pass.
   */
  reconcile(): { checked: boolean; consistent: boolean; mismatches: string[] } {
    if (this._skipEntries || this._totalEntryCount !== this.entries.length) {
      return { checked: false, consistent: true, mismatches: [] };
    }
    const recomputed = new Map<string, number>();
    for (const e of this.entries) {
      const key = `${e.account}:${e.currency}`;
      recomputed.set(key, (recomputed.get(key) ?? 0) + e.credit - e.debit);
    }
    const mismatches: string[] = [];
    for (const key of new Set([...recomputed.keys(), ...this._accountBalances.keys()])) {
      const a = recomputed.get(key) ?? 0;
      const b = this._accountBalances.get(key) ?? 0;
      if (Math.abs(a - b) > 1e-6) mismatches.push(`${key}: entries=${a} running=${b}`);
    }
    return { checked: true, consistent: mismatches.length === 0, mismatches };
  }

  // ── Chain Verification ───────────────────────────────────────────────────

  /**
   * Walk all entries and verify that each entry's prevEntryHash matches the hash of
   * the previous entry (or, for the first surviving entry of a compacted ledger, the
   * recorded base hash). An entry with no prevEntryHash is tolerated only in the
   * leading run (genesis / pre-chain legacy data); after the first chained entry a
   * missing link counts as broken, so stripping the field is no longer a bypass.
   * If a prior serialize() declared a head hash, a mismatch (tail truncated or
   * edited) is reported in headMatches and makes the chain invalid.
   */
  verifyChain(): { valid: boolean; brokenLinks: number[]; chainIntegrity: number; headMatches?: boolean } {
    const brokenLinks: number[] = [];
    let chainedCount = 0;
    let validCount = 0;
    let seenChained = false;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (entry.prevEntryHash === undefined) {
        // Allowed only as the very first entry of an uncompacted ledger (genesis)
        // or inside a pre-chain legacy prefix.
        if (!seenChained && !(i === 0 && this._baseHash !== undefined)) continue;
        chainedCount++;
        brokenLinks.push(i);
        continue;
      }

      seenChained = true;
      chainedCount++;

      if (i === 0) {
        // Unknown base (ledger compacted before baseHash was recorded) is unverifiable, not broken.
        if (this._baseHash === undefined || entry.prevEntryHash === this._baseHash) validCount++;
        else brokenLinks.push(i);
        continue;
      }

      if (entry.prevEntryHash === hashEntry(this.entries[i - 1])) validCount++;
      else brokenLinks.push(i);
    }

    const headMatches = this._declaredHead === undefined || this.entries.length === 0
      ? undefined
      : this._declaredHead === hashEntry(this.entries[this.entries.length - 1]);

    const chainIntegrity = chainedCount === 0 ? 1.0 : validCount / chainedCount;

    return {
      valid: brokenLinks.length === 0 && headMatches !== false,
      brokenLinks,
      chainIntegrity,
      ...(headMatches !== undefined ? { headMatches } : {}),
    };
  }

  // ── Serialization ────────────────────────────────────────────────────────

  /**
   * Export entries + a summary entry for persistence.
   * The summary entry allows running totals (including compacted history)
   * to survive a serialize/deserialize roundtrip.
   */
  serialize(): (LedgerEntry | LedgerSummaryEntry)[] {
    const summary: LedgerSummaryEntry = {
      _isSummary: true,
      totalDebits: this._totalDebits,
      totalCredits: this._totalCredits,
      totalEntryCount: this._totalEntryCount,
      accountBalances: Object.fromEntries(this._accountBalances),
      ...(this._baseHash !== undefined ? { baseHash: this._baseHash } : {}),
      ...(this.lastEntryHash !== undefined ? { headHash: this.lastEntryHash } : {}),
      ...(this._skipEntries ? { highThroughput: true } : {}),
    };
    return [...this.entries, summary];
  }

  /**
   * Get entry count.
   */
  /** Lifetime entry count (includes compacted-away entries) */
  get size(): number {
    return this._totalEntryCount;
  }

  /** Current in-memory entry count (after any compaction) */
  get visibleSize(): number {
    return this.entries.length;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private parseAccountType(account: string): AccountType {
    const prefix = account.split(":")[0];
    switch (prefix) {
      case "agent": return "agent";
      case "escrow": return "escrow";
      case "platform":
        return account.includes("revenue") ? "revenue" : "float";
      case "counterparty": return "counterparty";
      default: return "agent";
    }
  }
}
