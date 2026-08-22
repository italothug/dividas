# Caderno de Contas

Aplicação React para controlar entradas, despesas fixas, cartões, dívidas e parcelas mês a mês. Os dados funcionam localmente e, após login por e-mail, são sincronizados com o Supabase.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Preencha `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave publicável do projeto.
3. Execute `npm install` e `npm run dev`.

## Supabase

A migração em `supabase/migrations` cria `ledger_states`, habilita RLS e garante que cada usuário só consiga acessar o próprio caderno. Nunca use uma chave `service_role` no frontend.

No painel de autenticação do Supabase, inclua a URL de produção da Vercel em **Redirect URLs** para que o acesso por link de e-mail retorne ao aplicativo.

## Vercel

Importe este repositório e configure:

- `VITE_SUPABASE_URL=https://qqcyfvsvxbaxabwrcacf.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<sua chave publicável>`

O arquivo `vercel.json` já define o build Vite e o fallback da SPA.
