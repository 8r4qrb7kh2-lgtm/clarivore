"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../lib/supabase";
import { isAdminDashboardDevBypassEnabled } from "../services/adminDashboardAccess";

const ROOT_NODE_ID = "workspace:clarivore-runtime";
const POLL_INTERVAL_MS = 2_000;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 138;
const NODE_GAP_X = 68;
const NODE_GAP_Y = 28;
const CANVAS_PADDING = 36;
const MAX_CHART_EDGES = 24;

function asText(value) {
  return String(value || "").trim();
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
  if (node.kind === "directory") return "System";
  if (node.kind === "file") return "File";
  if (node.kind === "symbol") return "Block";
  return "Runtime";
}

function getNodeColumnSeed(node) {
  if (node.kind === "directory") return 0;
  if (node.kind === "file") return 1;
  return 2;
}

function buildFlowLayout(nodes, edges) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));

  edges.forEach((edge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) return;
    outgoing.get(edge.source).push(edge.target);
    incoming.get(edge.target).push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const layers = new Map();
  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((node) => node.id);

  while (queue.length) {
    const nodeId = queue.shift();
    const node = nodeMap.get(nodeId);
    const predecessorLayers = (incoming.get(nodeId) || [])
      .map((sourceId) => layers.get(sourceId))
      .filter((value) => Number.isFinite(value));
    const fallbackLayer = getNodeColumnSeed(node);
    const nextLayer = predecessorLayers.length
      ? Math.max(...predecessorLayers) + 1
      : fallbackLayer;
    layers.set(nodeId, nextLayer);
    (outgoing.get(nodeId) || []).forEach((targetId) => {
      const nextDegree = (indegree.get(targetId) || 0) - 1;
      indegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        queue.push(targetId);
      }
    });
  }

  nodes.forEach((node) => {
    if (layers.has(node.id)) return;
    const predecessorLayers = (incoming.get(node.id) || [])
      .map((sourceId) => layers.get(sourceId))
      .filter((value) => Number.isFinite(value));
    layers.set(
      node.id,
      predecessorLayers.length ? Math.max(...predecessorLayers) + 1 : getNodeColumnSeed(node),
    );
  });

  const columns = new Map();
  nodes.forEach((node) => {
    const layer = layers.get(node.id) || 0;
    const column = columns.get(layer) || [];
    column.push(node);
    columns.set(layer, column);
  });

  columns.forEach((column) => {
    column.sort((left, right) => {
      const kindDelta = getNodeColumnSeed(left) - getNodeColumnSeed(right);
      if (kindDelta !== 0) return kindDelta;
      return left.label.localeCompare(right.label);
    });
  });

  const orderedLayers = Array.from(columns.keys()).sort((left, right) => left - right);
  const positions = new Map();
  let maxRows = 0;
  orderedLayers.forEach((layer) => {
    const column = columns.get(layer) || [];
    maxRows = Math.max(maxRows, column.length);
    column.forEach((node, rowIndex) => {
      const x = CANVAS_PADDING + layer * (NODE_WIDTH + NODE_GAP_X);
      const y = CANVAS_PADDING + rowIndex * (NODE_HEIGHT + NODE_GAP_Y);
      positions.set(node.id, { x, y });
    });
  });

  const width =
    CANVAS_PADDING * 2 +
    (orderedLayers.length ? orderedLayers.length * NODE_WIDTH + (orderedLayers.length - 1) * NODE_GAP_X : NODE_WIDTH);
  const height =
    CANVAS_PADDING * 2 +
    (maxRows ? maxRows * NODE_HEIGHT + (maxRows - 1) * NODE_GAP_Y : NODE_HEIGHT);

  return {
    width,
    height,
    positions,
  };
}

function buildEdgePath(layout, edge) {
  const source = layout.positions.get(edge.source);
  const target = layout.positions.get(edge.target);
  if (!source || !target) return "";
  const startX = source.x + NODE_WIDTH;
  const startY = source.y + NODE_HEIGHT / 2;
  const endX = target.x;
  const endY = target.y + NODE_HEIGHT / 2;
  const controlX = startX + Math.max((endX - startX) / 2, 24);
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
}

