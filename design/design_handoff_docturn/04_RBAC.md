# 04 — RBAC (Roles & Permissions)

Authorization is enforced **server-side** in route handlers and mirrored in the client only for UX
(hiding controls). The server is always the source of truth.

## Roles

| Role | Who | Primary surface |
|---|---|---|
| `director` | Hospital admin | Provider management, rotation config, reassignment, org settings, incidents |
| `er_director` | ER admin | Manages ER physicians; oversees ER-side flow (superset of `er_doctor`) |
| `er_doctor` | ER physician | Patient intake, create assignments, AI intake |
| `hospitalist` | Receiving provider | Census, accept/decline assignments, messaging |
| `developer` | Platform operator | Cross-tenant admin, impersonation, CMS, diagnostics |

## Permission matrix

| Capability | director | er_director | er_doctor | hospitalist | developer |
|---|:--:|:--:|:--:|:--:|:--:|
| View org directory | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create provider account | ✅ | ✅* | — | — | ✅ |
| Toggle own working status | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toggle any provider working status | ✅ | — | — | — | ✅ |
| Edit round-robin / org config | ✅ | — | — | — | ✅ |
| Approve registrations | ✅ | — | — | — | ✅ |
| Register patient (intake) | — | ✅ | ✅ | — | ✅ |
| Create assignment | — | ✅ | ✅ | — | ✅ |
| Accept / reject assignment | — | — | — | ✅ (own) | ✅ |
| Reassign / override assignment | ✅ | ✅ | — | — | ✅ |
| Cancel assignment | ✅ | — | — | — | ✅ |
| Create emergency broadcast | ✅ | — | — | — | ✅ |
| Edit org settings (policy) | ✅ | — | — | — | ✅ |
| Edit own preferences | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read/send messages | ✅ | ✅ | ✅ | ✅ | ✅ |
| Developer console / CMS / impersonate | — | — | — | — | ✅ |
| Cross-tenant access | — | — | — | — | ✅ |

\* `er_director` may only create `er_doctor` accounts.

## Middleware

```ts
requireAuth                              // 401 if no session
requireRole('director','developer')      // 403 if req.user.role not in list
assertSameOrg(resource)                  // 403 if resource.organizationId !== req.user.organizationId
                                         //   (developers bypass — every bypass is audited)
```

Every handler that touches a tenant row must call `assertSameOrg`. The storage layer **also** takes
`organizationId` as its first argument on every method as a second line of defense — a handler
literally cannot query another tenant's rows through it.

## Developer cross-tenant rule

The `developer` role bypasses org-scoping deliberately (it administers all tenants). **Every
cross-tenant access by a developer — including impersonation — writes a `phi_access_logs` /
`audit_logs` entry before the action.** The developer role is **not seeded in production**.

## Threat-model focus (keep in mind while building)

1. **Broken access control** across the large route surface — every route asserts role + tenant.
2. **Cross-tenant leakage** from a missing `organizationId` filter — *especially* in the
   rotation/selection helpers. A selector that ignored tenant scope could route a patient to
   another hospital. Rotation helpers operate strictly within one org.
3. **Info disclosure** — never return `password_hash`; sanitize the user object (`GET /api/user`
   returns id, username, role, displayName, organizationId only).
