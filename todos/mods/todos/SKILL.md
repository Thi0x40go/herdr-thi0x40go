---
name: herdr-todos
description: "Gerenciar tarefas e itens da to-do list do projeto sincronizada com o painel To-do do Herdr via comando `todo`. Suporta grupos/cards (`-g`), prioridades P0–P3 (`--prio`), subtasks (`todo sub`, `todo done 1.2`), descrições markdown (`todo desc`), visualização detalhada (`todo show`) e exportação JSON (`todo json`)."
---

# herdr-todos — Gerenciamento de Tarefas Avançado no Herdr

Esta skill integra o agente ao sistema moderno de to-dos do Herdr. Cada repositório/projeto Git possui uma lista de tarefas persistida e sincronizada em tempo real com a interface gráfica do Herdr.

## Comandos da CLI `todo`

O executável `todo` está disponível no PATH (`~/.local/bin/todo`).

| Comando | Descrição |
|---|---|
| `todo [list]` | Lista as tarefas abertas e concluídas do projeto atual com índices, status e contadores de subtasks |
| `todo -g <grupo>` ou `todo list -g CARD-2467` | Filtra tarefas por grupo/card |
| `todo --prio <p0..p3>` | Filtra tarefas por prioridade |
| `todo -t <tag>` | Filtra tarefas por tag |
| `todo -s` | Exibe tarefas incluindo a listagem detalhada de subtasks |
| `todo show <n>` | Exibe detalhes completos de uma tarefa: status, grupo, prioridade, tags, descrição e subtasks |
| `todo add <texto>` | Adiciona uma nova tarefa ao projeto |
| `todo add -g <grupo> --prio <p0-p3> --tags <t1,t2> --url <link> --desc "<desc>" <texto>` | Adiciona tarefa com metadados estruturados e link |
| `todo add --urls "card=https://...,mr=https://..." <texto>` | Adiciona tarefa com múltiplos links nomeados |
| `todo add --due "YYYY-MM-DD[ HH:MM]" <texto>` | Adiciona tarefa com prazo de entrega |
| `todo sub <n> <texto>` | Adiciona uma subtask à tarefa pai `n` |
| `todo done <n\|texto>` | Marca o item principal `n` como concluído |
| `todo done <p.s>` | Marca a subtask `s` da tarefa `p` como concluída (ex: `todo done 1.2`) |
| `todo undo <n\|p.s>` | Desmarca uma tarefa ou subtask concluída |
| `todo desc <n> <markdown>` | Adiciona ou edita descrição markdown da tarefa `n` |
| `todo edit <n\|p.s> <novo texto>` | Reformula o texto do item `n` ou da subtask `p.s` |
| `todo rm <n\|p.s>` | Remove permanentemente o item `n` ou a subtask `p.s` |
| `todo clear` | Remove todas as tarefas já concluídas do projeto |
| `todo json` | Exporta o projeto e suas tarefas, metadados e subtasks em formato JSON estruturado |
| `todo all` | Lista as tarefas de todos os projetos |
| `todo log [on\|off]` | Consulta ou ativa/desativa o registro automático de requisições |
| `todo sync [on\|off]` | Sincroniza com o arquivo TODO.md na raiz do repositório |

## Grupos, Cards e Prioridades

- **Grupos / Cards**: Qualquer referência a `[CARD-XXXX]` ou flag `-g CARD-XXXX` agrupa a tarefa automaticamente.
- **Prioridades**:
  - `P0` / `!p0` / `!urgent`: Crítico / Urgente (destaque vermelho)
  - `P1` / `!p1` / `!high`: Alta prioridade (destaque amarelo/laranja)
  - `P2` / `!p2` / `!med`: Prioridade média (destaque azul)
  - `P3` / `!p3` / `!low`: Baixa prioridade (cinza/dim)
- **Subtasks**: Notação hierárquica `p.s` (ex: tarefa 1, subtask 2 = `1.2`).
  - Adicionar: `todo sub 1 "Subtarefa"`
  - Concluir: `todo done 1.2`

## Diretrizes para o Agente

1. **Quando o Request Logging estiver ativo (`todo log` retorna `Request logging: on`):**
   - Sempre que o usuário pedir uma tarefa, correção ou feature, adicione imediatamente à lista:
     ```bash
     todo add -g CARD-XXXX --prio p1 "Descrição concisa"
     ```
   - Para etapas complexas de uma tarefa existente, utilize subtasks:
     ```bash
     todo sub 1 "Etapa específica de validação"
     ```
   - Assim que finalizar o desenvolvimento e validar, marque o item correspondente:
     ```bash
     todo done 1.1 # se subtask
     todo done 1   # se tarefa geral
     ```
   - Se o usuário refinar o escopo: `todo edit <n> <novo texto>` ou `todo rm <n>`.
2. **Mantenha os títulos concisos**: Detalhes e especificações devem ir para a descrição (`todo desc <n> "<detalhes>"`) ou em subtasks (`todo sub <n> "<etapa>"`).
