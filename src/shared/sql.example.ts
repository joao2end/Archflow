/**
 * Exemplos do modo SQL: consultas reais de uma loja, do join simples à CTE. Cada diagrama sai da própria consulta
 * (`sqlToOps`), então o exemplo é também o teste de ida e volta: o SQL gerado do quadro é a consulta de origem.
 */
import { applyOps } from "./ops";
import { emptyDoc, type Doc } from "./schema";
import { sqlToOps } from "./sqlgen";

export interface SqlExample {
  id: string;
  title: string;
  level: "iniciante" | "intermediário" | "avançado";
  summary: string;
  teaches: string[];
  query: string;
}

export const SQL_EXAMPLES: SqlExample[] = [
  {
    id: "melhores-clientes",
    title: "Melhores clientes",
    level: "iniciante",
    summary: "Os dez clientes que mais gastaram em pedidos pagos: um join, um filtro, a soma por cliente e a ordem.",
    teaches: ["tabela e apelido", "join com condição", "WHERE → GROUP BY → ORDER BY → SELECT"],
    query: `SELECT c.nome, COUNT(*) AS pedidos, SUM(p.total) AS gasto
FROM clientes c
INNER JOIN pedidos p ON p.cliente_id = c.id
WHERE p.status = 'pago'
GROUP BY c.nome
ORDER BY gasto DESC
LIMIT 10;`,
  },
  {
    id: "categorias-sem-venda",
    title: "Vendas por categoria",
    level: "intermediário",
    summary: "Quanto cada categoria vendeu no ano, incluindo as que não venderam nada: left joins em cadeia e um HAVING.",
    teaches: ["LEFT JOIN (as linhas sem par ficam)", "joins em cadeia", "HAVING filtra os grupos"],
    query: `SELECT cat.nome AS categoria, COALESCE(SUM(i.quantidade * i.preco), 0) AS receita
FROM categorias cat
LEFT JOIN produtos pr ON pr.categoria_id = cat.id
LEFT JOIN itens_pedido i ON i.produto_id = pr.id
WHERE cat.ativa = TRUE
GROUP BY cat.nome
HAVING COUNT(pr.id) > 0
ORDER BY receita DESC;`,
  },
  {
    id: "recompra",
    title: "Clientes que voltaram",
    level: "avançado",
    summary: "Uma CTE resume o primeiro e o último pedido de cada cliente; a consulta junta com o cadastro e fica com quem comprou de novo depois de 30 dias.",
    teaches: ["subconsulta como CTE (WITH)", "join entre tabela e CTE", "condição sobre colunas da CTE"],
    query: `WITH resumo AS (
  SELECT cliente_id, MIN(criado_em) AS primeiro, MAX(criado_em) AS ultimo, COUNT(*) AS pedidos
  FROM pedidos
  GROUP BY cliente_id
)
SELECT c.nome, c.email, r.pedidos, r.ultimo
FROM clientes c
INNER JOIN resumo r ON r.cliente_id = c.id
WHERE r.pedidos > 1 AND r.ultimo > r.primeiro + INTERVAL '30 days'
ORDER BY r.ultimo DESC;`,
  },
];

/** O diagrama de uma consulta (título e descrição do exemplo; o quadro vem da consulta). */
export function sqlDocFrom(title: string, query: string, description = ""): Doc {
  const base = { ...emptyDoc(title, "sql"), description };
  return applyOps(base, sqlToOps(query).ops).doc;
}

export const sqlExampleDoc = (ex: SqlExample): Doc => sqlDocFrom(ex.title, ex.query, ex.summary);
