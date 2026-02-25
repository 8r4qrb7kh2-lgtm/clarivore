"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../lib/supabase";

const DEFAULT_DIAGRAM_ID = "storage-topology";

function asText(value) {
  return String(value || "").trim();
}

function normalizeDiagramList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: asText(item?.id),
      title: asText(item?.title) || "Untitled diagram",
      description: asText(item?.description),
    }))
    .filter((item) => item.id);
}

function buildQuestionHistoryMessages(history) {
  const rows = (Array.isArray(history) ? history : []).slice(-5);
  const messages = [];
  rows.forEach((row) => {
    const question = asText(row?.question);
    const answer = asText(row?.answer);
    if (!question || !answer) return;
    messages.push({ role: "user", content: question });
    messages.push({ role: "assistant", content: answer });
  });
  return messages;
}

export default function AdminDataFlowVisualsTab() {
  const [diagramList, setDiagramList] = useState([]);
  const [selectedDiagramId, setSelectedDiagramId] = useState(DEFAULT_DIAGRAM_ID);
  const [diagramSvgById, setDiagramSvgById] = useState({});
  const [diagramMetaById, setDiagramMetaById] = useState({});
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDiagram, setLoadingDiagram] = useState(false);
  const [asking, setAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [clickContext, setClickContext] = useState(null);
  const [qaHistory, setQaHistory] = useState([]);

  const diagramWrapRef = useRef(null);
  const questionInputRef = useRef(null);

  const selectedDiagram = useMemo(() => {
    return diagramList.find((diagram) => diagram.id === selectedDiagramId) || null;
  }, [diagramList, selectedDiagramId]);

  const selectedSvg = useMemo(() => {
    return asText(diagramSvgById[selectedDiagramId]);
  }, [diagramSvgById, selectedDiagramId]);

  const selectedUpdatedAt = useMemo(() => {
    return asText(diagramMetaById[selectedDiagramId]?.updatedAt);
  }, [diagramMetaById, selectedDiagramId]);

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
      const response = await fetch("/api/admin/data-flow-visuals", {
        method: "GET",
        headers,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(
          asText(payload?.error || payload?.message) || "Failed to load diagram list.",
        );
      }

      const nextList = normalizeDiagramList(payload?.diagrams);
      setDiagramList(nextList);
      setSelectedDiagramId((current) => {
        if (current && nextList.some((item) => item.id === current)) return current;
        return nextList[0]?.id || DEFAULT_DIAGRAM_ID;
      });
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to load diagrams.");
      setDiagramList([]);
    } finally {
      setLoadingList(false);
    }
  }, [getAuthHeaders]);

  const loadDiagramSvg = useCallback(
    async (diagramId) => {
      const safeId = asText(diagramId);
      if (!safeId) return;
      if (asText(diagramSvgById[safeId])) return;

      setLoadingDiagram(true);
      setErrorMessage("");
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `/api/admin/data-flow-visuals?diagramId=${encodeURIComponent(safeId)}`,
          {
            method: "GET",
            headers,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
          throw new Error(
            asText(payload?.error || payload?.message) || "Failed to load diagram.",
          );
        }

        const svg = asText(payload?.svg);
        if (!svg) {
          throw new Error("Diagram SVG is empty.");
        }

        setDiagramSvgById((current) => ({ ...current, [safeId]: svg }));
        setDiagramMetaById((current) => ({
          ...current,
          [safeId]: {
            updatedAt: asText(payload?.updatedAt),
          },
        }));
      } catch (error) {
        setErrorMessage(asText(error?.message) || "Failed to load selected diagram.");
      } finally {
        setLoadingDiagram(false);
      }
    },
    [diagramSvgById, getAuthHeaders],
  );

  useEffect(() => {
    loadDiagramList();
  }, [loadDiagramList]);

  useEffect(() => {
    if (!selectedDiagramId) return;
    loadDiagramSvg(selectedDiagramId);
  }, [loadDiagramSvg, selectedDiagramId]);

  const onSelectDiagram = useCallback((diagramId) => {
    const safeId = asText(diagramId);
    if (!safeId) return;
    setSelectedDiagramId(safeId);
    setClickContext(null);
  }, []);

  const onDiagramClick = useCallback((event) => {
    const wrap = diagramWrapRef.current;
    if (!wrap) return;
    const svg = wrap.querySelector("svg");
    if (!svg) return;
    if (!svg.contains(event.target)) return;

    const rect = svg.getBoundingClientRect();
    const clientX = Number(event.clientX);
    const clientY = Number(event.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    if (!rect.width || !rect.height) return;

    const xPercent = Math.max(Math.min(((clientX - rect.left) / rect.width) * 100, 100), 0);
    const yPercent = Math.max(Math.min(((clientY - rect.top) / rect.height) * 100, 100), 0);
    const targetTag = asText(event.target?.tagName || "").toLowerCase();
    const targetText = asText(event.target?.textContent || "")
      .replace(/\s+/g, " ")
      .slice(0, 240);

    setClickContext({
      xPercent: Number(xPercent.toFixed(2)),
      yPercent: Number(yPercent.toFixed(2)),
      targetTag,
      targetText,
      clickedAt: new Date().toISOString(),
    });
    questionInputRef.current?.focus();
  }, []);

  const askDiagramQuestion = useCallback(async () => {
    const question = asText(questionInput);
    if (!question || asking) return;
    if (!selectedDiagramId) {
      setErrorMessage("Select a diagram first.");
      return;
    }

    const historyMessages = buildQuestionHistoryMessages(
      qaHistory.filter((row) => row.diagramId === selectedDiagramId),
    );
    setAsking(true);
    setErrorMessage("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/data-flow-ask", {
        method: "POST",
        headers,
        body: JSON.stringify({
          diagramId: selectedDiagramId,
          question,
          clickContext,
          messages: historyMessages,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(
          asText(payload?.error || payload?.message) || "Failed to ask diagram question.",
        );
      }

      setQaHistory((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          diagramId: selectedDiagramId,
          question,
          answer: asText(payload?.answer),
          clickContext,
          createdAt: new Date().toISOString(),
        },
      ]);
      setQuestionInput("");
    } catch (error) {
      setErrorMessage(asText(error?.message) || "Failed to ask question.");
    } finally {
      setAsking(false);
    }
  }, [asking, clickContext, getAuthHeaders, qaHistory, questionInput, selectedDiagramId]);

  return (
    <div className="tab-content active">
      <div className="admin-card admin-card-full admin-flow-card">
        <h2>🧭 Data Storage Visuals</h2>
        <p className="admin-flow-subtitle">
          Click anywhere inside a visual, then ask a plain-language question. Your click location
          is sent as context.
        </p>

        {errorMessage ? <p className="status-text error">{errorMessage}</p> : null}

        <div className="admin-flow-layout">
          <aside className="admin-flow-sidebar">
            <h3>Diagrams</h3>
            {loadingList ? (
              <p className="admin-flow-muted">Loading diagram list...</p>
            ) : !diagramList.length ? (
              <p className="admin-flow-muted">No diagrams available.</p>
            ) : (
              <div className="admin-flow-list">
                {diagramList.map((diagram) => (
                  <button
                    key={diagram.id}
                    type="button"
                    className={`admin-flow-list-item${
                      selectedDiagramId === diagram.id ? " active" : ""
                    }`}
                    onClick={() => onSelectDiagram(diagram.id)}
                  >
                    <strong>{diagram.title}</strong>
                    {diagram.description ? <span>{diagram.description}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="admin-flow-viewer">
            <div className="admin-flow-viewer-header">
              <h3>{selectedDiagram?.title || "Diagram"}</h3>
              {selectedUpdatedAt ? (
                <span className="admin-flow-updated">
                  Updated: {new Date(selectedUpdatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>

            <div className="admin-flow-svg-wrap" ref={diagramWrapRef} onClick={onDiagramClick}>
              {loadingDiagram && !selectedSvg ? (
                <p className="admin-flow-muted">Loading visual...</p>
              ) : selectedSvg ? (
                <>
                  <div className="admin-flow-svg" dangerouslySetInnerHTML={{ __html: selectedSvg }} />
                  {clickContext ? (
                    <span
                      className="admin-flow-click-marker"
                      style={{
                        left: `${clickContext.xPercent}%`,
                        top: `${clickContext.yPercent}%`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                </>
              ) : (
                <p className="admin-flow-muted">Select a diagram to view.</p>
              )}
            </div>

            <div className="admin-flow-ask-panel">
              <div className="admin-flow-click-context">
                {clickContext ? (
                  <>
                    <span>
                      Clicked at {clickContext.xPercent}% x {clickContext.yPercent}%
                    </span>
                    {clickContext.targetText ? (
                      <span className="admin-flow-click-text">Near: {clickContext.targetText}</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setClickContext(null)}
                    >
                      Clear click
                    </button>
                  </>
                ) : (
                  <span className="admin-flow-muted">
                    No click context yet. Tap anywhere in the visual to anchor your question.
                  </span>
                )}
              </div>

              <div className="admin-flow-ask-row">
                <textarea
                  ref={questionInputRef}
                  value={questionInput}
                  onChange={(event) => setQuestionInput(event.target.value)}
                  placeholder="Ask in plain language (example: Who can trigger this write path and from which page?)"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={askDiagramQuestion}
                  disabled={asking || !asText(questionInput)}
                >
                  {asking ? "Asking..." : "Ask about this visual"}
                </button>
              </div>
            </div>

            {qaHistory.length ? (
              <div className="admin-flow-qa-list">
                {qaHistory
                  .filter((row) => row.diagramId === selectedDiagramId)
                  .slice()
                  .reverse()
                  .map((row) => (
                    <article key={row.id} className="admin-flow-qa-item">
                      <p className="admin-flow-qa-question">
                        <strong>Q:</strong> {row.question}
                      </p>
                      <p className="admin-flow-qa-answer">
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
