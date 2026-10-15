/**
 * Catálogo único de exemplos da seção «Exemplos» do app: Arquitetura, Domínio (DDD) e Lógica.
 *
 * Cada exemplo é uma pasta do projeto com um ou mais diagramas. Arquitetura e Domínio saem de listas de ops (código); os
 * algoritmos de Lógica são arquivos `examples/exemplos-algoritmos/*.archflow.json` (gerados por `scripts/build-algorithms.ts`)
 * e chegam por um carregador, para o app buscá-los só quando a pessoa instalar (não entram no pacote principal).
 */
import { ARCH_EXAMPLES } from "./arch.examples";
import { DDD_EXAMPLES, EXAMPLES_DIR, buildExample, examplePath } from "./examples";
import { pricingDoc } from "./logic.example";
import { slug } from "./ops";
import type { Doc, DocMode } from "./schema";

export type ExampleLevel = "iniciante" | "intermediário" | "avançado";

export interface CatalogFile {
  title: string;
  /** caminho que o arquivo tem no projeto depois de instalado */
  path: string;
  mode: DocMode;
  load: () => Doc | Promise<Doc>;
}
export interface CatalogExample {
  /** único no catálogo inteiro (`<modo>:<id>`) */
  key: string;
  mode: DocMode;
  title: string;
  level: ExampleLevel;
  summary: string;
  teaches: string[];
  files: CatalogFile[];
  /** caminho do arquivo que abre depois de instalar */
  open: string;
  /** os diagramas se referenciam pelo caminho (mapa de contextos → contextos): o caminho criado tem de ser exatamente o previsto */
  linked: boolean;
}

export const ARCH_DIR = "exemplos-arquitetura";
export const LOGIC_DIR = "exemplos-logic";
export const ALGORITHMS_DIR = `${LOGIC_DIR}/algoritmos`;

const pathOf = (dir: string, title: string) => `${dir}/${slug(title)}.archflow.json`;

/** Metadados dos algoritmos: o `title` é o do diagrama (um teste confere), o `file` é o nome em `examples/exemplos-algoritmos/`. */
export interface AlgorithmMeta {
  file: string;
  title: string;
  level: ExampleLevel;
  summary: string;
  teaches: string[];
}
export const ALGORITHM_EXAMPLES: AlgorithmMeta[] = [
  { file: "busca-binaria", title: "Busca binária (primeira ocorrência)", level: "iniciante", summary: "Acha a posição do primeiro valor igual numa lista ordenada, dividindo o intervalo ao meio a cada volta.", teaches: ["laço com condição de parada", "lista e índice", "fronteira < × <="] },
  { file: "merge-intervalos", title: "Merge de intervalos", level: "iniciante", summary: "Junta intervalos que se sobrepõem ou se tocam, numa só passada, guardando o intervalo em construção.", teaches: ["para cada item", "estado entre voltas", "decisão com <="] },
  { file: "janela-sem-repeticao", title: "Maior trecho sem repetição (janela deslizante)", level: "intermediário", summary: "Maior trecho seguido de números sem repetir, com um mapa «valor → última posição» feito de pares.", teaches: ["janela deslizante", "mapa como lista de pares", "filtrar e mapear"] },
  { file: "cache-lru", title: "Cache LRU (menos recentemente usado)", level: "intermediário", summary: "Simula um cache de capacidade fixa: o que sai é o que ficou mais tempo sem uso.", teaches: ["ordem de uso", "despejo", "operação desconhecida é erro"] },
  { file: "ordenacao-topologica", title: "Ordenação topológica (Kahn)", level: "intermediário", summary: "Põe tarefas numa ordem que respeita as dependências e acusa ciclo.", teaches: ["grafo como lista de arestas", "nós livres", "detecção de ciclo"] },
  { file: "shunting-yard", title: "Expressão para notação pós-fixa (Shunting-yard)", level: "intermediário", summary: "Converte 3 + 4 * 2 em 3 4 2 * +, com precedência, agrupamento pela esquerda e parênteses.", teaches: ["Switch por valor", "pilha com repetidos", "precedência"] },
  { file: "dijkstra", title: "Menor caminho (Dijkstra)", level: "avançado", summary: "Custo do caminho mais barato entre dois nós de um grafo com pesos.", teaches: ["laços aninhados", "relaxamento de arestas", "infinito como constante"] },
  { file: "distancia-edicao", title: "Distância de edição (Levenshtein)", level: "avançado", summary: "Menor número de inserções, remoções e trocas para transformar uma palavra em outra, por programação dinâmica.", teaches: ["tabela linha a linha", "letras do texto", "min de três opções"] },
  { file: "mochila-01", title: "Mochila 0/1 (programação dinâmica)", level: "avançado", summary: "Maior valor que cabe numa mochila e quais itens levar, refazendo o caminho pela tabela.", teaches: ["lista de listas", "reconstrução da resposta", "desempate escrito"] },
  { file: "n-rainhas", title: "N-Rainhas (backtracking)", level: "avançado", summary: "Conta as formas de pôr n rainhas num tabuleiro sem ataques, com uma pilha no lugar da recursão (n de 1 a 5).", teaches: ["backtracking", "pilha explícita", "limite de 5000 passos do motor"] },
  { file: "union-find", title: "Union-Find (grupos disjuntos)", level: "avançado", summary: "Junta elementos em grupos e responde se dois estão no mesmo grupo, com compressão de caminho.", teaches: ["quatro níveis de laço", "compressão de caminho", "validação de entrada"] },
  { file: "kmp", title: "Busca de padrão em texto (KMP)", level: "avançado", summary: "Acha todas as ocorrências de um padrão num texto sem reler o texto, com a tabela de falhas.", teaches: ["duas fases", "tabela de falhas", "ocorrências que se sobrepõem"] },
  { file: "tarjan-scc", title: "Componentes fortemente conexos (Tarjan)", level: "avançado", summary: "Agrupa os nós de um grafo dirigido em componentes onde todos se alcançam, sem recursão.", teaches: ["pilha de chamadas", "mapas de pares", "número de descoberta e low"] },
  { file: "fluxo-maximo", title: "Fluxo máximo (Edmonds-Karp)", level: "avançado", summary: "Maior fluxo de uma fonte a um sumidouro, com busca em largura e grafo residual.", teaches: ["grafo residual", "busca em largura", "desfazer fluxo"] },
  { file: "a-estrela", title: "Menor caminho em grade (A*)", level: "avançado", summary: "Menor número de passos numa grade com obstáculos, guiado pela estimativa em linha reta.", teaches: ["heurística", "células como números", "abertas e visitadas"] },
];

