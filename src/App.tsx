import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import JSON5 from "json5";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import "./App.css";

type DragnFile = {
  actionLists?: Record<string, unknown[]>;
  functions?: Record<string, { args?: unknown[]; code?: unknown[] }>;
};

const starterJson = `{
  actionLists: {
    "Scenario Early Init 1": [
      ["LOG", "Starting scenario setup."],
      ["ASK_SCENARIO_QUESTION_AND_CONTINUE", "Choose one.", ["A", "B"], "Scenario Early Init 2"]
    ],
    "Scenario Early Init 2": [
      ["LOG", "Continuing setup."]
    ]
  }
}`;

//function findActionListReferences(value: unknown, actionListNames: Set<string>): string[] {
//  const found = new Set<string>();
//
//  function walk(item: unknown) {
//    if (typeof item === "string" && actionListNames.has(item)) {
//      found.add(item);
//      return;
//    }
//
//    if (Array.isArray(item)) {
//      for (const child of item) walk(child);
//      return;
//    }
//
//    if (item && typeof item === "object") {
//      for (const child of Object.values(item)) walk(child);
//    }
//  }
//
//  walk(value);
//  return [...found];
//}

function findUnreachableActionLists(
  actionLists: Record<string, unknown[]>
): string[] {
  const names = Object.keys(actionLists);

  if (names.length === 0) return [];

  const referenced = new Set<string>();

  for (const actions of Object.values(actionLists)) {
    if (!Array.isArray(actions)) continue;

    for (const action of actions) {
      for (const target of extractActionListTargets(action)) {
        referenced.add(target);
      }
    }
  }

  const likelyEntryPoints = names.filter((name) =>
    /\b(init|start|setup|early init|scenario init)\b/i.test(name)
  );

  const entryPoints = likelyEntryPoints.length > 0 ? likelyEntryPoints : [names[0]];

  return names.filter(
    (name) => !entryPoints.includes(name) && !referenced.has(name)
  );
}

function findMissingActionListReferences(
  actionLists: Record<string, unknown[]>
): { from: string; target: string }[] {
  const names = new Set(Object.keys(actionLists));
  const missing: { from: string; target: string }[] = [];

  for (const [from, actions] of Object.entries(actionLists)) {
    if (!Array.isArray(actions)) continue;

    for (const action of actions) {
      for (const target of extractActionListTargets(action)) {
        if (!names.has(target)) {
          missing.push({ from, target });
        }
      }
    }
  }

  return missing;
}

function extractActionListTargets(action: unknown): string[] {
  if (!Array.isArray(action)) return [];

  const command = action[0];

  if (typeof command !== "string") return [];

  switch (command) {
    case "ASK_SCENARIO_QUESTION_AND_CONTINUE":
      return typeof action[4] === "string" ? [action[4]] : [];

    case "ASK_SCENARIO_QUESTION_AND_CONTINUE_SCN":
      return typeof action[4] === "string" ? [action[4]] : [];

    case "LOAD_CARDS":
      return [];

    case "COND": {
      const results: string[] = [];

      for (const item of action.slice(1)) {
        results.push(...extractNestedTargets(item));
      }

      return results;
    }

    default:
      return extractNestedTargets(action.slice(1));
  }
}

function extractNestedTargets(value: unknown): string[] {
  const results: string[] = [];

  function walk(item: unknown) {
    if (Array.isArray(item)) {
      results.push(...extractActionListTargets(item));

      for (const child of item) {
        walk(child);
      }
    }
  }

  walk(value);

  return results;
}

