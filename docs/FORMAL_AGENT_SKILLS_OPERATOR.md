# Formal Agent Skills v1 — Operator Contract

Eight governance Skills are discoverable from
`config/formal_agent_skill_registry_v1.json`. Each package contains canonical
`SKILL.md` instructions and `agents/openai.yaml` discovery metadata.

The runtime is local and read-only. An invocation must pass the versioned input
schema, obtain a registered local session and matching lease, then consume a
sealed grant within 20 seconds. Grants are binding-specific and single-use.
The binding allowlist contains only `.read` operations; it exposes no UAT
transport, credential, mutation, circuit admission, exploration selection, or
Kill Switch operation.

Grant issuance also requires four explicit, versioned preconditions: an enabled
and admitting read budget, an enabled `CLOSED` circuit, enabled and confirmed
capability evidence, and enabled Kill Switch enforcement with no active switch.
The precondition provider is injectable at composition time. Missing providers,
missing gates, unknown states, disabled enforcement, denied budgets, OPEN or
HALF_OPEN circuits, unconfirmed capability, and active Kill Switches all fail
closed.

The canonicalized safe gate snapshot is SHA-256 bound into the HMAC-sealed
grant together with the four policy/evidence versions. The same provider is
read again before invocation and consumption. Any state or version drift
invalidates the one-use grant permanently, so restoring an older state cannot
resurrect it. Successful results expose only the snapshot hash and safe version
identifiers in provenance; provider payloads and credentials are not emitted.
Pre-grant denials through the formal runtime are written to the redacted audit.

For repository-local tests, the default provider returns an explicit
repository-harness snapshot that permits only local read bindings. It neither
enables network access nor authorizes mutation, UAT traffic, Scheduler bypass,
live probes, or real exploration. Deployed composition must inject authoritative
budget, circuit, capability, and Kill Switch state rather than treat this
snapshot as live evidence.

All provider results are untrusted. The runtime recursively redacts them,
rejects any result that does not explicitly prove `network_called: false`, and
records a bounded redacted SQLite audit containing Decision/Evidence IDs and
the pinned Skill artifact hash. Prompts and credential material are never
stored in the audit.

The existing deterministic mock tool path remains available for compatibility.
A formal path is used only when `FormalAgentSkillRuntime` is injected into
`execute_plan`; the router then discovers Skills from the validated registry.
HTTP route registration is intentionally outside this package and must derive
trusted session/origin state server-side rather than accept identity headers.

No live UAT or network validation is represented by these Skills. Unknown,
stale, conflicting, missing, OPEN-circuit, active-Kill-Switch, and unconfirmed
capability states remain visible and fail closed.

## Browser boundary trace

The optional HTTP composition surface is metadata-only. It registers guarded
GET routes for discovery, runtime status, and an aggregate audit summary. The
browser receives only Skill identity/version/binding/read-only/hash fields and
never receives invocation arguments, credentials, protected evidence, sessions,
leases, or grants. There is deliberately no browser POST invocation or grant
route; formal execution remains an in-process server-side path through the
router, executor, runtime, static read binding, and persistent redacted audit.

The exact Origin, local Host, and loopback-peer checks are defense in depth for
these read-only endpoints; they are not an identity mechanism. Runtime status
is projected through an explicit response allowlist, and all three responses
state `host_deployment_status=repository_harness_only` and
`network_called=false`.