/**
 * Todos os exemplos, na ordem em que aparecem: do mais simples ao mais difícil dentro de cada modo.
 * `loadAlgorithm` entrega o diagrama de um algoritmo pelo nome do arquivo (o app usa `import.meta.glob`; os testes leem do disco).
 */
export function buildCatalog(loadAlgorithm: (file: string) => Promise<Doc>): CatalogExample[] {
  const rank: Record<ExampleLevel, number> = { iniciante: 0, intermediário: 1, avançado: 2 };
  const byLevel = <T extends { level: ExampleLevel }>(xs: T[]) => [...xs].sort((a, b) => rank[a.level] - rank[b.level]);

  const architecture: CatalogExample[] = byLevel(ARCH_EXAMPLES).map((a) => {
    // o arquivo leva o título do diagrama (o app cria o arquivo a partir dele), que pode diferir do nome do exemplo
    const docTitle = a.doc().title;
    const path = pathOf(ARCH_DIR, docTitle);
    return { key: `architecture:${a.id}`, mode: "architecture", title: a.title, level: a.level, summary: a.summary, teaches: a.teaches, files: [{ title: docTitle, path, mode: "architecture", load: a.doc }], open: path, linked: false };
  });

  const domain: CatalogExample[] = byLevel(DDD_EXAMPLES).map((ex) => {
    const docs = buildExample(ex);
    return {
      key: `domain:${ex.id}`,
      mode: "domain",
      title: ex.title,
      level: ex.level,
      summary: ex.summary,
      teaches: ex.teaches,
      files: ex.files.map((f, i) => ({ title: f.title, path: docs[i].path, mode: f.mode, load: () => docs[i].doc })),
      open: examplePath(ex, "visao-geral"),
      linked: true,
    };
  });

  const pricing = pricingDoc();
  const logic: CatalogExample[] = [
    {
      key: "logic:precificacao",
      mode: "logic",
      title: "Engine de precificação",
      level: "avançado",
      summary: "Onze regras em ordem que reescrevem o preço de cada produto: decisões, laço, escolha por tipo, dados e cenários que o app confere.",
      teaches: ["Ação, Decisão, Switch e Loop", "dados de entrada, saída e variável", "cenários e caminho gravado"],
      files: [{ title: pricing.title, path: pathOf(LOGIC_DIR, pricing.title), mode: "logic", load: pricingDoc }],
      open: pathOf(LOGIC_DIR, pricing.title),
      linked: false,
    },
    ...byLevel(ALGORITHM_EXAMPLES).map((a): CatalogExample => {
      const path = pathOf(ALGORITHMS_DIR, a.title);
      return { key: `logic:${a.file}`, mode: "logic", title: a.title, level: a.level, summary: a.summary, teaches: a.teaches, files: [{ title: a.title, path, mode: "logic", load: () => loadAlgorithm(a.file) }], open: path, linked: false };
    }),
  ];
  return [...architecture, ...domain, ...logic];
}

export const EXAMPLE_MODES: { mode: DocMode; label: string; hint: string }[] = [
  { mode: "architecture", label: "Arquitetura", hint: "Componentes, grupos e conexões: o desenho de um sistema." },
  { mode: "domain", label: "Domínio", hint: "DDD: contextos, aggregates, comandos e eventos." },
  { mode: "logic", label: "Lógica", hint: "Regras e algoritmos como fluxo que o app executa e confere." },
];

export { EXAMPLES_DIR };
