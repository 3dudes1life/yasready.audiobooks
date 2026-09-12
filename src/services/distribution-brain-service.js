import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getDistributionProfile,
  validateDistributionMetadata,
  validateDistributionCover,
  profileFreshness,
  normalizeAssetFormat
} from '../distribution/profiles.js';
import { buildW3cAudiobookManifest, validateW3cAudiobookManifest, buildHumanChecklist } from '../distribution/w3c-manifest.js';
import { sha256, stableJson } from '../core/hash.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();

function assertAssetReference(asset, label = 'asset') {
  if (!asset || typeof asset !== 'object') throw new Error(`${label} reference is required`);
  if (['audio', 'data', 'bytesData'].some((key) => key in asset)) throw new Error(`${label} must be an asset reference, not raw bytes`);
  return asset;
}

function authorNames(author) {
  if (Array.isArray(author)) return author.filter(Boolean).map(String);
  return String(author ?? '').trim() ? [String(author).trim()] : [];
}

function assetMediaType(asset) {
  return asset?.mediaType ?? asset?.metadata?.mediaType ?? null;
}

function durationSec(section) {
  const a = section?.postAnalysis ?? {};
  return Number.isFinite(Number(a.durationSec)) ? Number(a.durationSec) : null;
}

function chapterOrder(store, section) {
  const review = store.get('chapter_review', section.chapterReviewId);
  return Number.isFinite(Number(review?.order)) ? Number(review.order) : 999999;
}

