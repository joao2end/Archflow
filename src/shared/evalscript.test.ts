import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyOps, type Op } from "./ops";
import { emptyDoc } from "./schema";

const model = (withCommand: boolean) => {
  const ops: Op[] = [
    { op: "add_group", id: "pedidos", label: "Pedidos", kind: "context", subdomain: "core" },
    { op: "add_node", id: "fazer-pedido", label: "Fazer pedido", parent: "pedidos", ddd: { role: "use-case", actor: "Cliente" } },
    ...(withCommand
      ? ([
          { op: "add_node", id: "pedido", label: "Pedido", parent: "pedidos", ddd: { role: "aggregate-root" } },
          { op: "add_node", id: "criar-pedido", label: "Criar Pedido", parent: "pedidos", ddd: { role: "command" } },
          { op: "add_node", id: "pedido-criado", label: "Pedido Criado", parent: "pedidos", ddd: { role: "domain-event" } },
          { op: "add_connection", from: "criar-pedido", to: "pedido", ddd: { rel: "triggers" } },
          { op: "add_connection", from: "criar-pedido", to: "pedido-criado", ddd: { rel: "emits" } },
          { op: "add_connection", from: "criar-pedido", to: "fazer-pedido", ddd: { rel: "realizes" } },
        ] as Op[])
      : []),
  ];
  return applyOps(emptyDoc("t", "domain"), ops).doc;
};

test("npm run eval:domain: aprova o modelo completo (exit 0) e reprova o incompleto (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "archflow-eval-"));
  try {
    const good = join(dir, "bom.archflow.json");
    const bad = join(dir, "ruim.archflow.json");
    const arch = join(dir, "arq.archflow.json");
    writeFileSync(good, JSON.stringify(model(true)));
    writeFileSync(bad, JSON.stringify(model(false)));
    writeFileSync(arch, JSON.stringify(emptyDoc("arq")));
    const run = (...files: string[]) => spawnSync("npx", ["tsx", "scripts/eval-domain.ts", ...files], { cwd: process.cwd(), encoding: "utf8", shell: true });
    const ok = run(good, arch);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /✔ .*bom\.archflow\.json: 1\/1 casos de uso rastreados \(100%\) · 0 erros estruturais · 0 a corrigir/);
    assert.match(ok.stdout, /arq\.archflow\.json: modo architecture \(ignorado\)/);
    const ko = run(good, bad);
    assert.equal(ko.status, 1);
    assert.match(ko.stdout, /✘ .*ruim\.archflow\.json: 0\/1 casos de uso rastreados \(0%\)/);
    assert.equal(run().status, 2, "sem arquivos mostra o uso");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
