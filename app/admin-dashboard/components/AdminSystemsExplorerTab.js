"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../lib/supabase";
import { isAdminDashboardDevBypassEnabled } from "../services/adminDashboardAccess";

const ROOT_NODE_ID = "workspace:clarivore-runtime";
const POLL_INTERVAL_MS = 2_000;
const MAX_FLOW_LINKS = 12;

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

function getNodeActionLabel(node) {
  if (node.kind === "directory") return "Open subsystem";
  if (node.kind === "file") return node.childCount ? "Open file blocks" : "Inspect file";
  if (node.kind === "symbol") return "Inspect block";
  return "Open runtime";
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

function DrilldownFlowChart({
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
  const flowLinks = useMemo(
    () =>
      edges.slice(0, MAX_FLOW_LINKS).map((edge) => ({
        ...edge,
        sourceLabel: nodeById.get(edge.source)?.label || "Source",
        targetLabel: nodeById.get(edge.target)?.label || "Target",
        variableSummary:
          edge.variables?.length
            ? edge.variables
                .slice(0, 4)
                .map((variable) => variable.name)
                .join(", ")
            : edge.label || "dependency",
      })),
    [edges, nodeById],
  );

  return (
    <section className="admin-systems-flow-shell" aria-labelledby="systems-flow-heading">
      <div className="admin-systems-flow-header">
        <div>
          <h3 id="systems-flow-heading">Drilldown flow chart</h3>
          <p>
            This chart only shows the internal makeup of the currently selected block. Click any
            child block below to rebuild the chart around that block.
          </p>
        </div>
        <div className="admin-systems-flow-stats">
          <span>{nodes.length} direct subdivisions</span>
          <span>{edges.length} observed hand-offs</span>
          <span>{currentNode?.isLeaf ? "Leaf block" : "Click a block to go deeper"}</span>
        </div>
      </div>

      <div className="admin-systems-flow-stage">
        <article className="admin-systems-focus-node" data-testid="systems-focus-node">
          <span className="admin-systems-node-kind">Current block</span>
          <strong>{currentNode?.label || "Runtime"}</strong>
          <span className="admin-systems-node-summary">{currentNode?.summary || ""}</span>
          <span className="admin-systems-node-path">{currentNode?.relativePath || "app"}</span>
          <p className="admin-systems-focus-description">
            {currentNode?.description ||
              "Select a child block to replace the chart with the system inside that block."}
          </p>
        </article>

        {nodes.length ? (
          <>
            <div className="admin-systems-flow-spine" aria-hidden="true" />
            <div className="admin-systems-drill-grid" data-testid="systems-drill-grid">
              {nodes.map((node) => {
                const traffic = trafficByNodeId.get(node.id);
                const variablePreview = Array.from(traffic?.variables || []).slice(0, 3).join(", ");
                const isOpening = navigatingNodeId === node.id;
                return (
                  <div key={node.id} className="admin-systems-drill-item">
                    <div className="admin-systems-drill-connector" aria-hidden="true" />
                    <button
                      type="button"
                      className={`admin-systems-drill-card${isOpening ? " pending" : ""}`}
                      data-node-id={node.id}
                      onClick={() => onSelectNode(node.id)}
                      aria-label={`${getNodeActionLabel(node)} ${node.label}`}
                    >
                      <span className="admin-systems-node-kind">{getNodeKindLabel(node)}</span>
                      <strong>{node.label}</strong>
                      <span className="admin-systems-node-summary">{node.summary}</span>
                      <span className="admin-systems-node-path">{node.relativePath}</span>
                      {node.authRoles?.length ? (
                        <span className="admin-systems-node-auth">
                          {node.authRoles.slice(0, 3).join(" · ")}
                        </span>
                      ) : null}

                      <div className="admin-systems-drill-metrics">
                        <span>
                          {node.childCount
                            ? `${node.childCount} deeper subdivision${node.childCount === 1 ? "" : "s"}`
                            : "No deeper subdivisions"}
                        </span>
                        <span>{node.descendantFileCount} runtime file{node.descendantFileCount === 1 ? "" : "s"}</span>
                        <span>
                          {traffic?.incoming || 0} in · {traffic?.outgoing || 0} out
                        </span>
                      </div>

                      {variablePreview ? (
                        <p className="admin-systems-drill-variables">
                          Passing: <code>{variablePreview}</code>
                        </p>
                      ) : null}

                      <span className="admin-systems-drill-action">
                        {isOpening ? "Opening…" : getNodeActionLabel(node)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="admin-systems-flow-links">
              <div className="admin-systems-panel-heading">
                <h3>Flow at this level</h3>
                <p>
                  Relationships between the child blocks currently shown in the chart.
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
                      <p>{edge.variableSummary}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="admin-systems-muted">
                  No direct child-to-child hand-offs were detected at this subdivision level.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="admin-systems-empty-state">
            <h3>No more subdivisions</h3>
            <p>
              This block is already at the file or symbol level. Use the code evidence panels below
              for the exact lines that define it.
            </p>
          </div>
        )}
      </div>
    </section>
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
  const [navigatingNodeId, setNavigatingNodeId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const currentNodeIdRef = useRef(ROOT_NODE_ID);

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
              Drill down through the current runtime hierarchy under <code>app/</code>. Every click
              redraws the flow chart for the selected block, then you can repeat that until you hit
              a leaf file or symbol.
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

            <DrilldownFlowChart
              currentNode={view?.currentNode}
              nodes={Array.isArray(view?.graph?.nodes) ? view.graph.nodes : []}
              edges={Array.isArray(view?.graph?.edges) ? view.graph.edges : []}
              navigatingNodeId={navigatingNodeId}
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