function safeName(input, fallback = 'audiobook') {
  const value = String(input ?? '')
    .normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

export class DistributionBrainService {
  constructor(store, {
    assetMaterializer = null,
    packageSink = null,
    clock = () => new Date()
  } = {}) {
    if (!store) throw new Error('DistributionBrainService requires a store');
    this.store = store;
    this.assetMaterializer = assetMaterializer;
    this.packageSink = packageSink;
    this.clock = clock;
  }

  createProject({ projectId, bookId, masteringPlanId, name = 'Audiobook Distribution', metadata = {}, digitalNarration = null, narrationProvider = null }) {
    if (!projectId || !bookId || !masteringPlanId) throw new Error('distribution project requires projectId, bookId and masteringPlanId');
    const master = this.store.get('mastering_plan', masteringPlanId);
    if (!master || master.projectId !== projectId || master.bookId !== bookId) throw new Error('distribution project requires a mastering plan for the same project/book');
    const existing = this.store.list('distribution_project', (row) => row.masteringPlanId === masteringPlanId)[0];
    if (existing) return existing;
    const merged = freeze({
      ...metadata,
      title: metadata.title ?? master.title,
      author: metadata.author ?? master.author,
      narrators: freeze([...(metadata.narrators ?? master.narrators ?? [])]),
      language: metadata.language ?? 'en'
    });
    const now = nowIso(this.clock);
    return this.store.put(freeze({
      id: randomUUID(), type: 'distribution_project', projectId, bookId, masteringPlanId, name,
      metadata: merged, digitalNarration, narrationProvider,
      rightsConfirmed: false, rightsConfirmedBy: null, rightsConfirmedAt: null,
      status: 'draft', locked: false, createdAt: now, updatedAt: now
    }));
  }

  getProject(id) {
    const project = this.store.get('distribution_project', id);
    if (!project) throw new Error(`distribution_project ${id} not found`);
    return project;
  }

  #packageInputDigest(targetId) {
    const target = this.store.get('distribution_target', targetId);
    if (!target) throw new Error(`distribution_target ${targetId} not found`);
    const project = this.getProject(target.distributionProjectId);
    const { master, chapters, opening, closing } = this.#masteringAssets(project);
    const compactSection = (row) => row ? ({
      id: row.id, kind: row.kind ?? null, chapterId: row.chapterId ?? null,
      outputFileName: row.outputFileName ?? null, status: row.status ?? null,
      asset: row.asset ?? null, postAnalysis: row.postAnalysis ?? null
    }) : null;
    return sha256(stableJson({
      profileId: target.profileId,
      profileRevisionDate: target.profileRevisionDate,
      platformEligibilityConfirmed: Boolean(target.platformEligibilityConfirmed),
      platformEligibilityNote: target.platformEligibilityNote ?? null,
      metadata: project.metadata,
      digitalNarration: project.digitalNarration,
      narrationProvider: project.narrationProvider,
      rightsConfirmed: Boolean(project.rightsConfirmed),
      rightsTerritories: project.rightsTerritories ?? null,
      cover: project.cover ?? null,
      sample: project.sample ?? null,
      mastering: {
        id: master.id, profileId: master.profileId, status: master.status, locked: master.locked,
        chapters: chapters.map(compactSection), opening: compactSection(opening), closing: compactSection(closing)
      }
    }));
  }

  #invalidateTargetPackage(targetId, reason) {
    const target = this.store.get('distribution_target', targetId);
    if (!target?.packageId) return target;
    const now = nowIso(this.clock);
    const pkg = this.store.get('distribution_package', target.packageId);
    if (pkg && !['stale', 'invalidated'].includes(pkg.status)) {
      this.store.update('distribution_package', pkg.id, (current) => freeze({
        ...current, status: 'stale', staleReason: reason, invalidatedAt: now, updatedAt: now
      }));
    }
    const invalidated = this.store.update('distribution_target', targetId, (current) => freeze({
      ...current, status: 'stale', stalePackageId: current.packageId, packageId: null,
      staleReason: reason, invalidatedAt: now, updatedAt: now
    }));
    const project = this.store.get('distribution_project', target.distributionProjectId);
    if (project?.locked) {
      this.store.update('distribution_project', project.id, (current) => freeze({
        ...current, status: 'stale', locked: false,
        finalizationInvalidatedAt: now, finalizationInvalidationReason: reason,
        updatedAt: now
      }));
    }
    return invalidated;
  }

  #invalidateProjectPackages(distributionProjectId, reason) {
    for (const target of this.store.list('distribution_target', (row) => row.distributionProjectId === distributionProjectId)) {
      this.#invalidateTargetPackage(target.id, reason);
    }
  }

  updateMetadata(id, patch = {}) {
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    const updated = this.store.update('distribution_project', id, (current) => freeze({
      ...current,
      metadata: freeze({ ...current.metadata, ...patch }),
      updatedAt: nowIso(this.clock)
    }));
    this.#invalidateProjectPackages(id, 'distribution metadata changed after packaging');
    return updated;
  }

  setDigitalNarration(id, { enabled, provider = null }) {
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    if (typeof enabled !== 'boolean') throw new Error('digital narration must be explicitly true or false');
    const updated = this.store.update('distribution_project', id, (current) => freeze({
      ...current, digitalNarration: enabled, narrationProvider: enabled ? provider : null,
      updatedAt: nowIso(this.clock)
    }));
    this.#invalidateProjectPackages(id, 'digital narration disclosure changed after packaging');
    return updated;
  }

  confirmRights(id, { confirmedBy, territories = 'WORLD' } = {}) {
    if (!String(confirmedBy ?? '').trim()) throw new Error('rights confirmation requires confirmedBy');
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    const updated = this.store.update('distribution_project', id, (current) => freeze({
      ...current, rightsConfirmed: true, rightsConfirmedBy: confirmedBy,
      rightsTerritories: territories, rightsConfirmedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
    this.#invalidateProjectPackages(id, 'distribution rights or territories changed after packaging');
    return updated;
  }

  attachCover(id, asset) {
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    assertAssetReference(asset, 'cover');
    const updated = this.store.update('distribution_project', id, (current) => freeze({ ...current, cover: freeze({ ...asset }), updatedAt: nowIso(this.clock) }));
    this.#invalidateProjectPackages(id, 'distribution cover changed after packaging');
    return updated;
  }

  attachSample(id, asset) {
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    assertAssetReference(asset, 'sample');
    const updated = this.store.update('distribution_project', id, (current) => freeze({ ...current, sample: freeze({ ...asset }), updatedAt: nowIso(this.clock) }));
    this.#invalidateProjectPackages(id, 'distribution sample changed after packaging');
    return updated;
  }

  addTarget(id, profileId) {
    const project = this.getProject(id);
    if (project.locked) throw new Error('distribution project is locked');
    const profile = getDistributionProfile(profileId);
    const existing = this.store.list('distribution_target', (row) => row.distributionProjectId === id && row.profileId === profile.id)[0];
    if (existing) return existing;
    const now = nowIso(this.clock);
    return this.store.put(freeze({
      id: randomUUID(), type: 'distribution_target', distributionProjectId: id, projectId: project.projectId,
      profileId: profile.id, profileRevisionDate: profile.revisionDate, route: profile.route,
      platformEligibilityConfirmed: false, platformEligibilityConfirmedBy: null,
      status: 'draft', packageId: null, createdAt: now, updatedAt: now
    }));
  }

  confirmPlatformEligibility(targetId, { confirmedBy, note }) {
    if (!String(confirmedBy ?? '').trim() || !String(note ?? '').trim()) throw new Error('platform eligibility confirmation requires confirmedBy and note');
    const target = this.store.get('distribution_target', targetId);
    if (!target) throw new Error(`distribution_target ${targetId} not found`);
    const project = this.getProject(target.distributionProjectId);
    if (project.locked) throw new Error('distribution project is locked');
    this.store.update('distribution_target', targetId, (current) => freeze({
      ...current, platformEligibilityConfirmed: true, platformEligibilityConfirmedBy: confirmedBy,
      platformEligibilityNote: note, platformEligibilityConfirmedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
    this.#invalidateTargetPackage(targetId, 'platform eligibility confirmation changed after packaging');
    return this.store.get('distribution_target', targetId);
  }

  #masteringAssets(project) {
    const master = this.store.get('mastering_plan', project.masteringPlanId);
    if (!master) throw new Error('mastering plan not found');
    const chapters = this.store.list('mastering_section', (row) => row.planId === master.id && row.status === 'passed')
      .sort((a, b) => chapterOrder(this.store, a) - chapterOrder(this.store, b));
    const credits = this.store.list('mastering_credit_section', (row) => row.planId === master.id && row.status === 'passed');
    const opening = credits.find((row) => row.kind === 'opening') ?? null;
    const closing = credits.find((row) => row.kind === 'closing') ?? null;
    return { master, chapters, opening, closing };
  }

  preflightTarget(targetId, { now = this.clock() } = {}) {
    const target = this.store.get('distribution_target', targetId);
    if (!target) throw new Error(`distribution_target ${targetId} not found`);
    const project = this.getProject(target.distributionProjectId);
    const profile = getDistributionProfile(target.profileId);
    const blockers = [];
    const warnings = [];
    const { master, chapters, opening, closing } = this.#masteringAssets(project);

    if (master.status !== 'mastered' || !master.locked) blockers.push({ code: 'mastering-not-finalized', message: 'Finish and lock Mastering Lab before distribution.' });
    if (!profile.acceptedMasteringProfiles.includes(master.profileId)) blockers.push({ code: 'mastering-profile-incompatible', message: `${profile.label} is not configured to accept the ${master.profileId} master. Create a compatible master first.` });
    if (!chapters.length) blockers.push({ code: 'chapters-missing', message: 'No passed chapter masters were found.' });
    if (profile.requiresOpeningCredits && !opening) blockers.push({ code: 'opening-credits-missing', message: 'Opening credits master is missing.' });
    if (profile.requiresClosingCredits && !closing) blockers.push({ code: 'closing-credits-missing', message: 'Closing credits master is missing.' });
    if (!project.rightsConfirmed) blockers.push({ code: 'rights-unconfirmed', message: 'Confirm audiobook distribution rights and territories.' });

    const metadataCheck = validateDistributionMetadata(project.metadata, profile);
    blockers.push(...metadataCheck.errors);
    warnings.push(...metadataCheck.warnings);
    const coverCheck = validateDistributionCover(project.cover ?? null, profile);
    blockers.push(...coverCheck.errors);
    warnings.push(...coverCheck.warnings);

    if (profile.digitalNarration === 'disclosure-required' && typeof project.digitalNarration !== 'boolean') {
      blockers.push({ code: 'digital-narration-disclosure-unset', message: 'State whether this audiobook uses digital voice narration.' });
    }
    if (profile.digitalNarration === 'disclosure-required' && project.digitalNarration && !String(project.narrationProvider ?? '').trim()) {
      warnings.push({ code: 'digital-narration-provider-missing', message: 'Recording the narration provider is recommended for provenance and support.' });
    }
    const manualEligibilityRequired = profile.digitalNarration === 'manual-eligibility-check' && project.digitalNarration === true;
    if (manualEligibilityRequired && !target.platformEligibilityConfirmed) {
      blockers.push({ code: 'platform-eligibility-unconfirmed', message: 'Technical compliance is not platform-policy approval. Confirm current narration eligibility before submission.' });
    }
    if (profile.digitalNarration === 'partner-dependent' && project.digitalNarration === true) {
      warnings.push({ code: 'partner-digital-narration-policy', message: 'Confirm digital narration policy with the selected Apple Books distribution partner.' });
    }
    if (profile.sample === 'recommended' && !project.sample) warnings.push({ code: 'sample-recommended', message: `${profile.label} recommends a listener sample.` });

    const filenames = [opening?.outputFileName, ...chapters.map((x) => x.outputFileName), closing?.outputFileName].filter(Boolean);
    if (new Set(filenames.map((x) => x.toLowerCase())).size !== filenames.length) blockers.push({ code: 'duplicate-output-filenames', message: 'Two mastered files have the same output filename.' });

    const channelCounts = new Set([...chapters, opening, closing].filter(Boolean).map((x) => x.postAnalysis?.channels).filter((x) => Number.isFinite(Number(x))).map(Number));
    if (channelCounts.size > 1) blockers.push({ code: 'mixed-channel-layout', message: 'All audiobook audio files must use a consistent mono/stereo channel layout.' });

    for (const section of chapters) {
      const analysis = section.postAnalysis ?? {};
      const format = normalizeAssetFormat(section.outputFileName?.split('.').pop() ?? assetMediaType(section.asset));
      if (profile.audio.formats?.length && format && !profile.audio.formats.includes(format)) blockers.push({ code: 'audio-format', message: `${section.outputFileName} is not an accepted ${profile.label} audio format.` });
      if (Number.isFinite(profile.audio.maxSectionDurationSec) && Number(analysis.durationSec) > profile.audio.maxSectionDurationSec) blockers.push({ code: 'chapter-duration', message: `${section.title ?? section.outputFileName} exceeds ${Math.round(profile.audio.maxSectionDurationSec / 60)} minutes.` });
      if (Number.isFinite(profile.audio.minimumBitrateKbps)) {
        if (!Number.isFinite(Number(analysis.bitrateKbps))) blockers.push({ code: 'audio-bitrate-unverified', message: `${section.outputFileName} bitrate could not be verified.` });
        else if (Number(analysis.bitrateKbps) < profile.audio.minimumBitrateKbps) blockers.push({ code: 'audio-bitrate', message: `${section.outputFileName} is below ${profile.audio.minimumBitrateKbps} kbps.` });
      }
      if (Number.isFinite(profile.audio.sampleRateHz)) {
        if (!Number.isFinite(Number(analysis.sampleRateHz))) blockers.push({ code: 'audio-sample-rate-unverified', message: `${section.outputFileName} sample rate could not be verified.` });
        else if (Number(analysis.sampleRateHz) !== profile.audio.sampleRateHz) blockers.push({ code: 'audio-sample-rate', message: `${section.outputFileName} must be ${profile.audio.sampleRateHz} Hz.` });
      }
    }

    const freshness = profileFreshness(profile, { now });
    if (freshness.stale) warnings.push({ code: 'profile-rules-stale', message: `Platform rules were last reviewed ${freshness.revisionDate}; re-check current platform requirements before submission.` });

    const currentTarget = this.store.get('distribution_target', targetId);
    if (currentTarget?.packageId) {
      const pkg = this.store.get('distribution_package', currentTarget.packageId);
      const currentDigest = this.#packageInputDigest(targetId);
      if (!pkg || pkg.sourceDigest !== currentDigest || ['stale', 'invalidated'].includes(pkg.status)) {
        blockers.push({ code: 'package-stale', message: 'The distribution package is stale because package-producing inputs changed. Rebuild the package.' });
        this.#invalidateTargetPackage(targetId, 'package source digest no longer matches current distribution truth');
      }
    }

    const ready = blockers.length === 0;
    const result = freeze({
      targetId, profileId: profile.id, profileLabel: profile.label, route: profile.route,
      readyToPackage: ready,
      readyToSubmit: ready && profile.route === 'manual-upload',
      readyToHandoff: ready,
      manualEligibilityRequired,
      blockerCount: blockers.length, warningCount: warnings.length,
      blockers: freeze(blockers.map(freeze)), warnings: freeze(warnings.map(freeze)), freshness,
      nextAction: ready ? 'Build distribution package' : blockers[0]?.message ?? 'Resolve distribution blockers'
    });
    this.store.update('distribution_target', targetId, (current) => freeze({
      ...current,
      status: current.status === 'stale' ? 'stale' : (['packaged', 'exported'].includes(current.status) ? current.status : (ready ? 'preflighted' : 'blocked')),
      updatedAt: nowIso(this.clock)
    }));
    return result;
  }

  buildTargetPackage(targetId) {
    const preflight = this.preflightTarget(targetId);
    if (!preflight.readyToPackage) throw new Error(`distribution package blocked: ${preflight.blockers.map((x) => x.code).join(', ')}`);
    const target = this.store.get('distribution_target', targetId);
    const project = this.getProject(target.distributionProjectId);
    const sourceDigest = this.#packageInputDigest(targetId);
    if (target.packageId) {
      const existing = this.store.get('distribution_package', target.packageId);
      if (existing && existing.sourceDigest === sourceDigest && !['stale', 'invalidated'].includes(existing.status)) return existing;
    }
    const profile = getDistributionProfile(target.profileId);
    const { master, chapters, opening, closing } = this.#masteringAssets(project);
    const files = [];
    if (opening) files.push(freeze({ role: 'opening-credits', fileName: opening.outputFileName, title: 'Opening Credits', asset: opening.asset, mediaType: assetMediaType(opening.asset), durationSec: durationSec(opening) }));
    for (const section of chapters) files.push(freeze({ role: 'chapter', fileName: section.outputFileName, title: section.title, asset: section.asset, mediaType: assetMediaType(section.asset), durationSec: durationSec(section), chapterId: section.chapterId }));
    if (closing) files.push(freeze({ role: 'closing-credits', fileName: closing.outputFileName, title: 'Closing Credits', asset: closing.asset, mediaType: assetMediaType(closing.asset), durationSec: durationSec(closing) }));

    const w3c = buildW3cAudiobookManifest({
      metadata: project.metadata,
      readingOrder: files.map((item) => ({ fileName: `audio/${item.fileName}`, title: item.title, mediaType: item.mediaType, durationSec: item.durationSec })),
      cover: project.cover ? { fileName: `artwork/${safeName(project.cover.fileName ?? `cover.${normalizeAssetFormat(assetMediaType(project.cover)) || 'jpg'}`, 'cover.jpg')}`, mediaType: assetMediaType(project.cover) } : null,
      dateModified: nowIso(this.clock)
    });
    const w3cValidation = validateW3cAudiobookManifest(w3c);
    if (!w3cValidation.valid) throw new Error(`generated W3C manifest is invalid: ${w3cValidation.errors.join(', ')}`);

    const checklist = buildHumanChecklist({ profile, metadata: project.metadata, warnings: preflight.warnings, manualEligibilityRequired: preflight.manualEligibilityRequired });
    const now = nowIso(this.clock);
    const packageRecord = this.store.put(freeze({
      id: randomUUID(), type: 'distribution_package', targetId, distributionProjectId: project.id,
      projectId: project.projectId, profileId: profile.id, masteringProfileId: master.profileId,
      status: 'ready', files: freeze(files), cover: project.cover ? freeze({ ...project.cover }) : null,
      sample: project.sample ? freeze({ ...project.sample }) : null,
      metadata: project.metadata, digitalNarration: project.digitalNarration, narrationProvider: project.narrationProvider,
      rightsTerritories: project.rightsTerritories ?? null,
      sourceDigest,
      w3cManifest: w3c, checklist,
      packageName: safeName(`${project.metadata.title ?? 'audiobook'}-${profile.id}`),
      createdAt: now, updatedAt: now
    }));
    this.store.update('distribution_target', targetId, (current) => freeze({
      ...current, status: 'packaged', packageId: packageRecord.id, packageSourceDigest: sourceDigest,
      stalePackageId: null, staleReason: null, invalidatedAt: null, updatedAt: now
    }));
    return packageRecord;
  }

  async exportPackage(packageId) {
    const pkg = this.store.get('distribution_package', packageId);
    if (!pkg) throw new Error(`distribution_package ${packageId} not found`);
    const target = this.store.get('distribution_target', pkg.targetId);
    if (!target || target.packageId !== packageId || pkg.status === 'stale' || pkg.sourceDigest !== this.#packageInputDigest(pkg.targetId)) {
      if (target?.packageId === packageId) this.#invalidateTargetPackage(pkg.targetId, 'distribution package became stale before export');
      throw new Error('distribution package is stale; rebuild before export');
    }
    if (typeof this.assetMaterializer !== 'function') throw new Error('distribution export requires assetMaterializer');
    if (typeof this.packageSink !== 'function') throw new Error('distribution export requires packageSink');
    const dir = await mkdtemp(path.join(tmpdir(), 'yasready-distribution-'));
    try {
      await mkdir(path.join(dir, 'audio'), { recursive: true });
      await mkdir(path.join(dir, 'artwork'), { recursive: true });
      await mkdir(path.join(dir, 'metadata'), { recursive: true });
      for (const item of pkg.files) {
        const source = await this.assetMaterializer(assertAssetReference(item.asset, item.role), { package: pkg, item });
        await copyFile(source, path.join(dir, 'audio', safeName(item.fileName, 'audio.mp3')));
      }
      if (pkg.cover) {
        const source = await this.assetMaterializer(assertAssetReference(pkg.cover, 'cover'), { package: pkg, role: 'cover' });
        await copyFile(source, path.join(dir, 'artwork', safeName(pkg.cover.fileName ?? 'cover.jpg', 'cover.jpg')));
      }
      if (pkg.sample) {
        const source = await this.assetMaterializer(assertAssetReference(pkg.sample, 'sample'), { package: pkg, role: 'sample' });
        await copyFile(source, path.join(dir, 'audio', safeName(pkg.sample.fileName ?? 'sample.mp3', 'sample.mp3')));
      }
      await writeFile(path.join(dir, 'metadata', 'metadata.json'), `${JSON.stringify({ ...pkg.metadata, digitalNarration: pkg.digitalNarration, narrationProvider: pkg.narrationProvider, rightsTerritories: pkg.rightsTerritories }, null, 2)}\n`, 'utf8');
      await writeFile(path.join(dir, 'metadata', 'audiobook-manifest.json'), `${JSON.stringify(pkg.w3cManifest, null, 2)}\n`, 'utf8');
      await writeFile(path.join(dir, 'CHECKLIST.txt'), pkg.checklist, 'utf8');
      const asset = await this.packageSink(dir, { package: pkg });
      assertAssetReference(asset, 'package');
      const updated = this.store.update('distribution_package', packageId, (current) => freeze({ ...current, status: 'exported', asset: freeze({ ...asset }), exportedAt: nowIso(this.clock), updatedAt: nowIso(this.clock) }));
      this.store.update('distribution_target', pkg.targetId, (current) => freeze({ ...current, status: 'exported', updatedAt: nowIso(this.clock) }));
      return updated;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  dashboard(id) {
    const project = this.getProject(id);
    const targets = this.store.list('distribution_target', (row) => row.distributionProjectId === id);
    const targetRows = targets.map((target) => {
      const profile = getDistributionProfile(target.profileId);
      let preflight;
      try { preflight = this.preflightTarget(target.id); } catch (error) { preflight = { readyToPackage: false, blockers: [{ code: 'preflight-error', message: error.message }], warnings: [], nextAction: error.message }; }
      return freeze({ id: target.id, profileId: profile.id, label: profile.label, route: profile.route, status: this.store.get('distribution_target', target.id)?.status ?? target.status, ready: preflight.readyToPackage, blockers: preflight.blockers, warnings: preflight.warnings, nextAction: preflight.nextAction });
    });
    const allReady = targetRows.length > 0 && targetRows.every((row) => row.ready || ['packaged', 'exported'].includes(row.status));
    return freeze({
      id, title: project.metadata.title ?? null, rightsConfirmed: project.rightsConfirmed,
      digitalNarration: project.digitalNarration, targetCount: targetRows.length,
      status: targetRows.some((x) => x.blockers?.length) ? 'needs_attention' : allReady ? 'ready' : 'setup',
      nextAction: targetRows.length === 0 ? 'Choose at least one distribution destination' : targetRows.find((x) => x.blockers?.length)?.nextAction ?? (allReady ? 'Export distribution packages' : 'Complete distribution setup'),
      targets: freeze(targetRows)
    });
  }

  lockProject(id, { reviewer }) {
    if (!String(reviewer ?? '').trim()) throw new Error('locking distribution requires reviewer');
    const project = this.getProject(id);
    const targets = this.store.list('distribution_target', (row) => row.distributionProjectId === id);
    if (!targets.length) throw new Error('distribution project cannot lock until every target is packaged');
    for (const target of targets) this.preflightTarget(target.id);
    const currentTargets = this.store.list('distribution_target', (row) => row.distributionProjectId === id);
    const invalid = currentTargets.some((target) => {
      if (!['packaged', 'exported'].includes(target.status) || !target.packageId) return true;
      const pkg = this.store.get('distribution_package', target.packageId);
      return !pkg || pkg.sourceDigest !== this.#packageInputDigest(target.id) || pkg.status === 'stale';
    });
    if (invalid) throw new Error('distribution project cannot lock until every target has a current, non-stale package');
    return this.store.update('distribution_project', id, (current) => freeze({ ...current, status: 'ready', locked: true, finalizedBy: reviewer, finalizedAt: nowIso(this.clock), updatedAt: nowIso(this.clock) }));
  }
}
