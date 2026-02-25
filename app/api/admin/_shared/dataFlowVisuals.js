import path from "node:path";

export const ADMIN_DATA_FLOW_VISUALS = [
  {
    id: "storage-topology",
    title: "Storage Topology",
    description: "End-to-end storage topology and runtime boundaries.",
    sourceFile: "01-storage-topology.mmd",
    svgFile: "01-storage-topology.svg",
  },
  {
    id: "gateway-write-sequence",
    title: "Gateway Write Sequence",
    description: "Strict stage/commit/system write sequence for restaurant-boundary data.",
    sourceFile: "02-gateway-write-sequence.mmd",
    svgFile: "02-gateway-write-sequence.svg",
  },
  {
    id: "read-hydration-flow",
    title: "Read Hydration Flow",
    description: "Read and hydration flow from normalized table storage.",
    sourceFile: "03-read-hydration-flow.mmd",
    svgFile: "03-read-hydration-flow.svg",
  },
  {
    id: "non-boundary-write-domains",
    title: "Non-Boundary Write Domains",
    description: "Sanctioned writes outside the restaurant-boundary enforcement scope.",
    sourceFile: "04-non-boundary-write-domains.mmd",
    svgFile: "04-non-boundary-write-domains.svg",
  },
  {
    id: "boundary-enforcement-flow",
    title: "Boundary Enforcement Flow",
    description: "DB trigger enforcement for boundary tables and blocked direct write path.",
    sourceFile: "05-boundary-enforcement-flow.mmd",
    svgFile: "05-boundary-enforcement-flow.svg",
  },
  {
    id: "normalized-table-model",
    title: "Normalized Table Model",
    description: "Canonical table model and compatibility mirror relationships.",
    sourceFile: "06-normalized-table-model.mmd",
    svgFile: "06-normalized-table-model.svg",
  },
];

const BY_ID = new Map(ADMIN_DATA_FLOW_VISUALS.map((entry) => [entry.id, entry]));

export function getDataFlowVisualById(diagramId) {
  const id = String(diagramId || "").trim();
  return BY_ID.get(id) || null;
}

export function getDataFlowSvgPath(entry) {
  return path.join(process.cwd(), "docs/data-storage-flows/generated", entry.svgFile);
}

export function getDataFlowSourcePath(entry) {
  return path.join(process.cwd(), "docs/data-storage-flows/src", entry.sourceFile);
}