function FlowCanvas({ nodes, edges, onSelectNode }) {
  const layout = useMemo(() => buildFlowLayout(nodes, edges), [nodes, edges]);

  if (!nodes.length) {
    return (
      <div className="admin-systems-empty-state">
        <h3>No more subdivisions</h3>
        <p>This block is already at the file or symbol level.</p>
      </div>
    );
  }

  return (
    <div className="admin-systems-canvas-scroll">
      <div
        className="admin-systems-canvas"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="admin-systems-canvas-svg"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="systems-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#244a74" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const pathData = buildEdgePath(layout, edge);
            if (!pathData) return null;
            return (
              <path
                key={edge.id}
                d={pathData}
                className="admin-systems-edge"
                markerEnd="url(#systems-arrow)"
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          const position = layout.positions.get(node.id);
          if (!position) return null;
          return (
            <button
              key={node.id}
              type="button"
              className="admin-systems-node"
              data-node-id={node.id}
              style={{
                left: position.x,
                top: position.y,
              }}
              onClick={() => onSelectNode(node.id)}
            >
              <span className="admin-systems-node-kind">{getNodeKindLabel(node)}</span>
              <strong>{node.label}</strong>
              <span className="admin-systems-node-summary">{node.summary}</span>
              <span className="admin-systems-node-path">{node.relativePath}</span>
              {node.authRoles?.length ? (
                <span className="admin-systems-node-auth">
                  {node.authRoles.slice(0, 2).join(" · ")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
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

export default function AdminSystemsExplorerTab() {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const currentNodeIdRef = useRef(ROOT_NODE_ID);

  const chartEdges = useMemo(() => {
    const edges = Array.isArray(view?.graph?.edges) ? view.graph.edges : [];
    return edges.slice(0, MAX_CHART_EDGES);
  }, [view]);

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
            asText(payload?.error || payload?.message) ||
              "Failed to load runtime systems explorer.",
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
        if (!response.ok || !payload?.success) return;
        if (cancelled) return;
        if (asText(payload.version) && payload.version !== view.version) {
          loadView(currentNodeIdRef.current, { silent: true, fromPoll: true });
        }
      } catch {
        // Keep polling silent in the background; the current view remains usable.
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
    if (!question || asking || !view?.currentNode?.id) return;

    setAsking(true);
    setErrorMessage("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/runtime-systems-ask", {
        method: "POST",
        headers,
        body: JSON.stringify({
          nodeId: view.currentNode.id,
          question,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(
          asText(payload?.error || payload?.message) || "Failed to ask question.",
        );
      }

      setChatHistory((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          question,
          answer: asText(payload?.answer),
          evidence: Array.isArray(payload?.evidence) ? payload.evidence : [],
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      setQuestionInput("");
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to ask explorer question.");
    } finally {
      setAsking(false);
    }
  }, [asking, getAuthHeaders, questionInput, view]);

  return (
    <div className="tab-content active">
      <div className="admin-card admin-card-full admin-systems-card">
        <div className="admin-systems-header">
          <div>
            <h2>Live Systems Explorer</h2>
            <p className="admin-systems-subtitle">
              Current runtime flow map generated from the active codebase under <code>app/</code>.
              Select any block to drill into its subsystems, files, and line-level evidence.
            </p>
          </div>
          <div className="admin-systems-status">
            <span id="systems-version" data-testid="systems-version">
              Snapshot {view?.version || "loading"}
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
            <h3>Building runtime map…</h3>
            <p>Scanning the current codebase and deriving system relationships.</p>
          </div>
        ) : (
          <>
            <div className="admin-systems-current">
              <div>
                <h3 id="systems-current-node" data-testid="systems-current-node">
                  {view?.currentNode?.label || "Runtime"}
                </h3>
                <p className="admin-systems-current-path">
                  <code>{view?.currentNode?.relativePath || "app"}</code>
                </p>
              </div>
              <div className="admin-systems-current-meta">
                <span>{view?.currentNode?.summary || ""}</span>
                <span>{view?.currentNode?.description || ""}</span>
              </div>
            </div>

            <FlowCanvas
              nodes={Array.isArray(view?.graph?.nodes) ? view.graph.nodes : []}
              edges={chartEdges}
              onSelectNode={onSelectNode}
            />

            <div className="admin-systems-grid">
              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Block Composition</h3>
                  <p>Files and exact line ranges that make up the current block.</p>
                </div>
                <div id="systems-source-refs" data-testid="systems-source-refs">
                  {(view?.details?.sourceRefs || []).map((ref) => (
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
                  ))}
                </div>
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Variable Hand-Offs</h3>
                  <p>Observed props, arguments, and options passed between the blocks in this view.</p>
                </div>
                {(view?.details?.handoffs || []).length ? (
                  <div className="admin-systems-stack">
                    {view.details.handoffs.map((handoff) => (
                      <article key={handoff.id} className="admin-systems-evidence-card">
                        <div className="admin-systems-evidence-header">
                          <strong>{handoff.label || "Dependency"}</strong>
                          <span>{handoff.weight} linked usages</span>
                        </div>
                        {handoff.variables?.length ? (
                          <ul className="admin-systems-variable-list">
                            {handoff.variables.map((variable, index) => (
                              <li
                                key={`${handoff.id}-${variable.name}-${variable.value}-${variable.line}-${index}`}
                              >
                                <code>
                                  {variable.name}={variable.value}
                                </code>
                                <span>{variable.description}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="admin-systems-muted">
                            This link is import-based and does not expose direct prop or argument names
                            in the current view.
                          </p>
                        )}
                        <EvidenceRefs refs={handoff.refs} />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    No direct block-to-block hand-offs were detected for this subdivision level.
                  </p>
                )}
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Authorized User Types</h3>
                  <p>Inferred from current access guards, route copy, and auth checks in the code.</p>
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
                          <div key={`${ref.filePath}-${ref.startLine}-${group.role}`} className="admin-systems-auth-ref">
                            <div className="admin-systems-auth-path">{summarizeRef(ref)}</div>
                            <pre className="admin-systems-code small">{ref.excerpt}</pre>
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-systems-muted">
                    No explicit authorization evidence was found in the current block.
                  </p>
                )}
              </section>

              <section className="admin-systems-panel">
                <div className="admin-systems-panel-heading">
                  <h3>Code-Aware Assistant</h3>
                  <p>
                    Questions are answered from the latest runtime snapshot and cite the code
                    references used.
                  </p>
                </div>
                <div className="admin-systems-chat">
                  <textarea
                    value={questionInput}
                    onChange={(event) => setQuestionInput(event.target.value)}
                    placeholder="Ask about the current block. Example: Which user types can access this and where is that enforced?"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={onAskQuestion}
                    disabled={asking || !asText(questionInput)}
                  >
                    {asking ? "Reasoning…" : "Ask the codebase"}
                  </button>
                </div>

                {chatHistory.length ? (
                  <div className="admin-systems-chat-history">
                    {chatHistory.map((entry) => (
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
                    Ask about access control, file ownership, variables, or how one block connects to
                    another.
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
