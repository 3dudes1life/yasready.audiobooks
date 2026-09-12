import { randomUUID } from 'node:crypto';
import {
  MONEY_GUARD_RELEASE,
  MONEY_GUARD_SCHEMA_VERSION,
  budgetFingerprint,
  moneyGuardDecision,
  normalizeMoneyPolicy,
  operationClass
} from '../money/money-guard.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();
const roundMoney = (value) => Number(Number(value ?? 0).toFixed(6));

export class MoneyGuardService {
  constructor(store, { ledger = null, clock = () => new Date() } = {}) {
    if (!store) throw new Error('MoneyGuardService requires a store');
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
  }

  createGuard({ projectId, name = 'Project Money Guard', ...policyInput }) {
    if (!projectId) throw new Error('Money Guard requires projectId');
    const policy = normalizeMoneyPolicy(policyInput);
    const existing = this.store.list('money_guard', (row) => row.projectId === projectId && row.status !== 'closed')[0];
    if (existing) throw new Error('project already has an active Money Guard');
    return this.store.put(freeze({
      id: randomUUID(), type: 'money_guard', schemaVersion: MONEY_GUARD_SCHEMA_VERSION, release: MONEY_GUARD_RELEASE,
      projectId, name, policy, status: 'active', lockdownReason: null,
      createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  getGuard(guardId) {
    const guard = this.store.get('money_guard', guardId);
    if (!guard) throw new Error(`money_guard ${guardId} not found`);
    return guard;
  }

  activeGuardForProject(projectId) {
    return this.store.list('money_guard', (row) => row.projectId === projectId && row.status !== 'closed')[0] ?? null;
  }

  authorizations(guardId) {
    return this.store.list('money_authorization', (row) => row.guardId === guardId);
  }

  spending(guardId) {
    const auths = this.authorizations(guardId);
    const capturedUsd = roundMoney(auths.reduce((sum, row) => sum + (row.capturedUsd ?? 0), 0));
    const reservedUsd = roundMoney(auths.filter((row) => ['authorized', 'partially_captured'].includes(row.status)).reduce((sum, row) => sum + Math.max(0, (row.reservedUsd ?? 0) - (row.capturedUsd ?? 0)), 0));
    return freeze({ capturedUsd, reservedUsd, committedUsd: roundMoney(capturedUsd + reservedUsd) });
  }

  sliceSpending(guardId, { provider = null, operation = null } = {}) {
    const auths = this.authorizations(guardId).filter((row) => (!provider || row.provider === provider) && (!operation || row.operation === operation || operationClass(row.operation) === operation));
    const capturedUsd = roundMoney(auths.reduce((sum, row) => sum + (row.capturedUsd ?? 0), 0));
    const reservedUsd = roundMoney(auths.filter((row) => ['authorized', 'partially_captured'].includes(row.status)).reduce((sum, row) => sum + Math.max(0, (row.reservedUsd ?? 0) - (row.capturedUsd ?? 0)), 0));
    return freeze({ capturedUsd, reservedUsd, committedUsd: roundMoney(capturedUsd + reservedUsd) });
  }

  preview(guardId, { provider, operation, estimatedCostUsd, approvedBy = null } = {}) {
    const guard = this.getGuard(guardId);
    if (guard.status !== 'active') return freeze({ status: 'BLOCKED', blocked: true, reasons: freeze([`guard-${guard.status}`]) });
    const all = this.spending(guardId);
    const providerSpend = this.sliceSpending(guardId, { provider });
    const opClass = operationClass(operation);
    const operationSpend = this.sliceSpending(guardId, { operation: opClass });
    return moneyGuardDecision({
      policy: guard.policy,
      capturedUsd: all.capturedUsd,
      reservedUsd: all.reservedUsd,
      providerCapturedUsd: providerSpend.capturedUsd,
      providerReservedUsd: providerSpend.reservedUsd,
      operationCapturedUsd: operationSpend.capturedUsd,
      operationReservedUsd: operationSpend.reservedUsd,
      estimatedCostUsd, provider, operation, approvedBy
    });
  }

  authorize(guardId, { provider, operation, estimatedCostUsd, approvedBy = null, reason = null, metadata = {} } = {}) {
    const guard = this.getGuard(guardId);
    if (guard.status !== 'active') throw new Error(`Money Guard is ${guard.status}; paid action blocked`);
    const decision = this.preview(guardId, { provider, operation, estimatedCostUsd, approvedBy });
    if (decision.blocked) throw new Error(`Money Guard blocked paid action: ${decision.reasons.join(', ')}`);
    const record = freeze({
      id: randomUUID(), type: 'money_authorization', guardId, projectId: guard.projectId,
      provider, operation, operationClass: operationClass(operation), estimateUsd: decision.estimateUsd,
      reservedUsd: decision.reserveUsd, capturedUsd: 0, status: 'authorized', approvedBy: approvedBy || null,
      reason: reason || null, metadata: freeze({ ...metadata }), decisionSnapshot: decision,
      fingerprint: budgetFingerprint({ guardId, provider, operation, estimatedCostUsd: decision.estimateUsd, metadata }),
      createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    });
    return this.store.put(record);
  }

  capture(authorizationId, { amountUsd, units = null, unitType = null, metadata = {} } = {}) {
    const auth = this.store.get('money_authorization', authorizationId);
    if (!auth) throw new Error(`money_authorization ${authorizationId} not found`);
    if (!['authorized', 'partially_captured', 'captured'].includes(auth.status)) throw new Error(`cannot capture ${auth.status} authorization`);
    const amount = roundMoney(amountUsd);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('capture amountUsd must be non-negative');
    const guard = this.getGuard(auth.guardId);
    const currentSpend = this.spending(guard.id);
    const providerSpend = this.sliceSpending(guard.id, { provider: auth.provider });
    const operationSpend = this.sliceSpending(guard.id, { operation: auth.operationClass });
    const authRemainingReserve = Math.max(0, auth.reservedUsd - auth.capturedUsd);
    const newAuthCaptured = roundMoney(auth.capturedUsd + amount);
    const newAuthCommitted = Math.max(auth.reservedUsd, newAuthCaptured);
    const currentAuthCommitted = roundMoney(auth.capturedUsd + authRemainingReserve);
    const projectProjectedUsd = roundMoney(currentSpend.committedUsd - currentAuthCommitted + newAuthCommitted);
    const providerProjectedUsd = roundMoney(providerSpend.committedUsd - currentAuthCommitted + newAuthCommitted);
    const operationProjectedUsd = roundMoney(operationSpend.committedUsd - currentAuthCommitted + newAuthCommitted);
    const providerCap = guard.policy.providerCapsUsd[auth.provider] ?? null;
    const operationCap = guard.policy.operationCapsUsd[auth.operation] ?? guard.policy.operationCapsUsd[auth.operationClass] ?? null;
    const overAuthorization = newAuthCaptured > auth.reservedUsd;
    const overProjectCap = projectProjectedUsd > guard.policy.hardCapUsd;
    const overProviderCap = providerCap !== null && providerProjectedUsd > providerCap;
    const overOperationCap = operationCap !== null && operationProjectedUsd > operationCap;

    const updated = this.store.update('money_authorization', auth.id, (current) => freeze({
      ...current,
      capturedUsd: newAuthCaptured,
      status: newAuthCaptured < auth.reservedUsd ? 'partially_captured' : 'captured',
      overAuthorization,
      overProjectCap,
      overProviderCap,
      overOperationCap,
      captureMetadata: freeze({ ...(current.captureMetadata ?? {}), ...metadata }),
      updatedAt: nowIso(this.clock)
    }));

    if (this.ledger && amount > 0) {
      this.ledger.record({
        projectId: auth.projectId, provider: auth.provider, operation: auth.operation,
        amountUsd: amount, units, unitType,
        metadata: { moneyGuardId: guard.id, authorizationId: auth.id, ...metadata }
      }, { clock: this.clock });
    }

    if (overProjectCap || overProviderCap || overOperationCap) {
      const causes = [overProjectCap ? 'project hard cap' : null, overProviderCap ? `provider ${auth.provider} cap` : null, overOperationCap ? `${auth.operationClass} operation cap` : null].filter(Boolean);
      this.store.update('money_guard', guard.id, (current) => freeze({
        ...current, status: 'locked_overrun', lockdownReason: `captured spend exceeded ${causes.join(', ')}`, updatedAt: nowIso(this.clock)
      }));
    }
    return updated;
  }

  release(authorizationId, { reason = 'unused reservation released' } = {}) {
    const auth = this.store.get('money_authorization', authorizationId);
    if (!auth) throw new Error(`money_authorization ${authorizationId} not found`);
    if (!['authorized', 'partially_captured', 'captured'].includes(auth.status)) return auth;
    return this.store.update('money_authorization', auth.id, (current) => freeze({
      ...current, status: 'released', releaseReason: reason, releasedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  lockdown(guardId, { reason } = {}) {
    if (!String(reason ?? '').trim()) throw new Error('Money Guard lockdown requires a reason');
    return this.store.update('money_guard', guardId, (current) => freeze({
      ...current, status: 'locked', lockdownReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  reopen(guardId, { approvedBy, reason } = {}) {
    if (!String(approvedBy ?? '').trim() || !String(reason ?? '').trim()) throw new Error('reopening Money Guard requires approvedBy and reason');
    return this.store.update('money_guard', guardId, (current) => freeze({
      ...current, status: 'active', lockdownReason: null, reopenedBy: approvedBy, reopenReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  report(guardId) {
    const guard = this.getGuard(guardId);
    const spend = this.spending(guardId);
    const authorizations = this.authorizations(guardId);
    const warningThresholdUsd = roundMoney(guard.policy.hardCapUsd * guard.policy.warningThresholdRatio);
    const byProvider = {};
    const byOperation = {};
    for (const row of authorizations) {
      const amount = row.capturedUsd ?? 0;
      byProvider[row.provider] = roundMoney((byProvider[row.provider] ?? 0) + amount);
      byOperation[row.operationClass] = roundMoney((byOperation[row.operationClass] ?? 0) + amount);
    }
    return freeze({
      schemaVersion: MONEY_GUARD_SCHEMA_VERSION,
      release: MONEY_GUARD_RELEASE,
      guardId: guard.id,
      projectId: guard.projectId,
      status: guard.status,
      hardCapUsd: guard.policy.hardCapUsd,
      warningThresholdUsd,
      capturedUsd: spend.capturedUsd,
      reservedUsd: spend.reservedUsd,
      committedUsd: spend.committedUsd,
      availableUsd: roundMoney(Math.max(0, guard.policy.hardCapUsd - spend.committedUsd)),
      warningReached: spend.committedUsd >= warningThresholdUsd,
      providerCapsUsd: guard.policy.providerCapsUsd,
      operationCapsUsd: guard.policy.operationCapsUsd,
      byProvider: freeze(byProvider),
      byOperation: freeze(byOperation),
      authorizationCounts: freeze({
        total: authorizations.length,
        open: authorizations.filter((x) => ['authorized', 'partially_captured'].includes(x.status)).length,
        captured: authorizations.filter((x) => x.status === 'captured').length,
        released: authorizations.filter((x) => x.status === 'released').length
      }),
      acceptingPaidAuthorizations: guard.status === 'active' && spend.committedUsd < guard.policy.hardCapUsd,
      paidGenerationArmed: false,
      providerCallsPerformed: 0
    });
  }
}
