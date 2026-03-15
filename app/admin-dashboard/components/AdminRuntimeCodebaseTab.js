"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../lib/supabase";

function asText(value) {
  return String(value || "").trim();
}

function normalizeDiagramList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: asText(item?.id),
      title: asText(item?.title) || "Untitled diagram",
      description: asText(item?.description),
      parentDiagramId: asText(item?.parentDiagramId),
      parentBlockId: asText(item?.parentBlockId),
    }))
    .filter((item) => item.id);
}

function buildQuestionHistoryMessages(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-5)
    .flatMap((row) => {
      const question = asText(row?.question);
      const answer = asText(row?.answer);
      if (!question || !answer) return [];
      return [
        { role: "user", content: question },
        { role: "assistant", content: answer },
      ];
    });
}

function summarizeVariable(variable) {
  const name = asText(variable?.name);
  const description = asText(variable?.description);
  const usedFor = asText(variable?.usedFor);
  return `${name || "variable"}: ${description || "(no description)"}${usedFor ? ` Used for: ${usedFor}` : ""}`;
}

export default function AdminRuntimeCodebaseTab() {
  const [diagramList, setDiagramList] = useState([]);
  const [diagramById, setDiagramById] = useState({});
  const [trail, setTrail] = useState([{ diagramId: "runtime-root", viaBlockId: "", viaBlockTitle: "" }]);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDiagram, setLoadingDiagram] = useState(false);
  const [questionInput, setQuestionInput] = useState("");
  const [qaHistory, setQaHistory] = useState([]);
  const [asking, setAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const questionInputRef = useRef(null);

  const currentTrailEntry = trail[trail.length - 1] || { diagramId: "runtime-root" };
  const currentDiagramId = asText(currentTrailEntry?.diagramId) || "runtime-root";

  const currentDiagram = useMemo(() => {
    return diagramById[currentDiagramId] || null;
  }, [currentDiagramId, diagramById]);

  const selectedBlock = useMemo(() => {
    const blocks = Array.isArray(currentDiagram?.blocks) ? currentDiagram.blocks : [];
    return blocks.find((block) => asText(block?.id) === selectedBlockId) || null;
  }, [currentDiagram, selectedBlockId]);

  const relatedConnections = useMemo(() => {
    const connections = Array.isArray(currentDiagram?.connections) ? currentDiagram.connections : [];
    if (!selectedBlockId) return connections;
    return connections.filter((row) => {
      const from = asText(row?.from);
      const to = asText(row?.to);
      return from === selectedBlockId || to === selectedBlockId;
    });
  }, [currentDiagram, selectedBlockId]);

  const getAuthHeaders = useCallback(async () => {
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
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
  }, []);

  const loadDiagramList = useCallback(async () => {
    setLoadingList(true);
    setErrorMessage("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/runtime-flow", {
        method: "GET",
        headers,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(asText(payload?.error || payload?.message) || "Failed to load runtime diagrams.");
      }

      const list = normalizeDiagramList(payload?.diagrams);
      setDiagramList(list);
      const rootId = asText(payload?.rootDiagramId) || "runtime-root";
      setTrail([{ diagramId: rootId, viaBlockId: "", viaBlockTitle: "" }]);
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to load runtime diagrams.");
      setDiagramList([]);
    } finally {
      setLoadingList(false);
    }
  }, [getAuthHeaders]);

  const loadDiagram = useCallback(
    async (diagramId) => {
      const safeId = asText(diagramId);
      if (!safeId) return;
      if (diagramById[safeId]) return;

      setLoadingDiagram(true);
      setErrorMessage("");
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/admin/runtime-flow?diagramId=${encodeURIComponent(safeId)}`, {
          method: "GET",
          headers,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
          throw new Error(asText(payload?.error || payload?.message) || "Failed to load runtime diagram.");
        }

        setDiagramById((current) => ({
          ...current,
          [safeId]: payload.diagram,
        }));
      } catch (error) {
        setErrorMessage(asText(error?.message) || "Failed to load runtime diagram.");
      } finally {
        setLoadingDiagram(false);
      }
    },
    [diagramById, getAuthHeaders],
  );

  useEffect(() => {
    loadDiagramList();
  }, [loadDiagramList]);

  useEffect(() => {
    if (!currentDiagramId) return;
    loadDiagram(currentDiagramId);
  }, [currentDiagramId, loadDiagram]);

  const openTrailIndex = useCallback((index) => {
    setTrail((current) => {
      if (!Array.isArray(current) || index < 0 || index >= current.length) return current;
      return current.slice(0, index + 1);
    });
    setSelectedBlockId("");
  }, []);

  const onBlockClick = useCallback((block) => {
    const blockId = asText(block?.id);
    if (!blockId) return;

    const childDiagramId = asText(block?.childDiagramId);
    if (childDiagramId) {
      setTrail((current) => [
        ...current,
        {
          diagramId: childDiagramId,
          viaBlockId: blockId,
          viaBlockTitle: asText(block?.title),
        },
      ]);
      setSelectedBlockId("");
      return;
    }

    setSelectedBlockId(blockId);
    questionInputRef.current?.focus();
  }, []);

  const askQuestion = useCallback(async () => {
    const question = asText(questionInput);
    if (!question || asking || !currentDiagramId) return;

    const blockId = asText(selectedBlock?.id);
    const historyRows = qaHistory.filter(
      (entry) =>
        asText(entry?.diagramId) === currentDiagramId &&
        asText(entry?.blockId) === blockId,
    );

    setAsking(true);
    setErrorMessage("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/runtime-flow-ask", {
        method: "POST",
        headers,
        body: JSON.stringify({
          diagramId: currentDiagramId,
          blockId,
          question,
          messages: buildQuestionHistoryMessages(historyRows),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(asText(payload?.error || payload?.message) || "Failed to ask runtime assistant.");
      }

      setQaHistory((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          diagramId: currentDiagramId,
          blockId,
          question,
          answer: asText(payload?.answer),
          createdAt: new Date().toISOString(),
        },
      ]);
      setQuestionInput("");
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to ask runtime assistant.");
    } finally {
      setAsking(false);
    }
  }, [asking, currentDiagramId, getAuthHeaders, qaHistory, questionInput, selectedBlock]);

  const visibleQa = useMemo(() => {
    const activeBlockId = asText(selectedBlock?.id);
    return qaHistory
      .filter(
        (entry) =>
          asText(entry?.diagramId) === currentDiagramId &&
          asText(entry?.blockId) === activeBlockId,
      )
      .slice()
      .reverse();
  }, [currentDiagramId, qaHistory, selectedBlock]);

  const blockById = useMemo(() => {
    const map = new Map();
    const blocks = Array.isArray(currentDiagram?.blocks) ? currentDiagram.blocks : [];
    blocks.forEach((block) => {
      map.set(asText(block?.id), block);
    });
    return map;
  }, [currentDiagram]);

  return (
    <div className="tab-content active">
      <div className="admin-card admin-card-full admin-runtime-card">
        <h2>🧩 Runtime Codebase Mapper</h2>
        <p className="admin-runtime-subtitle">
          Select a block to drill into its subsystem flow chart. Every block includes live file + line
          evidence, variable handoffs, and authorized user types.
        </p>

        {errorMessage ? <p className="status-text error">{errorMessage}</p> : null}

        <div className="admin-runtime-layout">
          <aside className="admin-runtime-sidebar">
            <h3>Flowchart systems</h3>
            {loadingList ? (
              <p className="admin-runtime-muted">Loading diagrams...</p>
            ) : !diagramList.length ? (
              <p className="admin-runtime-muted">No runtime diagrams found.</p>
            ) : (
              <div className="admin-runtime-list">
                {diagramList.map((diagram) => (
                  <button
                    key={diagram.id}
                    type="button"
                    className={`admin-runtime-list-item${currentDiagramId === diagram.id ? " active" : ""}`}
                    onClick={() => {
                      setTrail([{ diagramId: diagram.id, viaBlockId: "", viaBlockTitle: "" }]);
                      setSelectedBlockId("");
                    }}
                  >
                    <strong>{diagram.title}</strong>
                    {diagram.description ? <span>{diagram.description}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="admin-runtime-main">
            <div className="admin-runtime-breadcrumbs">
              {trail.map((entry, index) => {
                const diagramTitle = asText(diagramById[entry.diagramId]?.title)
                  || asText(diagramList.find((row) => row.id === entry.diagramId)?.title)
                  || entry.diagramId;
                return (
                  <button
                    key={`${entry.diagramId}-${index}`}
                    type="button"
                    className={`admin-runtime-crumb${index === trail.length - 1 ? " active" : ""}`}
                    onClick={() => openTrailIndex(index)}
                    disabled={index === trail.length - 1}
                  >
                    {index > 0 && entry.viaBlockTitle ? `${entry.viaBlockTitle} → ` : ""}
                    {diagramTitle}
                  </button>
                );
              })}
            </div>

            <div className="admin-runtime-header">
              <h3>{asText(currentDiagram?.title) || "Runtime diagram"}</h3>
              {currentDiagram?.description ? <p>{currentDiagram.description}</p> : null}
            </div>

            <div className="admin-runtime-canvas-wrap">
              {loadingDiagram && !currentDiagram ? (
                <p className="admin-runtime-muted">Loading selected diagram...</p>
              ) : !currentDiagram ? (
                <p className="admin-runtime-muted">Select a runtime diagram to begin.</p>
              ) : (
                <div className="admin-runtime-canvas" role="img" aria-label="Runtime component flow chart">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="admin-runtime-connections">
                    <defs>
                      <marker
                        id="runtime-flow-arrow"
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3.5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M0,0 L0,7 L7,3.5 z" fill="#64748b" />
                      </marker>
                    </defs>
                    {(Array.isArray(currentDiagram.connections) ? currentDiagram.connections : []).map((edge, index) => {
                      const fromBlock = blockById.get(asText(edge?.from));
                      const toBlock = blockById.get(asText(edge?.to));
                      if (!fromBlock || !toBlock) return null;

                      const x1 = Number(fromBlock.x) + Number(fromBlock.width) / 2;
                      const y1 = Number(fromBlock.y) + Number(fromBlock.height) / 2;
                      const x2 = Number(toBlock.x) + Number(toBlock.width) / 2;
                      const y2 = Number(toBlock.y) + Number(toBlock.height) / 2;

                      return (
                        <line
                          key={`${asText(edge?.from)}-${asText(edge?.to)}-${index}`}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          markerEnd="url(#runtime-flow-arrow)"
                        />
                      );
                    })}
                  </svg>

                  {(Array.isArray(currentDiagram.blocks) ? currentDiagram.blocks : []).map((block) => {
                    const blockId = asText(block?.id);
                    const hasChildren = Boolean(asText(block?.childDiagramId));
                    return (
                      <button
                        key={blockId}
                        type="button"
                        className={`admin-runtime-block${selectedBlockId === blockId ? " active" : ""}${hasChildren ? " branch" : " leaf"}`}
                        style={{
                          left: `${Number(block?.x) || 0}%`,
                          top: `${Number(block?.y) || 0}%`,
                          width: `${Number(block?.width) || 20}%`,
                          height: `${Number(block?.height) || 18}%`,
                        }}
                        onClick={() => onBlockClick(block)}
                        title={hasChildren ? "Open subsystem flow chart" : "Inspect runtime block evidence"}
                      >
                        <strong>{asText(block?.title)}</strong>
                        <span>{asText(block?.summary)}</span>
                        {hasChildren ? <em>Open subsystem ↗</em> : <em>Select to inspect</em>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedBlock ? (
              <div className="admin-runtime-details">
                <h4>{selectedBlock.title}</h4>
                {selectedBlock.summary ? <p>{selectedBlock.summary}</p> : null}

                <div className="admin-runtime-tag-group">
                  <span className="admin-runtime-tag-label">Authorized user types:</span>
                  {(Array.isArray(selectedBlock.authorizedUserTypes) ? selectedBlock.authorizedUserTypes : []).map((role) => (
                    <span key={`${selectedBlock.id}-${role}`} className="admin-runtime-tag">{role}</span>
                  ))}
                </div>

                <div className="admin-runtime-evidence-list">
                  <h5>Code evidence</h5>
                  {(Array.isArray(selectedBlock.codeRefs) ? selectedBlock.codeRefs : []).map((ref, index) => (
                    <article key={`${selectedBlock.id}-${index}`} className="admin-runtime-evidence-item">
                      <p>
                        <strong>{asText(ref?.filePath)}</strong>:{ref?.startLine || "?"}-{ref?.endLine || "?"}
                      </p>
                      {asText(ref?.error) ? <p className="admin-runtime-ref-error">{asText(ref.error)}</p> : null}
                      {asText(ref?.snippet) ? <pre>{asText(ref.snippet)}</pre> : null}
                    </article>
                  ))}
                </div>

                <div className="admin-runtime-evidence-list">
                  <h5>Variable handoffs touching this block</h5>
                  {relatedConnections.length ? (
                    relatedConnections.map((connection, connectionIndex) => (
                      <article
                        key={`${asText(connection?.from)}-${asText(connection?.to)}-${connectionIndex}`}
                        className="admin-runtime-evidence-item"
                      >
                        <p>
                          <strong>{asText(connection?.from)}</strong> → <strong>{asText(connection?.to)}</strong>
                        </p>
                        <ul>
                          {(Array.isArray(connection?.variables) ? connection.variables : []).map((variable, variableIndex) => (
                            <li key={`${connectionIndex}-${variableIndex}`}>{summarizeVariable(variable)}</li>
                          ))}
                        </ul>
                      </article>
                    ))
                  ) : (
                    <p className="admin-runtime-muted">No variable handoffs mapped for this block yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="admin-runtime-muted">
                Choose a leaf block to inspect file/line evidence and variable details. Branch blocks open
                nested subsystem flow charts.
              </p>
            )}

            <div className="admin-runtime-ask-panel">
              <div className="admin-runtime-ask-row">
                <textarea
                  ref={questionInputRef}
                  value={questionInput}
                  onChange={(event) => setQuestionInput(event.target.value)}
                  placeholder="Ask about the selected block (or full diagram if no block is selected)."
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={askQuestion}
                  disabled={asking || !asText(questionInput)}
                >
                  {asking ? "Asking..." : "Ask runtime assistant"}
                </button>
              </div>
              <p className="admin-runtime-muted">
                Chat answers are grounded in the current repository files and line ranges returned by this
                runtime map.
              </p>
            </div>

            {visibleQa.length ? (
              <div className="admin-runtime-qa-list">
                {visibleQa.map((row) => (
                  <article key={row.id} className="admin-runtime-qa-item">
                    <p>
                      <strong>Q:</strong> {row.question}
                    </p>
                    <p>
                      <strong>A:</strong> {row.answer}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
