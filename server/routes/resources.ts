import type { Express } from "express";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

// Departments, beds, equipment, and a small live metrics rollup.
export function registerResourceRoutes(app: Express) {
  app.get("/api/departments", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listDepartments(me.organizationId));
  });

  app.post(
    "/api/departments",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const { code, name, bedCapacity } = req.body ?? {};
      if (!code || !name) return res.status(400).json({ error: "validation_error" });
      const dept = await storage().createDepartment({
        organizationId: me.organizationId,
        code: String(code),
        name: String(name),
        bedCapacity: Number(bedCapacity) || 0,
      });
      res.status(201).json(dept);
    },
  );

  app.get("/api/beds", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listBeds(me.organizationId));
  });

  app.post(
    "/api/beds",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const { label, departmentId } = req.body ?? {};
      if (!label) return res.status(400).json({ error: "validation_error" });
      const bed = await storage().createBed({
        organizationId: me.organizationId,
        departmentId: departmentId ? Number(departmentId) : null,
        label: String(label),
        occupied: false,
      });
      res.status(201).json(bed);
    },
  );

  app.patch("/api/beds/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const updated = await storage().updateBed(me.organizationId, Number(req.params.id), {
      occupied: Boolean(req.body?.occupied),
    });
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });

  app.get("/api/equipment", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(await storage().listEquipment(me.organizationId));
  });

  app.post(
    "/api/equipment",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const { name } = req.body ?? {};
      if (!name) return res.status(400).json({ error: "validation_error" });
      const item = await storage().createEquipment({
        organizationId: me.organizationId,
        name: String(name),
        status: "available",
      });
      res.status(201).json(item);
    },
  );

  app.patch("/api/equipment/:id", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const status = req.body?.status;
    if (!["available", "in_use", "maintenance"].includes(status)) {
      return res.status(400).json({ error: "validation_error" });
    }
    const updated = await storage().updateEquipment(me.organizationId, Number(req.params.id), { status });
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });

  app.get("/api/resources/metrics", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const [depts, beds, equip] = await Promise.all([
      storage().listDepartments(me.organizationId),
      storage().listBeds(me.organizationId),
      storage().listEquipment(me.organizationId),
    ]);
    const occupied = beds.filter((b) => b.occupied).length;
    res.json({
      departments: depts.length,
      beds: { total: beds.length, occupied, free: beds.length - occupied },
      equipment: {
        total: equip.length,
        available: equip.filter((e) => e.status === "available").length,
      },
    });
  });
}
