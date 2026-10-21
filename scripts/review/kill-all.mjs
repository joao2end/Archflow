// Encerra os terminais de TODOS os projetos da instância isolada e volta ao projeto que estava aberto.
// `/api/term/info` só lista as sessões do projeto aberto, mas o limite de 4 terminais vivos é global (429 «Too Many Requests»):
// sessões que sobraram de testes em outros projetos travavam os passos seguintes.
export async function killAllSessions(API = "http://localhost:7092") {
  const j = (path, init) => fetch(`${API}${path}`, init).then((r) => r.json());
  const ws = await j("/api/workspace");
  const active = ws.project?.path;
  const { projects } = await j("/api/projects");
  const killHere = async () => {
    const i = await j("/api/term/info");
    for (const s of i.sessions) await fetch(`${API}/api/term/kill`, { method: "POST", headers: { "Content-Type": "application/json", "x-archflow-term": i.token }, body: JSON.stringify({ id: s.id }) });
  };
  for (const pr of projects) {
    await fetch(`${API}/api/projects/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pr.path }) });
    await killHere();
  }
  if (active) await fetch(`${API}/api/projects/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: active }) });
}
