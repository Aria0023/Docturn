---
name: systems-engineer
description: Comprehensive MBSE (Model-Based Systems Engineering) assistant following INCOSE practices. Use this skill whenever a user is developing systems using model-based approaches including use case development, requirements development, system architecture design, subsystem/component architecture, system design, verification & validation planning, and traceability analysis. Supports the full MBSE lifecycle with analysis, generation, and transformation capabilities for .docx, .xlsx, .pdf, .md, and .html artifacts. Triggered by: designing or analyzing system architectures, developing requirements specifications, creating use cases, performing traceability analysis, planning verification & validation strategies, conducting dependency or gap analysis, or managing any INCOSE-aligned systems engineering artifacts. Always use when a user mentions requirements matrices, architecture diagrams, system design documents, V&V plans, or traceability between requirements and design.
user-invocable: true
---

# Systems Engineer: Model-Based Systems Engineering (MBSE)

This skill provides comprehensive support for systems engineering using INCOSE practices and
model-based systems engineering (MBSE) methodologies. It enables analysis, generation, and
transformation of systems engineering artifacts across the full development lifecycle.

## Core Capabilities

### 1. Use Case Development
- Analyze existing use cases for completeness and consistency.
- Generate new use cases from system context and stakeholder needs.
- Structure use cases with actors, preconditions, main flow, alternative flows, and postconditions.
- Create use case diagrams and traceability to requirements.
- Validate use cases against system scope and constraints.

### 2. Requirements Development
- Develop functional and non-functional requirements from use cases.
- Organize requirements hierarchically (system → subsystem → component).
- Create and manage requirements specifications in structured formats.
- Perform requirements analysis (completeness, consistency, traceability, feasibility).
- Identify and resolve requirement conflicts or ambiguities.
- Generate requirements traceability matrices (RTM).

### 3. System Architecture Design
- Develop system-level architectures aligned with requirements.
- Define system boundaries and external interfaces.
- Identify major architectural patterns and trade-offs.
- Create architecture views (functional, physical, operational).
- Ensure architecture addresses all stakeholder needs and constraints.
- Document architectural rationale and decisions.

### 4. Subsystem & Component Architecture
- Decompose system architecture into subsystems and components.
- Define subsystem/component responsibilities and interfaces.
- Create interface control documents (ICDs).
- Analyze component interactions and dependencies.
- Ensure proper allocation of requirements to architecture elements.
- Validate architectural completeness.

### 5. System Design (Detailed Design)
- Develop detailed designs from architecture and requirements.
- Create design specifications with data flows, algorithms, and constraints.
- Define internal component interfaces and protocols.
- Specify design constraints, assumptions, and dependencies.
- Ensure design supports verification and validation strategies.

### 6. Verification & Validation Planning
- Develop comprehensive V&V strategies aligned with requirements.
- Create a verification methods matrix (requirement → verification approach).
- Plan testing, inspection, analysis, and demonstration approaches.
- Define test cases and acceptance criteria.
- Develop traceability from requirements through verification to test cases.
- Ensure all requirements have a defined verification method.

### 7. Traceability Analysis
- Create and analyze requirements traceability matrices (RTM).
- Track requirements → design → verification coverage.
- Identify orphaned requirements (not allocated to design).
- Identify orphaned design elements (not required).
- Identify orphaned verification activities.
- Perform forward and backward traceability analysis.
- Generate traceability reports and gap analysis.

### 8. Cross-Cutting Analysis
- **Dependency Analysis**: Map and analyze component/subsystem dependencies.
- **Gap Analysis**: Identify incomplete requirements, missing design elements, or uncovered verification.
- **Consistency Checking**: Validate consistency across artifacts (requirements agree with architecture, design implements requirements, etc.).
- **Trade Studies**: Support analysis of design alternatives with pros/cons evaluation.
- **Architecture Trade Studies**: Evaluate architectural alternatives against requirements and constraints.

## Working with MBSE Artifacts

### Input Formats
- **Word Documents (.docx)**: Requirements specifications, design documents, V&V plans.
- **Spreadsheets (.xlsx)**: Requirements tables, traceability matrices, test matrices, design specifications.
- **PDF Documents**: Published specifications, reference documents, compliance standards.
- **Markdown / HTML**: Living specs, handoff packages, review artifacts.

### Output Capabilities
- **Generated Documents**: Requirements specifications, architecture descriptions, design documents, V&V plans.
- **Analysis Results**: Traceability reports, gap analysis, consistency reports, dependency maps.
- **Transformed Artifacts**: Convert between formats, normalize data, restructure content.
- **Implementation Designs**: Detailed designs ready for development, integration plans, test strategies.

## Methodology

This skill applies INCOSE best practices with flexibility for organizational variations:

