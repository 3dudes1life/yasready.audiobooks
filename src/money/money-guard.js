import { sha256, stableJson } from '../core/hash.js';

export const MONEY_GUARD_RELEASE = '0.13.1';
export const MONEY_GUARD_SCHEMA_VERSION = 1;

const freeze = (value) => Object.freeze(value);
const roundMoney = (value) => Number(Number(value ?? 0).toFixed(6));

export const MONEY_GUARD_OPERATION_CLASSES = freeze({
  audition_render: 'audition',
  production_render: 'production',
  production_regeneration: 'regeneration',
  qa_alignment: 'qa',
  qa_transcription: 'qa',
  mastering_external: 'mastering',
  distribution_external: 'distribution'
});

export function operationClass(operation) {
  return MONEY_GUARD_OPERATION_CLASSES[operation] ?? 'other';
}

export function normalizeMoneyPolicy({
  hardCapUsd,
  warningThresholdRatio = 0.8,
  singleActionApprovalUsd = 5,
  estimateVarianceRatio = 0.1,
  providerCapsUsd = {},
  operationCapsUsd = {},
  requireApprovalAtWarning = true
} = {}) {
  const hardCap = Number(hardCapUsd);
  if (!Number.isFinite(hardCap) || hardCap <= 0) throw new Error('Money Guard requires a positive hardCapUsd');
  const warning = Number(warningThresholdRatio);
  if (!Number.isFinite(warning) || warning <= 0 || warning > 1) throw new Error('warningThresholdRatio must be > 0 and <= 1');
  const approval = Number(singleActionApprovalUsd);
  if (!Number.isFinite(approval) || approval < 0) throw new Error('singleActionApprovalUsd must be non-negative');
  const variance = Number(estimateVarianceRatio);
  if (!Number.isFinite(variance) || variance < 0 || variance > 1) throw new Error('estimateVarianceRatio must be between 0 and 1');
  const validateCaps = (caps, label) => Object.fromEntries(Object.entries(caps ?? {}).map(([key, value]) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}.${key} must be non-negative`);
    return [key, roundMoney(n)];
  }));
  return freeze({
    hardCapUsd: roundMoney(hardCap),
    warningThresholdRatio: warning,
    singleActionApprovalUsd: roundMoney(approval),
    estimateVarianceRatio: variance,
    providerCapsUsd: freeze(validateCaps(providerCapsUsd, 'providerCapsUsd')),
    operationCapsUsd: freeze(validateCaps(operationCapsUsd, 'operationCapsUsd')),
    requireApprovalAtWarning: Boolean(requireApprovalAtWarning)
  });
}

export function budgetFingerprint(input) {
  return sha256(stableJson(input));
}

export function moneyGuardDecision({
  policy,
  capturedUsd = 0,
  reservedUsd = 0,
  providerCapturedUsd = 0,
  providerReservedUsd = 0,
  operationCapturedUsd = 0,
  operationReservedUsd = 0,
  estimatedCostUsd,
  provider,
  operation,
  approvedBy = null
}) {
  const estimate = roundMoney(estimatedCostUsd);
  if (!Number.isFinite(estimate) || estimate < 0) throw new Error('estimatedCostUsd must be non-negative');
  if (!provider) throw new Error('Money Guard decision requires provider');
  if (!operation) throw new Error('Money Guard decision requires operation');

  const reserveUsd = roundMoney(estimate * (1 + policy.estimateVarianceRatio));
  const projectedCommittedUsd = roundMoney(capturedUsd + reservedUsd + reserveUsd);
  const providerCap = policy.providerCapsUsd[provider] ?? null;
  const operationKey = operationClass(operation);
  const operationCap = policy.operationCapsUsd[operation] ?? policy.operationCapsUsd[operationKey] ?? null;
  const providerProjectedUsd = roundMoney(providerCapturedUsd + providerReservedUsd + reserveUsd);
  const operationProjectedUsd = roundMoney(operationCapturedUsd + operationReservedUsd + reserveUsd);

  const reasons = [];
  if (projectedCommittedUsd > policy.hardCapUsd) reasons.push('project-hard-cap');
  if (providerCap !== null && providerProjectedUsd > providerCap) reasons.push('provider-cap');
  if (operationCap !== null && operationProjectedUsd > operationCap) reasons.push('operation-cap');

  const warningThresholdUsd = roundMoney(policy.hardCapUsd * policy.warningThresholdRatio);
  const warningReached = projectedCommittedUsd >= warningThresholdUsd;
  const singleActionApprovalRequired = estimate >= policy.singleActionApprovalUsd && policy.singleActionApprovalUsd > 0;
  const approvalRequired = singleActionApprovalRequired || (policy.requireApprovalAtWarning && warningReached);
  if (approvalRequired && !String(approvedBy ?? '').trim()) reasons.push('approval-required');

  const blocked = reasons.some((reason) => ['project-hard-cap', 'provider-cap', 'operation-cap', 'approval-required'].includes(reason));
  return freeze({
    status: blocked ? 'BLOCKED' : (warningReached ? 'WARNING' : 'SAFE'),
    blocked,
    warningReached,
    approvalRequired,
    reserveUsd,
    estimateUsd: estimate,
    projectedCommittedUsd,
    projectHardCapUsd: policy.hardCapUsd,
    providerCapUsd: providerCap,
    providerProjectedUsd,
    operationCapUsd: operationCap,
    operationProjectedUsd,
    reasons: freeze(reasons)
  });
}
