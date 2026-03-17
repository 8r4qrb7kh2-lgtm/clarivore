"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabaseClient as supabase } from "../../lib/supabase";
import { isAdminDashboardDevBypassEnabled } from "../services/adminDashboardAccess";

const ROOT_NODE_ID = "functional:clarivore-workflows";
const POLL_INTERVAL_MS = 5_000;
const MAX_FLOW_LINKS = 14;
const CANVAS_NODE_WIDTH = 264;
const CANVAS_NODE_HEIGHT = 204;
const CANVAS_ROW_GAP = 96;
const CANVAS_NODE_GAP = 72;
const CANVAS_PADDING = 40;

function asText(value) {
  return String(value || "").trim();
}

function clampText(value, maxLength = 88) {
  const text = asText(value).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarizeRef(ref) {
  return `${ref.filePath}:${ref.startLine}-${ref.endLine}`;
}

function getNodeKindLabel(node) {
  if (node.kind === "root") return "System Map";
  if (node.kind === "area") return "Area";
  if (node.kind === "task") return "Step";
  if (node.kind === "directory") return "System";
  if (node.kind === "file") return "File";
  if (node.kind === "symbol") return "Block";
  return "Runtime";
}

function getNodeActionLabel(node) {
  if (node.kind === "root") return "Open area";
  if (node.kind === "area") return "Open area";
  if (node.kind === "task") return node.childCount ? "Open step" : "Inspect step";
  if (node.kind === "directory") return "Open subsystem";
  if (node.kind === "file") return node.childCount ? "Open file blocks" : "Inspect file";
  if (node.kind === "symbol") return "Inspect block";
  return "Open runtime";
}

function compareGraphNodes(left, right) {
  const leftOrder = Number.isFinite(left?.order) ? left.order : null;
  const rightOrder = Number.isFinite(right?.order) ? right.order : null;
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  const priorityByKind = {
    root: 0,
    area: 1,
    task: 2,
    directory: 0,
    file: 1,
    symbol: 2,
  };
  const leftPriority = priorityByKind[left?.kind] ?? 9;
  const rightPriority = priorityByKind[right?.kind] ?? 9;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return asText(left?.label).localeCompare(asText(right?.label));
}

function buildNodeTraffic(nodes, edges) {
  const statsById = new Map(
    nodes.map((node) => [
      node.id,
      {
        incoming: 0,
        outgoing: 0,
        variables: new Set(),
      },
    ]),
  );

  edges.forEach((edge) => {
    const sourceStats = statsById.get(edge.source);
    const targetStats = statsById.get(edge.target);
    if (sourceStats) {
      sourceStats.outgoing += 1;
    }
    if (targetStats) {
      targetStats.incoming += 1;
    }
    (edge.variables || []).forEach((variable) => {
      if (sourceStats) sourceStats.variables.add(variable.name);
      if (targetStats) targetStats.variables.add(variable.name);
    });
  });

  return statsById;
}

function buildEdgePath(sourceNode, targetNode) {
  const startX = sourceNode.x + sourceNode.width / 2;
  const startY = sourceNode.y + sourceNode.height;
  const endX = targetNode.x + targetNode.width / 2;
  const endY = targetNode.y;

  if (endY > startY) {
    const bend = Math.max((endY - startY) / 2, 44);
    return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
  }

  const loopY = Math.max(startY, endY) + 64;
  return `M ${startX} ${startY} C ${startX} ${loopY}, ${endX} ${loopY}, ${endX} ${endY}`;
}

function buildFlowLayout(nodes, edges) {
  if (!nodes.length) {
    return {
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
    };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));

  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    outgoing.get(edge.source).push(edge.target);
    incoming.get(edge.target).push(edge.source);
  });

  const indegree = new Map(
    Array.from(incoming.entries()).map(([nodeId, items]) => [nodeId, items.length]),
  );
  const compareIds = (leftId, rightId) =>
    compareGraphNodes(nodeById.get(leftId), nodeById.get(rightId));

  const queue = Array.from(nodeById.keys())
    .filter((nodeId) => indegree.get(nodeId) === 0)
    .sort(compareIds);
  const levels = new Map(queue.map((nodeId) => [nodeId, 0]));
  const seen = new Set();

  while (queue.length) {
    const nodeId = queue.shift();
    seen.add(nodeId);
    const nextLevel = (levels.get(nodeId) || 0) + 1;
    const targets = (outgoing.get(nodeId) || []).slice().sort(compareIds);
    targets.forEach((targetId) => {
      levels.set(targetId, Math.max(levels.get(targetId) || 0, nextLevel));
      indegree.set(targetId, Math.max((indegree.get(targetId) || 0) - 1, 0));
      if (indegree.get(targetId) === 0) {
        queue.push(targetId);
        queue.sort(compareIds);
      }
    });
  }

  Array.from(nodeById.keys())
    .filter((nodeId) => !seen.has(nodeId))
    .sort(compareIds)
    .forEach((nodeId) => {
      const sourceLevels = (incoming.get(nodeId) || []).map((sourceId) => levels.get(sourceId) || 0);
      levels.set(nodeId, sourceLevels.length ? Math.max(...sourceLevels) + 1 : 0);
    });

  const rows = Array.from(
    Array.from(nodeById.values()).reduce((map, node) => {
      const level = levels.get(node.id) || 0;
      const row = map.get(level) || [];
      row.push(node);
      map.set(level, row);
      return map;
    }, new Map()),
  )
    .sort((left, right) => left[0] - right[0])
    .map(([, rowNodes]) => rowNodes.sort(compareGraphNodes));

  const maxRowWidth = Math.max(
    ...rows.map((rowNodes) => rowNodes.length * CANVAS_NODE_WIDTH + Math.max(rowNodes.length - 1, 0) * CANVAS_NODE_GAP),
    CANVAS_NODE_WIDTH,
  );
  const width = Math.max(maxRowWidth + CANVAS_PADDING * 2, 960);
  const height =
    rows.length * CANVAS_NODE_HEIGHT
    + Math.max(rows.length - 1, 0) * CANVAS_ROW_GAP
    + CANVAS_PADDING * 2;

  const laidOutNodes = [];
  rows.forEach((rowNodes, rowIndex) => {
    const rowWidth =
      rowNodes.length * CANVAS_NODE_WIDTH
      + Math.max(rowNodes.length - 1, 0) * CANVAS_NODE_GAP;
    const startX = CANVAS_PADDING + (maxRowWidth - rowWidth) / 2;
    const y = CANVAS_PADDING + rowIndex * (CANVAS_NODE_HEIGHT + CANVAS_ROW_GAP);

    rowNodes.forEach((node, columnIndex) => {
      laidOutNodes.push({
        ...node,
        width: CANVAS_NODE_WIDTH,
        height: CANVAS_NODE_HEIGHT,
        x: startX + columnIndex * (CANVAS_NODE_WIDTH + CANVAS_NODE_GAP),
        y,
      });
    });
  });

  const positionById = new Map(laidOutNodes.map((node) => [node.id, node]));
  const laidOutEdges = edges
    .map((edge) => {
      const sourceNode = positionById.get(edge.source);
      const targetNode = positionById.get(edge.target);
      if (!sourceNode || !targetNode) return null;
      const labelX = (sourceNode.x + sourceNode.width / 2 + targetNode.x + targetNode.width / 2) / 2;
      const labelY = (sourceNode.y + sourceNode.height + targetNode.y) / 2;
      return {
        ...edge,
        sourceLabel: positionById.get(edge.source)?.label || "Source",
        targetLabel: positionById.get(edge.target)?.label || "Target",
        path: buildEdgePath(sourceNode, targetNode),
        labelX,
        labelY,
      };
    })
    .filter(Boolean);

  return {
    width,
    height,
    nodes: laidOutNodes,
    edges: laidOutEdges,
  };
}

