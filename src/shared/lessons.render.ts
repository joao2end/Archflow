/**
 * Arquivos derivados das aulas de DDD: o diagrama (.archflow.json), o README de cada aula (os passos com o código e as
 * peças do diagrama) e o índice `aulas-ddd/README.md`. O código das aulas é escrito à mão e só é lido.
 * Usado por `scripts/build-examples.ts` (grava) e pelos testes (conferem que o que está em disco está em dia).
 */
import type { RenderedFile } from "./examples.render";
import { LESSONS, LESSONS_DIR, buildLessonDoc, codeRegion, lessonCodePath, lessonPath, type Lesson } from "./lessons";

/** Lê um arquivo de `examples/` pelo caminho relativo. */
export type ReadExample = (path: string) => string;

function lessonReadme(l: Lesson, read: ReadExample): string {
  const doc = buildLessonDoc(l);
  const label = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? doc.groups.find((g) => g.id === id)?.label ?? id;
  const diagram = lessonPath(l).slice(LESSONS_DIR.length + 1);
  const out = [
    `# Aula ${l.n} · ${l.title}`,
    "",
    `> Gerado a partir de \`src/shared/lessons.ts\` (\`npm run examples:build\`). Não edite à mão: o código em [\`codigo/\`](codigo/) é a fonte, este texto só o cita.`,
    "",
    l.summary,
    "",
    `**Você vai ver:** ${l.teaches.join(" · ")}.`,
    "",
    "## Como acompanhar",
    "",
    `- **No app:** explorador → *Exemplos* → *Domínio* → «Aula ${l.n} · ${l.title}» → *Instalar e abrir*. O diagrama abre na visão 3D com o painel da aula: cada passo acende as peças do diagrama e mostra o código delas.`,
    `- **Fora do app:** o diagrama é [\`../${diagram}\`](../${diagram}) e o código está em [\`codigo/\`](codigo/). Para rodar: \`npx tsx examples/${lessonCodePath(l, "exemplo.ts")}\`.`,
    "",
    "## Passo a passo",
  ];
  l.steps.forEach((s, i) => {
    out.push("", `### ${i + 1}. ${s.title}`, "", s.text, "", `**Peças destacadas:** ${s.focus.map(label).join(", ")}.`);
    if (s.code) {
      const code = codeRegion(read(lessonCodePath(l, s.code.file)), s.code.region);
      if (code === undefined) throw new Error(`aula ${l.id}: região «${s.code.region}» não existe em ${s.code.file}`);
      out.push("", `[\`codigo/${s.code.file}\`](codigo/${s.code.file})`, "", "```ts", code, "```");
    }
  });
  out.push("", "## Para praticar", "", ...l.exercises.map((e) => `- ${e}`));
  const next = LESSONS.find((x) => x.n === l.n + 1);
  if (next) out.push("", `Próxima: [Aula ${next.n} · ${next.title}](../${next.id}/README.md).`);
  return out.join("\n") + "\n";
}

function indexReadme(): string {
  return [
    "# Aulas de DDD em TypeScript",
    "",
    "> Gerado a partir de `src/shared/lessons.ts` (`npm run examples:build`).",
    "",
    "Três aulas curtas para aprender DDD **pelo diagrama**: cada passo destaca as peças do modelo (no 2D e na visão 3D das camadas) e mostra o código TypeScript que as implementa. O código de cada aula compila com `tsc --strict` e roda com `npx tsx`.",
    "",
    "| Aula | O que acrescenta |",
    "| --- | --- |",
    ...LESSONS.map((l) => `| [${l.n} · ${l.title}](${l.id}/README.md) | ${l.teaches.join(", ")} |`),
    "",
    "Depois das aulas, siga para os modelos completos em [`../exemplos-ddd`](../exemplos-ddd/) (Biblioteca → Clínica → Loja → Banco → Delivery).",
    "",
  ].join("\n");
}

export function renderLessons(read: ReadExample): RenderedFile[] {
  return [
    ...LESSONS.flatMap((l) => [
      { path: lessonPath(l), content: JSON.stringify(buildLessonDoc(l), null, 2) + "\n" },
      { path: `${LESSONS_DIR}/${l.id}/README.md`, content: lessonReadme(l, read) },
    ]),
    { path: `${LESSONS_DIR}/README.md`, content: indexReadme() },
  ];
}
