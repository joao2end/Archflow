# Engenharia reversa do Excalidraw

Fonte analisada: `github.com/excalidraw/excalidraw` (clone `--depth 1`, out/2026).
Método: o fluxo da skill *protocol-reverse-engineering* (capturar → identificar fronteiras →
mapear campos → documentar → validar), aplicado a três "protocolos": **formato de arquivo**,
**clipboard** e **colaboração em tempo real**, mais a arquitetura de render/estado.

## 1. Mapa do monorepo

| Pacote | Responsabilidade |
| --- | --- |
| `packages/excalidraw` | Componente React (`App.tsx`, ~12k linhas), actions, renderer, data (import/export/restore/reconcile), history |
| `packages/element` | Modelo de elementos: tipos, `Scene`, `store` (deltas), `binding`, `elbowArrow`, `bounds`, `fractionalIndex`, `renderElement` |
| `packages/math`, `common`, `utils` | Geometria, constantes (`EXPORT_DATA_TYPES`, `VERSIONS`), utilitários de export |
| `packages/fractional-indexing` | Ordenação z-order estável em multiplayer |
| `excalidraw-app` | App hospedado: colaboração (socket.io), Firebase, share links |

## 2. Arquitetura de runtime

- **Três canvases empilhados** (`components/canvases/`): `StaticCanvas` (cena renderizada),
  `NewElementCanvas` (elemento sendo desenhado) e `InteractiveCanvas` (seleção, handles, cursores).
  Separar evita re-renderizar a cena inteira a cada movimento do mouse.
- **Rendering**: Canvas 2D + **roughjs** (`ShapeCache` por elemento, determinístico via `seed`).
  `renderer/staticScene.ts`, `interactiveScene.ts`, e `staticSvgScene.ts` para export SVG.
- **Estado**: `AppState` (UI/viewport/ferramenta, via React state + **jotai** para partes isoladas) e
  `Scene` (lista de elementos imutáveis, mutados por `mutateElement` que incrementa `version`).
- **Actions** (`actions/*`): comando = `{name, perform(elements, appState) → {elements, appState, captureUpdate}, keyTest, PanelComponent}`.
  O `ActionManager` roteia atalhos, menus e command palette para a mesma definição.
- **Undo/redo**: `Store` captura `StoreSnapshot` e emite *deltas* (`delta.ts`: `ElementsDelta`, `AppStateDelta`);
  `History` guarda pilhas de deltas inversíveis, e não snapshots completos. Isso permite undo correto
  mesmo com edições remotas concorrentes.
- **Binding de setas**: `binding.ts` (3k linhas) — arrow guarda `startBinding/endBinding {elementId, focus, gap}`,
  e o elemento alvo guarda `boundElements:[{id,type:"arrow"}]` (relação bidirecional).
  `elbowArrow.ts` roteia setas ortogonais com A*.
- **Texto, frames, grupos**: texto ligado a container via `containerId`; `groupIds` (do mais profundo ao mais raso);
  `frameId` para frames.

## 3. "Protocolo" 1 — formato de arquivo `.excalidraw`

```jsonc
{
  "type": "excalidraw",         // EXPORT_DATA_TYPES.excalidraw
  "version": 2,                 // VERSIONS.excalidraw
  "source": "https://excalidraw.com",
  "elements": [ /* ExcalidrawElement[] */ ],
  "appState": { /* só chaves "exportáveis" (cleanAppStateForExport) */ },
  "files": { "<fileId>": { "mimeType": "...", "dataURL": "data:..." } }
}
```

Campos de **todo** elemento (`_ExcalidrawElementBase`): `id, x, y, width, height, angle, strokeColor,
backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, seed,
version, versionNonce, index (fractional), isDeleted, groupIds, frameId, boundElements, updated, link, locked`.
Tipos: `rectangle | diamond | ellipse | arrow | line | freedraw | text | image | frame | magicframe | embeddable | iframe`.

Observações relevantes para LLMs:
- **Muito ruído visual** (seed, roughness, versionNonce…): ~25 campos por caixa; o *significado* (quem fala com quem)
  só existe em `boundElements`/`startBinding`, derivado de geometria. Um LLM precisa calcular coordenadas.
- Exclusão é lógica (`isDeleted`), necessária para reconciliação.
- Clipboard usa o mesmo envelope com `type: "excalidraw/clipboard"`; biblioteca usa `excalidrawlib` v2.

## 4. "Protocolo" 2 — colaboração em tempo real

Transporte: **socket.io** (`excalidraw-app/collab`), sala = `roomId` + chave `roomKey` no fragmento da URL
(`#room=<id>,<key>`, nunca enviada ao servidor). Payload **cifrado ponta-a-ponta com AES-GCM**
(`data/encryption.ts`: IV aleatório de 12 bytes + ciphertext). O servidor só retransmite.

| Evento (`WS_EVENTS`) | Uso |
| --- | --- |
| `server-broadcast` | Mensagens confiáveis (cena) |
| `server-volatile-broadcast` | Mensagens descartáveis (cursor) |
| `user-follow`, `user-follow-room-change` | Modo "seguir usuário" |

Subtipos (`WS_SUBTYPES`): `SCENE_INIT`, `SCENE_UPDATE`, `MOUSE_LOCATION`, `IDLE_STATUS`, `USER_VISIBLE_SCENE_BOUNDS`.

**Reconciliação** (`data/reconcile.ts`): para cada elemento remoto, descarta se o local é "mais novo"
(maior `version`; empate → menor `versionNonce`) ou se está sendo editado; depois reordena por
`index` fracionário (`orderByFractionalIndex`). É um CRDT-lite *last-writer-wins por elemento*.

## 5. O que reaproveitamos e o que mudamos no Archflow

| Excalidraw | Archflow |
| --- | --- |
| Canvas 2D + roughjs (estilo à mão livre) | **SVG** vetorial limpo — permite animar conectores por CSS/SMIL e estilizar com glassmorphism |
| Elementos geométricos genéricos | Elementos **semânticos**: `node` (com asset/tecnologia), `group` (fronteira/camada), `connection` (tipo + interface) |
| Binding derivado de geometria | `from`/`to`/`parent` **explícitos** por id semântico |
| `version/versionNonce` por elemento | `rev` por documento + eventos SSE (modelo mais simples, humano ↔ LLM) |
| Actions + ActionManager | Store único com comandos nomeados; mesmos *ops* usados por UI e MCP |
| Undo por deltas | Undo por snapshots imutáveis (documentos pequenos) — mudanças vindas do MCP também entram no histórico |
| Colaboração cifrada via socket.io | Bridge local HTTP+SSE + MCP stdio (ver `PROTOCOL.md`) |
| Arquivo `.excalidraw` v2 | `.archflow.json` (`schema: "archflow/1"`) |
