# Caderno de Contas

Aplicação React para controlar entradas, despesas fixas, cartões, dívidas e parcelas mês a mês. Os dados funcionam localmente e, após login por e-mail, são sincronizados com o Supabase com proteção contra conflitos.

O aplicativo possui edição de lançamentos, detalhamento de cartão, histórico automático na nuvem, recuperação de exclusões e importação/exportação de backup em JSON.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Preencha `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave publicável do projeto.
3. Use Node.js 22 ou superior.
4. Execute `pnpm install` e `pnpm dev`.
5. Execute `pnpm test`, `pnpm lint` e `pnpm build` antes de publicar.

## Supabase

As migrações em `supabase/migrations` criam o caderno e seu histórico, habilitam RLS e garantem que cada usuário só consiga acessar os próprios dados. A coluna `version` impede que duas sessões sobrescrevam alterações silenciosamente. Nunca use uma chave `service_role` no frontend.

No painel de autenticação do Supabase, inclua a URL de produção da Vercel em **Redirect URLs** para que o acesso por link de e-mail retorne ao aplicativo.

## Vercel

Importe este repositório e configure:

- `VITE_SUPABASE_URL=https://qqcyfvsvxbaxabwrcacf.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<sua chave publicável>`

O arquivo `vercel.json` já define o build Vite e o fallback da SPA.
