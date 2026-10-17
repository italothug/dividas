# Correções da auditoria

Não inclui as novas opções opcionais (lixeira, recibos, lembretes, vínculo automático de recebimentos ou exportação de devedores).

- Armazenamento e fila separados por usuário; área de trabalho remontada na troca de identidade. Respostas antigas são ignoradas. O backup local legado, sem proprietário, fica disponível para recuperação explícita, nunca é associado automaticamente à conta.
- Fila confirma somente a operação enviada; alterações posteriores ficam pendentes. Falhas são repetidas ao reconectar, focar a página e a cada 30 segundos. Conflitos exigem escolha. Sair é bloqueado enquanto houver alterações pendentes.
- Desfazer reintegra os lançamentos excluídos, sem restaurar um snapshot antigo sobre novas alterações.
- Valores brasileiros aceitam milhares e centavos; os campos monetários formatam o valor ao perder foco.
- Edição e exclusão oferecem alcance individual ou futuras pendentes. Próximas parcelas já pagas/recebidas são preservadas. Cancelamentos impedem regeneração.
- Importação limita tamanho, valida estrutura, categorias, valores, identificadores e parcelas; apresenta resumo e confirmação. Restaurar exporta o caderno atual antes de substituir.
- Cadastro e redefinição exigem oito caracteres; mínimo também salvo e conferido no painel do Supabase em 16/10/2026. Login de usuários existentes não muda. Proteção contra senhas vazadas permanece indisponível no plano Free atual e depende do Pro. Nenhum upgrade ou MFA foi contratado/ativado.

## Validação

Executar `pnpm test`, `pnpm lint` e `pnpm build`. A suíte inclui cenários de fila offline, falha durante envios consecutivos, descarte de resposta de conta anterior, conflitos, backups, moeda, edição em série e desfazer.

Teste de interface local com dados fictícios: entrada de 1.000 em três parcelas; edição para 750 nas próximas parcelas; exclusão individual e desfazer após nova entrada de 25,50; importação com prévia e cancelamento sem substituir o caderno. Não usa dados financeiros de produção.

Limites: testes de sincronização usam transporte simulado. Login real entre duas contas, envio de e-mails e quedas reais do Supabase não foram automatizados; precisam de contas de teste autorizadas. O armazenamento local não é criptografia contra alguém com acesso ao perfil do navegador.
