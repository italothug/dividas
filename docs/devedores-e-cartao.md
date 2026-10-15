# Devedores e compras parceladas

## Compras no cartão

- O valor principal continua sendo o **total da fatura do mês**. Não é dividido pelo número de parcelas.
- Cada subitem possui valor **por parcela**, parcela atual e total de parcelas (1 a 120).
- Ao salvar uma fatura, os próximos meses são criados automaticamente, com um lançamento do mesmo cartão somando somente as parcelas futuras conhecidas. Outros gastos não são estimados.
- Exemplo: máquina 2/4 de R$ 325,17 gera 3/4 no próximo mês e 4/4 no seguinte. Revisão 3/3 não continua.
- Ao editar uma compra e salvar a fatura, somente suas ocorrências automáticas futuras ainda não pagas são reconstruídas. Faturas pagas e outras compras são preservadas.
- Subitens antigos com “2/4” na descrição não são migrados silenciosamente. Clique em Editar no subitem, confira os números sugeridos, aplique o subitem e salve a fatura.
- Excluir uma fatura/um mês mantém o comportamento anterior: remove apenas esse mês. Para cancelar parcelas futuras, remova o subitem no editor da fatura e salve. A alteração não reescreve meses anteriores.
- `origemId` conecta as faturas e compras. `automatic` identifica parcelas geradas, permitindo refazer o agendamento sem duplicar.

## Devedores

- A página é independente dos lançamentos de entradas. Não cria entradas automaticamente, evitando dupla contagem.
- Campos: nome, contato, valor inicial, juros mensais, parcela combinada, primeiro mês de cobrança, vencimento e observações.
- Juros compostos aplicados uma vez no início de cada competência, inclusive na primeira. Cada mês: saldo final = saldo inicial + juros arredondados aos centavos − pagamentos do mês.
- Não há juros diários, multas, correção monetária nem inferência de recebimentos. A data do pagamento determina a competência. O vencimento é limitado ao último dia do mês.
- Pagamentos múltiplos e parciais são somados. Um pagamento maior que o saldo disponível é recusado. Remover um pagamento ou editar o acordo recalcula o histórico.
- A previsão parte do saldo atual e supõe a parcela combinada em todos os próximos meses; a última parcela é limitada ao saldo. Sem amortização ou prazo superior a 600 meses, a interface informa ausência de previsão.
- Os cálculos são um controle do acordo informado, não uma definição de condições legais de cobrança.

## Persistência e compatibilidade

`devedores` é um campo opcional da estrutura JSON existente de `ledger_states.state`. Não requer alteração no schema, permissões ou variáveis de ambiente. Sincronização, histórico e backup usam a mesma estrutura. Backups antigos sem devedores seguem válidos. Importar/restaurar um backup antigo substitui todo o caderno, inclusive a lista de devedores; exporte um backup atual antes de restaurar.

## Verificações

Testes unitários em `test/planning.test.js`: progressão individual, virada de ano, preservação de faturas pagas, edição idempotente, compras avulsas, juros, pagamento parcial/múltiplo, quitação, limites, validação e compatibilidade.

Verificação manual local: cadastrar compra 2/4, confirmar 3/4 no próximo mês; criar devedor com R$ 1.000, 2% a.m., parcela R$ 200; registrar R$ 100 e confirmar saldo R$ 920; recarregar e verificar persistência; conferir layout desktop e 390px.