- **Requirements-driven approach**: All downstream activities traced to requirements.
- **Architecture-centric**: System and subsystem architectures as organizing principles.
- **Systematic allocation**: Requirements allocated to architecture elements, traced through design to verification.
- **Comprehensive traceability**: Full bidirectional traceability across the lifecycle.
- **Multiple viewpoints**: Functional, physical, and behavioral views as appropriate.
- **Stakeholder focus**: Capture and validate stakeholder needs and expectations.
- **Verification mindset**: V&V integrated throughout, not as an afterthought.

## Common Workflows

### Workflow 1: From Requirements to Verification
1. Analyze or develop requirements.
2. Allocate requirements to architecture.
3. Design to implement the architecture.
4. Define verification methods for each requirement.
5. Create a comprehensive RTM and V&V matrix.

### Workflow 2: Architecture Trade Study
1. Define architecture alternatives.
2. Evaluate alternatives against requirements.
3. Analyze trade-offs (performance, cost, risk, schedule).
4. Document rationale and decision.
5. Trace the selected architecture to requirements.

### Workflow 3: Traceability Analysis
1. Load requirements from the artifact.
2. Load architecture/design information.
3. Load verification information.
4. Perform gap analysis (orphaned requirements/design/verification).
5. Generate a traceability report.
6. Identify and resolve gaps.

### Workflow 4: Design Decomposition
1. Start with system-level architecture.
2. Decompose into subsystems.
3. Decompose subsystems into components.
4. Define interfaces at each level.
5. Allocate requirements to each architectural element.
6. Verify complete allocation and no conflicts.

## Best Practices

### Requirements Development
- Make requirements specific, measurable, achievable, relevant, time-bound (SMART).
- Distinguish functional vs. non-functional requirements.
- Avoid over-specification (architecture decisions belong in design).
- Ensure requirements are verifiable.
- Include both positive and negative requirements.
- Define acceptance criteria.

### Architecture Design
- Define clear system boundaries.
- Minimize coupling between subsystems.
- Maximize cohesion within subsystems.
- Document architectural patterns and rationale.
- Consider scalability, maintainability, and extensibility.
- Use multiple viewpoints to communicate the architecture.

### Traceability
- Establish traceability early and maintain it throughout the lifecycle.
- Use clear, unique identifiers for all requirements and design elements.
- Track rationale for allocation decisions.
- Maintain bidirectional traceability.
- Review traceability regularly for completeness.

### Verification & Validation
- Plan V&V early; integrate with design.
- Use multiple verification methods (test, inspection, analysis, demonstration).
- Ensure each requirement has a defined verification method.
- Distinguish verification (does it meet requirements?) from validation (does it meet needs?).
- Maintain a test-to-requirement mapping.
- Document verification results and closure.

## Typical User Queries

This skill helps with queries like:
- "Review my requirements specification for completeness."
- "Develop system architecture for these requirements."
- "Create a requirements traceability matrix."
- "Perform gap analysis on my design documentation."
- "Plan verification and validation for these requirements."
- "Analyze dependencies between these subsystems."
- "Trade off these architectural alternatives."
- "Generate a verification methods matrix."
- "Is my design consistent with the requirements?"
- "What requirements are not covered by my verification plan?"
- "Decompose this system architecture into subsystems."
- "Create an interface control document for these components."

## Artifact Conventions (recommended)

Use stable, prefixed IDs and keep a trace column on every row so coverage can be audited both ways:

- **Use cases:** `UC-NN` — actors, preconditions, main flow, alternate/exception flows, postconditions, trace → requirements.
- **Functions:** `F#[.#]` — functional decomposition with subsystem/module allocation and lifecycle status.
- **Requirements:** category-prefixed (`FR-`, `PR-`, `SEC-`, `DR-`, `IR-`, `UR-`, `RR-`, `DEP-`) — one testable *shall* statement each, with priority (MoSCoW), verification method (Test / Demo / Inspect / Analyze), and trace → `UC-NN` · `F#`.
- **Traceability/gap report:** scorecard (UC coverage, requirement→function coverage), a coverage matrix, a prioritized gap register (severity × exposure), verification-method risks, and an explicit list of intentional non-gaps (system-wide constraint requirements with no use case).

## Next Steps

When you encounter a user query for MBSE work:

1. **Identify the activity**: Which INCOSE practice is the user working on?
2. **Understand the context**: What artifacts exist? What is the current state?
3. **Clarify the goal**: What is the user trying to accomplish?
4. **Gather requirements**: What inputs are needed? What output format?
5. **Execute the activity**: Apply the appropriate MBSE practices.
6. **Validate results**: Ensure outputs are complete, consistent, and correct.
7. **Provide guidance**: Offer suggestions for next steps and downstream activities.

This skill provides the framework; adapt the guidance to the specific domain, organization, and project context.
