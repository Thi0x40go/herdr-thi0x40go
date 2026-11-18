---
name: herdr-todos
description: "Gerenciar tarefas e itens da to-do list do projeto sincronizada com o painel To-do do Herdr via comando `todo`. Use para consultar (`todo`, `todo all`), adicionar novas tarefas (`todo add`), marcar como concluída (`todo done`), editar (`todo edit`), remover (`todo rm`) ou verificar se o registro de requisições está ativo (`todo log`)."
---

# herdr-todos — Gerenciamento de tarefas do projeto no Herdr

Esta skill integra o agente ao painel To-do do Herdr. Cada repositório/projeto Git possui uma lista de tarefas persistida e sincronizada em tempo real com a interface gráfica do Herdr.

## Comandos da CLI `todo`

O executável `todo` está disponível no PATH (`~/.local/bin/todo`).

| Comando | Descrição |
|---|---|
| `todo` | Lista as tarefas abertas e concluídas do projeto atual com seus números |
| `todo all` | Lista as tarefas de todos os projetos |
| `todo add <texto>` | Adiciona uma nova tarefa ao projeto atual |
| `todo add --due "YYYY-MM-DD[ HH:MM]" <texto>` | Adiciona tarefa com prazo de entrega |
| `todo done <n\|texto>` | Marca o item de número `n` (ou com texto exato) como concluído |
| `todo undo <n\|texto>` | Desmarca uma tarefa concluída |
| `todo edit <n\|texto> <novo texto>` | Edita/reformula o texto do item `n` |
| `todo rm <n>` | Remove permanentemente o item `n` da lista |
| `todo clear` | Remove todas as tarefas já concluídas do projeto |
| `todo log [on\|off]` | Consulta ou ativa/desativa o registro automático de requisições |
| `todo sync [on\|off]` | Consulta ou ativa/desativa sincronização com o arquivo TODO.md na raiz do repo |

## Diretrizes para o Agente

1. **Quando o Request Logging estiver ativo (`todo log` retorna `Request logging: on`):**
   - Sempre que o usuário pedir uma tarefa, correção, mudança ou nova feature, adicione imediatamente à lista:
     ```bash
     todo add "Descrição concisa da tarefa"
     ```
   - Assim que finalizar o desenvolvimento e validar o resultado, marque o item como concluído:
     ```bash
     todo done <número>
     ```
   - Se o usuário desistir, mudar de ideia ou refinar o escopo, use `todo rm <n>` ou `todo edit <n> <novo texto>`.
   - Se ficar trabalho pendente ou follow-up, adicione como um item aberto e avise o usuário.
2. **Mantenha os itens curtos:**
   - Cada item deve ser objetivo e caber em uma única linha.
