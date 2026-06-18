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
