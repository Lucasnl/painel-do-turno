# Painel do Turno (Trello Float v2)

Janela flutuante, sempre visível na recepção, sincronizada com o Trello.

## O que faz
- Detecta o turno atual (Manhã / Tarde / Madrugada — horários configuráveis).
- Cria automaticamente, todo turno, o cartão "Turno X — dd/mm/aaaa" no quadro
  OPERAÇÃO, com o checklist de início de turno.
- Voluntário marca os itens direto no painel (fica registrado no Trello).
- Lista as pendências (A FAZER / EM ANDAMENTO) com responsável e prazo.
- "Concluir" move o cartão para CONCLUÍDO (nada é arquivado, histórico fica).
- "+ nova" cria pendência com responsável e prazo.
- Notificação do Windows: tarefa atrasada, metade do turno, 30 min do fim.
- Botão 📖 abre o quadro do manual no navegador.
- Ícone na bandeja, "Sempre no topo", "Iniciar com o Windows", lembra posição.

## Primeira vez
1. Abra o app. Cole API Key e Token (https://trello.com/power-ups/admin).
2. Clique em "Criar quadro Operação" (cria A FAZER / EM ANDAMENTO / CONCLUÍDO).
3. Escolha o quadro do Manual (o quadro atual de vocês).
4. Ajuste turnos e checklist se quiser. Salvar.

## Rodar em desenvolvimento
    npm install
    npm start

## Gerar o .exe portátil
Execute BUILD-WINDOWS.bat **como Administrador** (electron-builder precisa criar
links simbólicos na primeira vez). O executável fica em `dist\`.

## Segurança
Key e Token ficam só neste PC (localStorage do app). Nenhuma credencial no código.