function commandSummary(action: unknown): string {
  if (!Array.isArray(action)) return JSON.stringify(action);

  const command = action[0];

  if (typeof command !== "string") {
    return JSON.stringify(action);
  }

  switch (command) {
    case "LOG":
      return `📝 LOG: ${String(action[1] ?? "")}`;

    case "VAR":
      return `📌 VAR ${String(action[1] ?? "")} = ${JSON.stringify(action[2])}`;

    case "COND":
      return `🔀 COND: if ${JSON.stringify(action[1])}`;

    case "LOAD_CARDS":
      return `🃏 LOAD_CARDS: ${JSON.stringify(action[1])}`;

    case "ASK_SCENARIO_QUESTION_AND_CONTINUE":
      return `❓ ASK: ${String(action[1] ?? "")} → ${String(action[4] ?? "")}`;

    case "ASK_SCENARIO_QUESTION":
      return `❓ ASK: ${String(action[1] ?? "")}`;

    case "FOR_EACH_VAL":
      return `🔁 FOR_EACH_VAL ${String(action[1] ?? "")} in ${String(action[2] ?? "")}`;

    case "SET":
      return `✏️ SET ${JSON.stringify(action[1])} = ${JSON.stringify(action[2])}`;

    case "INCREASE_VAL":
      return `➕ INCREASE ${String(action[1] ?? "")} by ${JSON.stringify(action[2])}`;

    case "DECREASE_VAL":
      return `➖ DECREASE ${String(action[1] ?? "")} by ${JSON.stringify(action[2])}`;

    default:
      return `⚙️ ${command}: ${JSON.stringify(action.slice(1))}`;
  }
}

function formatRawAction(action: unknown): string {
  return JSON.stringify(action);
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 100;

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));

  graph.setGraph({
    rankdir: "TB",
    nodesep: 60,
    ranksep: 120,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id);

    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
    };
  });
}

function getCommandName(action: unknown): string {
  return Array.isArray(action) && typeof action[0] === "string"
    ? action[0]
    : "UNKNOWN";
}

function getActionListStats(actions: unknown[]) {
  const commands = actions.map(getCommandName);

  return {
    total: commands.length,
    asks: commands.filter((cmd) => cmd.includes("ASK")).length,
    conds: commands.filter((cmd) => cmd === "COND").length,
    vars: commands.filter((cmd) => cmd === "VAR").length,
    loads: commands.filter((cmd) => cmd === "LOAD_CARDS").length,
    logs: commands.filter((cmd) => cmd === "LOG").length,
  };
}

function getNodeBorderColor(stats: ReturnType<typeof getActionListStats>): string {
  if (stats.asks > 0) return "#f59e0b";
  if (stats.conds > 0) return "#8b5cf6";
  if (stats.loads > 0) return "#10b981";
  if (stats.vars > 0) return "#3b82f6";
  return "#999";
}

export default function App() {
  return (
    <ReactFlowProvider>
      <DragnFlowApp />
    </ReactFlowProvider>
  );
}


