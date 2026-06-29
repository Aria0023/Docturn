import { describe, it, expect, beforeEach } from 'vitest';
import { seedFixture, type SeedResult } from './helpers.js';
import { rotation } from '../server/services/rotation.js';
import { assignmentService } from '../server/services/assignments.js';
import { assignmentStore, hospitalistStore } from '../server/storage.js';
import { db } from '../server/db.js';
import { assignments } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

let fx: SeedResult;

describe('assignments / round-robin', () => {
  beforeEach(() => {
    fx = seedFixture();
  });

  it('round-robin selects the lowest-census working provider', async () => {
    // h1 census=2, h2 census=0, h3 not working. Expect h2.
    const sel = await rotation.selectNext(fx.org.id);
    expect(sel.hospitalist?.id).toBe(fx.hosp.h2.id);
    expect(sel.reason).toBe('lowest_census');
  });

  it('accept increases the provider census', async () => {
    const { assignment } = await assignmentService.create({ orgId: fx.org.id, patientId: fx.patients.pSC.id });
    expect(assignment).toBeTruthy();
    const before = await hospitalistStore.getById(assignment!.hospitalistId);
    const accUser = fx.users.hosp2User; // h2 selected
    await assignmentService.accept(assignment!.id, accUser.id);
    const after = await hospitalistStore.getById(assignment!.hospitalistId);
    expect(after!.census).toBe(before!.census + 1);
    const reloaded = await assignmentStore.getById(assignment!.id);
    expect(reloaded!.status).toBe('accepted');
  });

  it('reject triggers a reroute to a different provider', async () => {
    const { assignment } = await assignmentService.create({ orgId: fx.org.id, patientId: fx.patients.pSC.id });
    const firstHosp = assignment!.hospitalistId;
    const result = await assignmentService.reject(assignment!.id, fx.users.hosp2User.id, 'too busy');
    expect(result.assignment!.status).toBe('rejected');
    expect(result.reassigned).toBeTruthy();
    expect(result.reassigned!.hospitalistId).not.toBe(firstHosp);
  });

  it('expire triggers a reroute', async () => {
    const { assignment } = await assignmentService.create({ orgId: fx.org.id, patientId: fx.patients.pSC.id });
    const firstHosp = assignment!.hospitalistId;
    // Force expiry in the past.
    db.update(assignments).set({ expiresAt: Math.floor(Date.now() / 1000) - 10 }).where(eq(assignments.id, assignment!.id)).run();
    const rerouted = await assignmentService.expireAndReroute(assignment!.id);
    const expired = await assignmentStore.getById(assignment!.id);
    expect(expired!.status).toBe('expired');
    expect(rerouted).toBeTruthy();
    expect(rerouted!.hospitalistId).not.toBe(firstHosp);
  });

  it('cancel decreases census when the assignment was accepted', async () => {
    const { assignment } = await assignmentService.create({ orgId: fx.org.id, patientId: fx.patients.pSC.id });
    await assignmentService.accept(assignment!.id, fx.users.hosp2User.id);
    const afterAccept = await hospitalistStore.getById(assignment!.hospitalistId);
    await assignmentService.cancel(assignment!.id, fx.users.hosp2User.id);
    const afterCancel = await hospitalistStore.getById(assignment!.hospitalistId);
    expect(afterCancel!.census).toBe(afterAccept!.census - 1);
    const reloaded = await assignmentStore.getById(assignment!.id);
    expect(reloaded!.status).toBe('cancelled');
  });

  it('does not select providers from another org (org-scoped)', async () => {
    // org2 has one working hospitalist (o2h). Selecting for org should never pick it.
    const selOrg1 = await rotation.selectNext(fx.org.id);
    expect(selOrg1.hospitalist?.orgId).toBe(fx.org.id);

    const selOrg2 = await rotation.selectNext(fx.org2.id);
    expect(selOrg2.hospitalist?.id).toBe(fx.hosp.o2h.id);
    expect(selOrg2.hospitalist?.orgId).toBe(fx.org2.id);
  });

  it('cap relief raises capacities when the board is full', async () => {
    // Saturate both working providers to capacity.
    await hospitalistStore.update(fx.hosp.h1.id, { census: 12, capacity: 12 });
    await hospitalistStore.update(fx.hosp.h2.id, { census: 10, capacity: 10 });
    const noRelief = await rotation.selectNext(fx.org.id);
    expect(noRelief.hospitalist).toBeNull();

    const withRelief = await rotation.selectNext(fx.org.id, { capRelief: true });
    expect(withRelief.hospitalist).toBeTruthy();
    expect(withRelief.capReliefApplied).toBe(true);
  });
});
