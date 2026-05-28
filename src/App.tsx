import { useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from "@xyflow/react";
import JSON5 from "json5";
import "@xyflow/react/dist/style.css";
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

function findActionListReferences(value: unknown, actionListNames: Set<string>): string[] {
  const found = new Set<string>();

  function walk(item: unknown) {
    if (typeof item === "string" && actionListNames.has(item)) {
      found.add(item);
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) walk(child);
      return;
    }

    if (item && typeof item === "object") {
      for (const child of Object.values(item)) walk(child);
    }
  }

  walk(value);
  return [...found];
}

function commandSummary(action: unknown): string {
  if (!Array.isArray(action)) return JSON.stringify(action);

  const command = action[0];

  if (typeof command !== "string") {
    return JSON.stringify(action);
  }

  switch (command) {
    case "LOG":
      return `LOG: ${String(action[1] ?? "")}`;

    case "VAR":
      return `VAR ${String(action[1] ?? "")} = ${JSON.stringify(action[2])}`;

    case "COND":
      return "COND: conditional branch";

    case "ASK_SCENARIO_QUESTION_AND_CONTINUE":
      return `ASK → ${String(action[4] ?? "")}`;

    case "LOAD_CARDS":
      return `LOAD_CARDS ${JSON.stringify(action[1])}`;

    default:
      return command;
  }
}

export default function App() {
  const [source, setSource] = useState(starterJson);
  const [selectedActionList, setSelectedActionList] = useState<string | null>(null);

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

  const actionLists = parsed.data?.actionLists ?? {};
  const actionListNames = useMemo(() => new Set(Object.keys(actionLists)), [actionLists]);

  const { nodes, edges } = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    const names = Object.keys(actionLists);

    const nodes: Node[] = names.map((name, index) => ({
      id: name,
      position: {
        x: (index % 3) * 340,
        y: Math.floor(index / 3) * 180,
      },
      data: {
        label: (
          <div>
            <strong>{name}</strong>
            <div className="node-subtitle">
              {Array.isArray(actionLists[name]) ? actionLists[name].length : 0} actions
            </div>
          </div>
        ),
      },
      style: {
        width: 280,
        borderRadius: 12,
        border: selectedActionList === name ? "2px solid #646cff" : "1px solid #999",
        padding: 12,
      },
    }));

    const edges: Edge[] = [];

    for (const [fromName, actions] of Object.entries(actionLists)) {
      const refs = findActionListReferences(actions, actionListNames);

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

    return { nodes, edges };
  }, [actionLists, actionListNames, selectedActionList]);

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
            nodes={nodes}
            edges={edges}
            fitView
            onNodeClick={(_, node) => setSelectedActionList(node.id)}
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </section>

        <section className="inspector">
          <h2>{selectedActionList ?? "Select an actionList"}</h2>

          {selectedActions.length === 0 ? (
            <p className="muted">Click a node to inspect its commands.</p>
          ) : (
            <ol>
              {selectedActions.map((action, index) => (
                <li key={index}>
                  <code>{commandSummary(action)}</code>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