function formatVariableLine(variable) {
  const name = asText(variable?.name) || "value";
  const value = asText(variable?.value) || "(computed)";
  return `${name}=${value}`;
}

function EvidenceRefs({ refs }) {
  if (!refs?.length) {
    return <p className="admin-systems-muted">No direct code references in this result.</p>;
  }

  return (
    <ul className="admin-systems-ref-list">
      {refs.map((ref) => (
        <li key={`${ref.filePath}-${ref.startLine}-${ref.endLine}-${ref.label || ""}`}>
          <span className="admin-systems-ref-label">{summarizeRef(ref)}</span>
          {ref.label ? <span className="admin-systems-ref-meta">{ref.label}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function SystemsFlowChart({
  currentNode,
  nodes,
  edges,
  navigatingNodeId,
  onSelectNode,
}) {
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const trafficByNodeId = useMemo(() => buildNodeTraffic(nodes, edges), [nodes, edges]);
  const layout = useMemo(() => buildFlowLayout(nodes, edges), [nodes, edges]);
  const flowLinks = useMemo(
    () =>
      edges.slice(0, MAX_FLOW_LINKS).map((edge) => ({
        ...edge,
        sourceLabel: nodeById.get(edge.source)?.label || "Source",
        targetLabel: nodeById.get(edge.target)?.label || "Target",
        summaryText:
          edge.variables?.length
            ? edge.variables
                .slice(0, 3)
                .map((variable) => formatVariableLine(variable))
                .join(", ")
            : edge.description || edge.label || "workflow connection",
      })),
    [edges, nodeById],
  );

  return (
    <section className="admin-systems-flow-shell" aria-labelledby="systems-flow-heading">
      <div className="admin-systems-flow-header">
        <div>
          <h3 id="systems-flow-heading">Interactive workflow map</h3>
          <p>
            This view is organized by how Clarivore works for real people. Click any card to drill
            deeper into that area while keeping the live permissions, files, and code lines below.
          </p>
        </div>
        <div className="admin-systems-flow-stats">
          <span>{nodes.length} direct parts</span>
          <span>{edges.length} workflow connections</span>
          <span>{currentNode?.isLeaf ? "Detailed area" : "Click any card to drill down"}</span>
        </div>
      </div>

      <div className="admin-systems-flow-stage">
        <article className="admin-systems-focus-node" data-testid="systems-focus-node">
          <span className="admin-systems-node-kind">
            {`Current ${getNodeKindLabel(currentNode).toLowerCase()}`}
          </span>
          <strong>{currentNode?.label || "Runtime"}</strong>
          <span className="admin-systems-node-summary">{currentNode?.summary || ""}</span>
          <span className="admin-systems-node-path">{currentNode?.scopeLabel || "Site overview"}</span>
          {currentNode?.audience?.length ? (
            <span className="admin-systems-node-path">
              Primary users: {currentNode.audience.join(" · ")}
            </span>
          ) : null}
          {currentNode?.authRoles?.length ? (
            <span className="admin-systems-node-auth">
              Permissions seen in code: {currentNode.authRoles.join(" · ")}
            </span>
          ) : null}
          <p className="admin-systems-focus-description">
            {currentNode?.description
              || "Select a child area to replace the map with the tasks inside that workflow."}
          </p>
        </article>

        {layout.nodes.length ? (
          <>
            <div className="admin-systems-canvas-scroll" data-testid="systems-flow-canvas">
              <div
                className="admin-systems-canvas"
                style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
              >
                <svg
                  className="admin-systems-canvas-svg"
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="systems-flow-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M0,0 L0,8 L8,4 z" fill="rgba(36, 74, 116, 0.44)" />
                    </marker>
                  </defs>
                  {layout.edges.map((edge) => {
                    const labelWidth = Math.min(
                      240,
                      Math.max(96, clampText(edge.label, 32).length * 7 + 26),
                    );
                    return (
                      <g key={edge.id}>
                        <path
                          className="admin-systems-edge"
                          d={edge.path}
                          markerEnd="url(#systems-flow-arrow)"
                        />
                        <g transform={`translate(${edge.labelX - labelWidth / 2}, ${edge.labelY - 14})`}>
                          <rect
                            width={labelWidth}
                            height="28"
                            rx="14"
                            fill="rgba(255,255,255,0.96)"
                            stroke="rgba(148, 163, 184, 0.5)"
                          />
                          <text
                            x={labelWidth / 2}
                            y="18"
                            textAnchor="middle"
                            fill="#173b63"
                            fontSize="11"
                            fontWeight="700"
                          >
                            {clampText(edge.label, 28)}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>

                {layout.nodes.map((node) => {
                  const traffic = trafficByNodeId.get(node.id);
                  const isOpening = navigatingNodeId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`admin-systems-node${isOpening ? " pending" : ""}`}
                      data-node-id={node.id}
                      data-testid="systems-graph-node"
                      style={{
                        left: `${node.x}px`,
                        top: `${node.y}px`,
                        width: `${node.width}px`,
                        minHeight: `${node.height}px`,
                      }}
                      onClick={() => onSelectNode(node.id)}
                      aria-label={`${getNodeActionLabel(node)} ${node.label}`}
                    >
                      <span className="admin-systems-node-kind">{getNodeKindLabel(node)}</span>
                      <strong>{node.label}</strong>
                      <span className="admin-systems-node-summary">{node.summary}</span>
                      <span className="admin-systems-node-path">
                        {node.scopeLabel || "Workflow area"}
                      </span>
                      {node.audience?.length ? (
                        <span className="admin-systems-node-path">
                          Used by: {node.audience.slice(0, 3).join(" · ")}
                        </span>
                      ) : null}
                      {node.authRoles?.length ? (
                        <span className="admin-systems-node-auth">
                          Permissions: {node.authRoles.slice(0, 3).join(" · ")}
                        </span>
                      ) : null}
                      <span className="admin-systems-node-path">
                        {traffic?.incoming || 0} in · {traffic?.outgoing || 0} out ·{" "}
                        {node.childCount
                          ? `${node.childCount} deeper part${node.childCount === 1 ? "" : "s"}`
                          : "Detailed area"}
                      </span>
                      <span className="admin-systems-node-auth">
                        {isOpening ? "Rebuilding map…" : getNodeActionLabel(node)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="admin-systems-flow-links">
              <div className="admin-systems-panel-heading">
                <h3>What Happens Between These Parts</h3>
                <p>
                  Plain-language workflow links for the cards currently shown in the map.
                </p>
              </div>
              {flowLinks.length ? (
                <div className="admin-systems-flow-link-list">
                  {flowLinks.map((edge) => (
                    <article key={edge.id} className="admin-systems-flow-link">
                      <div className="admin-systems-flow-link-route">
                        <strong>{edge.sourceLabel}</strong>
                        <span>→</span>
                        <strong>{edge.targetLabel}</strong>
                      </div>
                      <p>{edge.summaryText}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="admin-systems-muted">
                  These parts do not have a direct workflow link at this level of the map.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="admin-systems-empty-state">
            <h3>No more workflow subdivisions</h3>
            <p>
              This area is already at its most specific workflow level. Use the evidence panels
              below for the exact files, permissions, and line ranges behind it.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function AdminSystemsExplorerTab() {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [navigatingNodeId, setNavigatingNodeId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [chatHistoryByNodeId, setChatHistoryByNodeId] = useState({});
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const currentNodeIdRef = useRef(ROOT_NODE_ID);

  const deferredGraph = useDeferredValue(view?.graph || null);

  const getAuthHeaders = useCallback(async () => {
    const headers = {
      "Content-Type": "application/json",
    };
    if (isAdminDashboardDevBypassEnabled()) {
      return headers;
    }
    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error) throw error;
    const accessToken = asText(session?.access_token);
    if (!accessToken) {
      throw new Error("You must be signed in.");
    }
    return {
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    };
  }, []);

  const loadView = useCallback(
    async (nodeId, options = {}) => {
      const targetNodeId = asText(nodeId) || ROOT_NODE_ID;
      if (!options.fromPoll) {
        setNavigatingNodeId(targetNodeId);
      }
      if (!options.silent) {
        setLoading(true);
      }
      setErrorMessage("");

      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `/api/admin/runtime-systems?nodeId=${encodeURIComponent(targetNodeId)}`,
          {
            method: "GET",
            headers,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
          throw new Error(
            asText(payload?.error || payload?.message)
              || "Failed to load runtime systems explorer.",
          );
        }

        currentNodeIdRef.current = asText(payload?.currentNode?.id) || ROOT_NODE_ID;
        const applyState = () => {
          setView(payload);
          if (options.fromPoll) {
            setLastRefreshAt(new Date().toISOString());
          }
        };
        if (options.fromPoll) {
          startTransition(applyState);
        } else {
          applyState();
        }
      } catch (error) {
        setErrorMessage(asText(error?.message) || "Failed to load systems explorer.");
      } finally {
        if (!options.fromPoll) {
          setNavigatingNodeId("");
        }
        if (!options.silent) {
          setLoading(false);
        }
      }
    },
    [getAuthHeaders],
  );

  useEffect(() => {
    loadView(ROOT_NODE_ID);
  }, [loadView]);

  useEffect(() => {
    if (!view?.version) return undefined;

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/admin/runtime-systems?mode=version", {
          method: "GET",
          headers,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success || cancelled) return;
        if (asText(payload.version) && payload.version !== view.version) {
          loadView(currentNodeIdRef.current, { silent: true, fromPoll: true });
        }
      } catch {
        // Keep polling silently; the current snapshot stays usable.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getAuthHeaders, loadView, view?.version]);

  const onSelectNode = useCallback(
    (nodeId) => {
      loadView(nodeId);
    },
    [loadView],
  );

  const onAskQuestion = useCallback(async () => {
    const question = asText(questionInput);
    const activeNodeId = asText(view?.currentNode?.id);
    if (!question || asking || !activeNodeId) return;

    setAsking(true);
    setErrorMessage("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/runtime-systems-ask", {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId: activeNodeId,
          question,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(
          asText(payload?.error || payload?.message) || "Failed to ask question.",
        );
      }

      const nextEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        question,
        answer: asText(payload?.answer),
        evidence: Array.isArray(payload?.evidence) ? payload.evidence : [],
        createdAt: new Date().toISOString(),
      };

      setChatHistoryByNodeId((current) => ({
        ...current,
        [activeNodeId]: [nextEntry, ...(current[activeNodeId] || [])].slice(0, 10),
      }));
      setQuestionInput("");
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to ask explorer question.");
    } finally {
      setAsking(false);
    }
  }, [asking, getAuthHeaders, questionInput, view?.currentNode?.id]);

  const graphNodes = Array.isArray(deferredGraph?.nodes) ? deferredGraph.nodes : [];
  const graphEdges = Array.isArray(deferredGraph?.edges) ? deferredGraph.edges : [];
  const graphNodeById = useMemo(
    () => new Map(graphNodes.map((node) => [node.id, node])),
    [graphNodes],
  );
  const currentChatHistory =
    chatHistoryByNodeId[asText(view?.currentNode?.id) || ROOT_NODE_ID] || [];

  return (
    <div className="tab-content active">
      <div className="admin-card admin-card-full admin-systems-card">
        <div className="admin-systems-header">
          <div>
            <h2>Live System Graph</h2>
            <p className="admin-systems-subtitle">
              This map is rebuilt from the current runtime under <code>app/</code> plus{" "}
              <code>next.config.js</code>, but it is organized around how Clarivore actually works.
              Every area still includes live permissions, file coverage, and code lines behind it.
            </p>
          </div>
          <div className="admin-systems-status">
            <span id="systems-version" data-testid="systems-version">
              Live snapshot {view?.version || "loading"}
            </span>
            <span>
              {view?.generatedAt ? `Built ${formatTimestamp(view.generatedAt)}` : "Building…"}
            </span>
            <span>
              Auto refresh every {Math.round(POLL_INTERVAL_MS / 1000)}s
              {lastRefreshAt ? ` · updated ${formatTimestamp(lastRefreshAt)}` : ""}
            </span>
          </div>
        </div>

        {errorMessage ? <p className="status-text error">{errorMessage}</p> : null}

        <div className="admin-systems-breadcrumbs">
          {(view?.breadcrumb || []).map((crumb, index) => (
            <button
              key={crumb.id}
              type="button"
              className={`admin-systems-breadcrumb${
                crumb.id === view?.currentNode?.id ? " active" : ""
              }`}
              onClick={() => onSelectNode(crumb.id)}
            >
              {crumb.label}
              {index < (view?.breadcrumb?.length || 0) - 1 ? " /" : ""}
            </button>
          ))}
        </div>

        {loading && !view ? (
          <div className="admin-systems-empty-state">
            <h3>Building live workflow map…</h3>
            <p>Scanning the active codebase and organizing it around the product’s functional areas.</p>
          </div>
        ) : (
          <>
            <div className="admin-systems-current">
              <div>
                <h3 id="systems-current-node" data-testid="systems-current-node">
                  {view?.currentNode?.label || "How Clarivore Works"}
                </h3>
                <p className="admin-systems-current-path">
                  {view?.currentNode?.scopeLabel || "Site overview"}
                </p>
              </div>
              <div className="admin-systems-current-meta">
                <span>{view?.currentNode?.summary || ""}</span>
                <span>{view?.currentNode?.description || ""}</span>
                {view?.currentNode?.audience?.length ? (
                  <span>Primary users: {view.currentNode.audience.join(" · ")}</span>
                ) : null}
                {view?.currentNode?.authRoles?.length ? (
                  <span>Permissions seen in code: {view.currentNode.authRoles.join(" · ")}</span>
                ) : null}
              </div>
            </div>

            <SystemsFlowChart
              currentNode={view?.currentNode}
              nodes={graphNodes}
              edges={graphEdges}
              navigatingNodeId={navigatingNodeId}
              onSelectNode={onSelectNode}
            />

            <div className="admin-systems-grid">
              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>What Powers This Area</h3>
                  <p>
                    The direct parts behind <strong>{view?.currentNode?.label || "this area"}</strong>,
                    including line counts and the permissions seen in their live files.
                  </p>
                </div>
                {(view?.details?.components || []).length ? (
                  <div className="admin-systems-stack">
                    {view.details.components.map((component) => (
                      <article key={component.id} className="admin-systems-evidence-card">
                        <div className="admin-systems-evidence-header">
                          <strong>{component.label}</strong>
                          <span>{component.summary}</span>
                        </div>
                        {component.scopeLabel ? (
                          <div className="admin-systems-auth-path">{component.scopeLabel}</div>
                        ) : null}
                        <p className="admin-systems-muted">{component.description}</p>
                        {component.authRoles?.length ? (
                          <div className="admin-systems-component-meta">
                            Permissions: {component.authRoles.join(" · ")}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    No direct parts were derived for the current area.
                  </p>
                )}
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>How Information Moves</h3>
                  <p>
                    The workflow links between the parts shown in this area, with any live code
                    evidence attached underneath.
                  </p>
                </div>
                {(view?.details?.handoffs || []).length ? (
                  <div className="admin-systems-stack">
                    {view.details.handoffs.map((handoff) => (
                      <article key={handoff.id} className="admin-systems-evidence-card">
                        <div className="admin-systems-evidence-header">
                          <strong>
                            {graphNodeById.get(handoff.source)?.label || "Source"} →{" "}
                            {graphNodeById.get(handoff.target)?.label || "Target"}
                          </strong>
                          <span>{handoff.weight} live link{handoff.weight === 1 ? "" : "s"}</span>
                        </div>
                        {handoff.description ? (
                          <p className="admin-systems-muted">{handoff.description}</p>
                        ) : null}
                        {handoff.variables?.length ? (
                          <ul className="admin-systems-variable-list">
                            {handoff.variables.map((variable, index) => (
                              <li
                                key={`${handoff.id}-${variable.name}-${variable.value}-${variable.line}-${index}`}
                              >
                                <code>{formatVariableLine(variable)}</code>
                                <span>{variable.description}</span>
                                {variable.usedFor ? <span>Used for: {variable.usedFor}</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="admin-systems-muted">
                            This workflow link is supported mainly by routing, shared state, or
                            higher-level structure rather than a single direct prop or argument hand-off.
                          </p>
                        )}
                        <EvidenceRefs refs={handoff.refs} />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    No direct workflow links were mapped inside this area.
                  </p>
                )}
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Who Can Use It</h3>
                  <p>Inferred from the current auth checks, route copy, and access guards in code.</p>
                </div>
                {(view?.details?.auth || []).length ? (
                  <div className="admin-systems-stack">
                    {view.details.auth.map((group) => (
                      <article key={group.role} className="admin-systems-evidence-card">
                        <div className="admin-systems-evidence-header">
                          <strong>{group.role}</strong>
                          <span>{group.refs.length} code references</span>
                        </div>
                        {group.refs.map((ref) => (
                          <div
                            key={`${ref.filePath}-${ref.startLine}-${group.role}`}
                            className="admin-systems-auth-ref"
                          >
                            <div className="admin-systems-auth-path">{summarizeRef(ref)}</div>
                            <pre className="admin-systems-code small">{ref.excerpt}</pre>
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    No explicit permissions were found in the current area.
                  </p>
                )}
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Key Live Code Evidence</h3>
                  <p>
                    Exact files and line ranges currently powering{" "}
                    <strong>{view?.currentNode?.label || "this area"}</strong>.
                  </p>
                </div>
                <div id="systems-source-refs" data-testid="systems-source-refs">
                  {(view?.details?.sourceRefs || []).length ? (
                    (view.details.sourceRefs || []).map((ref) => (
                      <article
                        key={`${ref.filePath}-${ref.startLine}-${ref.endLine}-${ref.label || ""}`}
                        className="admin-systems-evidence-card"
                      >
                        <div className="admin-systems-evidence-header">
                          <strong>{ref.label || summarizeRef(ref)}</strong>
                          <span>{summarizeRef(ref)}</span>
                        </div>
                        <pre className="admin-systems-code" data-testid="systems-source-snippet">
                          {ref.excerpt}
                        </pre>
                      </article>
                    ))
                  ) : (
                    <p className="admin-systems-muted">
                      No direct code evidence was derived for the current area.
                    </p>
                  )}
                </div>
                <div className="admin-systems-panel-heading">
                  <h3>Ask What This Part Does</h3>
                  <p>
                    Questions are answered from the latest runtime snapshot only and cite the live
                    evidence used.
                  </p>
                </div>
                <div className="admin-systems-chat">
                  <textarea
                    value={questionInput}
                    onChange={(event) => setQuestionInput(event.target.value)}
                    placeholder="Ask about the current area. Example: How does this step connect to the next one, and which users can reach it?"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={onAskQuestion}
                    disabled={asking || !asText(questionInput)}
                  >
                    {asking ? "Reasoning…" : "Ask about this area"}
                  </button>
                </div>

                {currentChatHistory.length ? (
                  <div className="admin-systems-chat-history">
                    {currentChatHistory.map((entry) => (
                      <article key={entry.id} className="admin-systems-chat-entry">
                        <p className="admin-systems-chat-question">
                          <strong>Q:</strong> {entry.question}
                        </p>
                        <pre className="admin-systems-code">{entry.answer}</pre>
                        <div className="admin-systems-chat-evidence">
                          {(entry.evidence || []).map((item, index) => (
                            <article
                              key={`${entry.id}-${item.type}-${index}`}
                              className="admin-systems-evidence-card"
                            >
                              <div className="admin-systems-evidence-header">
                                <strong>{item.type}</strong>
                              </div>
                              <pre className="admin-systems-code">{item.text}</pre>
                              <EvidenceRefs refs={item.refs} />
                            </article>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    Ask about permissions, supporting files, workflow steps, or how this area feeds
                    the next part of the site.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