function DragnFlowApp() {
  const [source, setSource] = useState(starterJson);
  const [selectedActionList, setSelectedActionList] = useState<string | null>(null);
  const [manualNodes, setManualNodes, onNodesChange] = useNodesState<Node>([]);
  const { setCenter } = useReactFlow();


  function goToActionList(name: string) {
    setSelectedActionList(name);

    const node = manualNodes.find((node) => node.id === name);

    if (!node) return;

    setCenter(
      node.position.x + 140,
      node.position.y + 50,
      {
        zoom: 1.2,
        duration: 500,
      }
    );
  }

  const parsed = useMemo(() => {
    try {
      const data = JSON5.parse(source) as DragnFile;
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [source]);

  const actionLists = parsed.data?.actionLists && !parsed.error
    ? parsed.data.actionLists
    : {};
  const actionListNames = useMemo(() => new Set(Object.keys(actionLists)), [actionLists]);
  const missingRefs = useMemo(
    () => findMissingActionListReferences(actionLists),
    [actionLists]
  );
  const unreachableActionLists = useMemo(
    () => findUnreachableActionLists(actionLists),
    [actionLists]
  );

  const unreachableActionListNames = useMemo(
    () => new Set(unreachableActionLists),
    [unreachableActionLists]
  );

  const { nodes, edges } = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    const names = Object.keys(actionLists);

    const nodes: Node[] = names.map((name, index) => {
      const actions = Array.isArray(actionLists[name]) ? actionLists[name] : [];
      const stats = getActionListStats(actions);
      const borderColor = getNodeBorderColor(stats);
      const isUnreachable = unreachableActionListNames.has(name);

      return {
        id: name,
        position: {
          x: (index % 3) * 340,
          y: Math.floor(index / 3) * 180,
        },
        data: {
          label: (
            <div>
              <strong>{name}</strong>
              {isUnreachable && (
                <div className="node-warning">
                  Possibly unreachable
                </div>
              )}
              <div className="node-subtitle">
                {stats.total} actions
              </div>

              <div className="node-badges">
                {stats.asks > 0 && <span>❓ {stats.asks}</span>}
                {stats.conds > 0 && <span>🔀 {stats.conds}</span>}
                {stats.loads > 0 && <span>🃏 {stats.loads}</span>}
                {stats.vars > 0 && <span>📌 {stats.vars}</span>}
                {stats.logs > 0 && <span>📝 {stats.logs}</span>}
              </div>
            </div>
          ),
        },
        style: {
          width: 280,
          borderRadius: 12,
          border: isUnreachable
            ? "2px dashed #3b82f6"
            : selectedActionList === name
              ? `3px solid ${borderColor}`
              : `2px solid ${borderColor}`,
          padding: 12,
          opacity: isUnreachable ? 0.65 : 1,
          backgroundColor: "#1e1e1e",
          color: "#e5e5e5",
        },
      };
    });

    const edges: Edge[] = [];

    for (const [fromName, actions] of Object.entries(actionLists)) {
      const refs = Array.isArray(actions)
        ? actions.flatMap((action) => extractActionListTargets(action))
        : [];

      for (const toName of refs) {
        if (fromName === toName) continue;

        edges.push({
          id: `${fromName}->${toName}`,
          source: fromName,
          target: toName,
          animated: true,
        });
      }
    }

    return {
      nodes: layoutNodes(nodes, edges),
      edges,
    };
  }, [actionLists, actionListNames, selectedActionList]);

  useEffect(() => {
    setManualNodes((currentNodes) => {
      const currentIds = currentNodes.map((node) => node.id).join("|");
      const nextIds = nodes.map((node) => node.id).join("|");

      if (currentIds === nextIds) {
        return currentNodes;
      }

      return nodes;
    });
  }, [nodes, setManualNodes]);

  const selectedActions =
    selectedActionList && Array.isArray(actionLists[selectedActionList])
      ? actionLists[selectedActionList]
      : [];

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>DragnFlow</h1>

        <p className="muted">
          Paste a DragnCards JSON/JSONC file below. This first pass visualizes
          <code> actionLists</code> and continuation references.
        </p>

        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
        />

        {parsed.error && <div className="error">Parse error: {parsed.error}</div>}
      </aside>

      <main className="main">
        <section className="graph">
          <ReactFlow
            nodes={manualNodes}
            edges={edges}
            fitView
            proOptions={{ hideAttribution: true }}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelectedActionList(node.id)}
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </section>

        <section className="inspector">
          <h2>{selectedActionList ?? "Select an actionList"}</h2>
          {missingRefs.length > 0 && (
            <div className="warning-box">
              <strong>Missing actionList references:</strong>
              <ul>
                {missingRefs.map((ref, index) => (
                  <li key={index}>
                    <code>{ref.from}</code> → <code>{ref.target}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unreachableActionLists.length > 0 && (
            <div className="info-box">
              <strong>Possibly unreachable actionLists:</strong>
              <ul>
                {unreachableActionLists.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selectedActions.length === 0 ? (
            <p className="muted">Click a node to inspect its commands.</p>
          ) : (
            <ol className="action-list">
              {selectedActions.map((action, index) => (
                <li key={index} className="action-item">
                  <div className="action-summary">
                    <code>{commandSummary(action)}</code>
                  </div>

                  {extractActionListTargets(action)
                    .filter((target) => actionListNames.has(target))
                    .map((target) => (
                      <button
                        key={target}
                        className="jump-button"
                        type="button"
                        onClick={() => goToActionList(target)}
                      >
                        Go to {target}
                      </button>
                    ))}

                  <details>
                    <summary>Raw JSON</summary>
                    <pre>{formatRawAction(action)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

